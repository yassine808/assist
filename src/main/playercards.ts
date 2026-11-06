import { app, net, protocol } from "electron";
import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Animated player cards are local APNG files shipped with the app, not URLs
 * from valorant-api.com. They are served to the renderer over a dedicated
 * `card://` scheme so the images work the same in dev (http origin) and in
 * the packaged build (file origin), where a plain `file://` src is blocked by
 * the page CSP and by Chromium's origin rules.
 */
export const CARD_SCHEME = "card";

export interface AnimatedCard {
  /** Card file name without the `_Mastery_Card_animated.apng` suffix. */
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

/** Folder holding the animated APNGs, in dev and in the packaged build. */
export function animatedCardDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "playercards", "animated");
  }
  return join(app.getAppPath(), "official playercards", "AgentMastery", "Animated");
}

function prettyName(file: string): string {
  return file
    .replace(/\.apng$/i, "")
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
    .filter((file) => file.toLowerCase().endsWith(".apng"))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => ({
      name: prettyName(file),
      url: `${CARD_SCHEME}://animated/${encodeURIComponent(file)}`,
    }));
}

/** Serve `card://animated/<file>` from the animated card folder only. */
export function handleCardProtocol(): void {
  const root = animatedCardDir();

  protocol.handle(CARD_SCHEME, (request) => {
    const requested = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
    const full = join(root, requested);
    const inside = relative(root, full);
    // Reject traversal, sibling-folder prefix matches, non-APNGs and misses.
    // Returning 404 instead of letting `net.fetch` throw keeps a broken card
    // from surfacing as an unhandled rejection in the main process.
    if (inside.startsWith("..") || isAbsolute(inside) || !full.toLowerCase().endsWith(".apng") || !existsSync(full)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(full).toString());
  });
}
