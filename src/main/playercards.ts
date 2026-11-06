import { app, net, protocol } from "electron";
import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Animated player cards are local image files shipped with the app, not URLs
 * from valorant-api.com. They are served to the renderer over a dedicated
 * `card://` scheme so the images work the same in dev (http origin) and in
 * the packaged build (file origin), where a plain `file://` src is blocked by
 * the page CSP and by Chromium's origin rules.
 *
 * Cards are animated WebP (`CARD_EXTENSIONS[0]`). Older builds shipped the same
 * art as APNG, and every profile saved since then stores a `card://...apng`
 * URL, so an `.apng` request that has no file on disk is served the WebP
 * sibling instead of a 404. That keeps saved profiles working after the
 * format change without rewriting anyone's data.
 */
export const CARD_SCHEME = "card";

/** Extensions the picker lists. WebP first so it wins when both exist. */
const CARD_EXTENSIONS = [".webp", ".apng"] as const;

export interface AnimatedCard {
  /** Card file name without the `_Mastery_Card_animated` suffix. */
  name: string;
  url: string;
}

/** Must run before `app.whenReady()` so the scheme is privileged at startup. */
export function registerCardScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CARD_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

/** Folder holding the animated cards, in dev and in the packaged build. */
export function animatedCardDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "playercards", "animated");
  }
  return join(app.getAppPath(), "official playercards", "AgentMastery", "Animated");
}

function cardExtension(file: string): string {
  const lower = file.toLowerCase();
  return CARD_EXTENSIONS.find((ext) => lower.endsWith(ext)) ?? "";
}

function prettyName(file: string): string {
  const ext = cardExtension(file);
  return file
    .slice(0, file.length - ext.length)
    .replace(/_Mastery_Card_animated$/i, "")
    .replaceAll("_", " ");
}

export function listAnimatedCards(): AnimatedCard[] {
  let files: string[];
  try {
    files = readdirSync(animatedCardDir());
  } catch {
    return [];
  }

  return files
    .filter((file) => cardExtension(file) !== "")
    .sort((a, b) => a.localeCompare(b))
    .map((file) => ({
      name: prettyName(file),
      url: `${CARD_SCHEME}://animated/${encodeURIComponent(file)}`,
    }));
}

/** Swap the extension on a card request path, keeping the directory part. */
function withExtension(file: string, ext: string): string {
  const dot = file.lastIndexOf(".");
  return (dot > 0 ? file.slice(0, dot) : file) + ext;
}

/** Serve `card://animated/<file>` from the animated card folder only. */
export function handleCardProtocol(): void {
  const root = animatedCardDir();

  protocol.handle(CARD_SCHEME, (request) => {
    const requested = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
    const resolved = resolveCardPath(root, requested);
    if (!resolved) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(resolved).toString());
  });
}

/**
 * Map a requested relative path to a real file under `root`, or null.
 *
 * Rejects traversal, sibling-folder prefix matches and non-image names; a
 * missing legacy `.apng` silently resolves to the `.webp` sibling.
 */
export function resolveCardPath(root: string, requested: string): string | null {
  if (cardExtension(requested) === "") return null;
  const candidate = join(root, requested);
  if (isInside(root, candidate) && existsSync(candidate)) {
    return candidate;
  }

  if (cardExtension(requested) === ".apng") {
    const fallback = withExtension(candidate, ".webp");
    if (isInside(root, fallback) && existsSync(fallback)) {
      return fallback;
    }
  }
  return null;
}

function isInside(root: string, full: string): boolean {
  const inside = relative(root, full);
  return !inside.startsWith("..") && !isAbsolute(inside);
}
