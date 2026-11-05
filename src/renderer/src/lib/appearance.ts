// Appearance preferences (background theme + player card scale).
//
// Stored in localStorage so every window (home, settings) can apply them
// synchronously before first paint and stay in sync through the `storage`
// event. SettingsView also mirrors them to the backend config.

export interface ThemeDef {
  id: string;
  name: string;
  base: string; // page background
  deep: string; // title bar / deepest surface
  panel: string; // cards & modals
  glow: string; // the light on top (r, g, b)
  swatch: [string, string]; // preview gradient
}

export const THEMES: ThemeDef[] = [
  { id: "midnight", name: "Midnight", base: "#0a1017", deep: "#070b11", panel: "#0e1620", glow: "72, 130, 175", swatch: ["#48a0d8", "#0a1017"] },
  { id: "obsidian", name: "Obsidian", base: "#0c0c10", deep: "#08080b", panel: "#121217", glow: "140, 140, 170", swatch: ["#9a9ab8", "#0c0c10"] },
  { id: "abyss", name: "Abyss", base: "#08131a", deep: "#050d12", panel: "#0b1a23", glow: "40, 170, 170", swatch: ["#2cc2b8", "#08131a"] },
  { id: "ember", name: "Ember", base: "#140b0e", deep: "#0e0709", panel: "#1a0f13", glow: "210, 80, 80", swatch: ["#e0584f", "#140b0e"] },
  { id: "violet", name: "Violet", base: "#0f0b18", deep: "#0a0711", panel: "#150f22", glow: "130, 90, 210", swatch: ["#8a62e0", "#0f0b18"] },
  { id: "forest", name: "Forest", base: "#09130e", deep: "#060d09", panel: "#0d1a13", glow: "70, 170, 110", swatch: ["#48b878", "#09130e"] },
];

export const DEFAULT_THEME = "midnight";
export const SCALE_MIN = 0.82; // ≈ 70% of the default
export const SCALE_MAX = 1.4;
export const SCALE_DEFAULT = 1.17; // the card's original --lobby-k

const THEME_KEY = "rs_theme";
const SCALE_KEY = "rs_card_scale";

export function getTheme(): string {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v && THEMES.some((t) => t.id === v)) return v;
  } catch { /* ignore */ }
  return DEFAULT_THEME;
}

export function clampScale(v: number): number {
  if (!Number.isFinite(v)) return SCALE_DEFAULT;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(v * 100) / 100));
}

export function getScale(): number {
  try {
    const raw = localStorage.getItem(SCALE_KEY);
    if (raw !== null) return clampScale(parseFloat(raw));
  } catch { /* ignore */ }
  return SCALE_DEFAULT;
}

export function applyTheme(id: string): void {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
  const s = document.documentElement.style;
  s.setProperty("--bg-base", t.base);
  s.setProperty("--bg-deep", t.deep);
  s.setProperty("--bg-panel", t.panel);
  s.setProperty("--glow", `rgb(${t.glow})`);
  document.documentElement.dataset.theme = t.id;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", t.base);
}

export function applyScale(k: number): void {
  document.documentElement.style.setProperty("--lobby-k", String(clampScale(k)));
}

export function setTheme(id: string): void {
  try { localStorage.setItem(THEME_KEY, id); } catch { /* ignore */ }
  applyTheme(id);
}

export function setScale(k: number): void {
  const v = clampScale(k);
  try { localStorage.setItem(SCALE_KEY, String(v)); } catch { /* ignore */ }
  applyScale(v);
}

/** Apply stored preferences immediately and follow changes made in other windows. */
export function initAppearance(): void {
  applyTheme(getTheme());
  applyScale(getScale());
  window.addEventListener("storage", (e) => {
    if (e.key === THEME_KEY) applyTheme(getTheme());
    if (e.key === SCALE_KEY) applyScale(getScale());
  });
}

/** First run on this machine: adopt what the backend config remembers. */
export function hydrateFromConfig(cfg: Record<string, unknown> | null | undefined): void {
  if (!cfg) return;
  try {
    if (localStorage.getItem(THEME_KEY) === null && typeof cfg.BackgroundTheme === "string" && THEMES.some((t) => t.id === cfg.BackgroundTheme)) {
      setTheme(cfg.BackgroundTheme);
    }
    if (localStorage.getItem(SCALE_KEY) === null && typeof cfg.PlayerCardScale === "number") {
      setScale(cfg.PlayerCardScale);
    }
  } catch { /* ignore */ }
}
