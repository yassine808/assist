// @vitest-environment node
// Main-process code with no DOM surface; see the note in updater.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({ root: "" }));

vi.mock("electron", () => ({
  app: { isPackaged: false, getAppPath: () => state.root },
  net: { fetch: vi.fn() },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
}));

import { listAnimatedCards, resolveCardPath } from "./playercards";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "riotswitcher-cards-"));
  state.root = root;
  mkdirSync(join(root, "official playercards", "AgentMastery", "Animated"), { recursive: true });
  mkdirSync(join(root, "cards"), { recursive: true });
  writeFileSync(join(root, "cards", "Astra_Mastery_Card_animated.webp"), "x");
  writeFileSync(join(root, "cards", "Jett_Mastery_Card_animated.apng"), "x");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveCardPath", () => {
  const cards = () => join(root, "cards");

  it("serves an existing card file", () => {
    expect(resolveCardPath(cards(), "Jett_Mastery_Card_animated.apng")).toBe(
      join(cards(), "Jett_Mastery_Card_animated.apng"),
    );
  });

  it("resolves a legacy .apng URL to the WebP sibling", () => {
    // Profiles saved by older builds store the .apng URL; the art on disk is
    // now WebP, so the request must still find a file instead of 404ing.
    expect(resolveCardPath(cards(), "Astra_Mastery_Card_animated.apng")).toBe(
      join(cards(), "Astra_Mastery_Card_animated.webp"),
    );
  });

  it("rejects traversal, unknown extensions and missing files", () => {
    expect(resolveCardPath(cards(), "../secret.webp")).toBeNull();
    expect(resolveCardPath(cards(), "..\\secret.webp")).toBeNull();
    expect(resolveCardPath(cards(), "notes.txt")).toBeNull();
    expect(resolveCardPath(cards(), "Nobody_Mastery_Card_animated.webp")).toBeNull();
  });
});

describe("listAnimatedCards", () => {
  it("lists both formats with a cleaned-up display name", () => {
    writeFileSync(join(root, "official playercards", "AgentMastery", "Animated", "Astra_Mastery_Card_animated.webp"), "x");
    writeFileSync(join(root, "official playercards", "AgentMastery", "Animated", "Jett_Mastery_Card_animated.apng"), "x");
    writeFileSync(join(root, "official playercards", "AgentMastery", "Animated", "notes.txt"), "x");

    expect(listAnimatedCards()).toEqual([
      { name: "Astra", url: "card://animated/Astra_Mastery_Card_animated.webp" },
      { name: "Jett", url: "card://animated/Jett_Mastery_Card_animated.apng" },
    ]);
  });
});
