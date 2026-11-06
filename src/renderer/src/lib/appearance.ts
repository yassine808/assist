// Appearance preferences (background theme + player card scale).
//
// Stored in localStorage so the theme is applied synchronously before first paint. The settings
// panel mirrors them to the backend config so they survive a cleared profile.

export interface ThemeDef {
  id: string;
  name: string;
  base: string; // page background
  deep: string; // title bar / deepest surface
  panel: string; // cards & modals
  glow: string; // the light on top, "r, g, b"
}

export const CUSTOM_ID = "custom";
export const DEFAULT_CUSTOM = "#5b8def";

export const THEMES: ThemeDef[] = [
  { id: "midnight", name: "Midnight", base: "#0a1017", deep: "#070b11", panel: "#0e1620", glow: "72, 130, 175" },
  { id: "obsidian", name: "Obsidian", base: "#0c0c10", deep: "#08080b", panel: "#121217", glow: "140, 140, 170" },
  { id: "steel", name: "Steel", base: "#0d1014", deep: "#090b0e", panel: "#14181e", glow: "150, 172, 195" },
  { id: "abyss", name: "Abyss", base: "#08131a", deep: "#050d12", panel: "#0b1a23", glow: "40, 170, 170" },
  { id: "neon", name: "Neon", base: "#060f14", deep: "#030a0e", panel: "#0a171e", glow: "40, 212, 240" },
  { id: "ocean", name: "Ocean", base: "#070f1f", deep: "#040a15", panel: "#0b1629", glow: "58, 118, 235" },
  { id: "violet", name: "Violet", base: "#0f0b18", deep: "#0a0711", panel: "#150f22", glow: "130, 90, 210" },
  { id: "plum", name: "Plum", base: "#130a16", deep: "#0d060f", panel: "#1a0e1e", glow: "190, 90, 200" },
  { id: "rose", name: "Rose", base: "#170a11", deep: "#10070c", panel: "#1e0f18", glow: "225, 90, 140" },
  { id: "ember", name: "Ember", base: "#140b0e", deep: "#0e0709", panel: "#1a0f13", glow: "210, 80, 80" },
  { id: "sunset", name: "Sunset", base: "#150e08", deep: "#0e0905", panel: "#1c130b", glow: "235, 150, 60" },
  { id: "gold", name: "Gold", base: "#14120a", deep: "#0e0c06", panel: "#1b180d", glow: "220, 190, 70" },
  { id: "forest", name: "Forest", base: "#09130e", deep: "#060d09", panel: "#0d1a13", glow: "70, 170, 110" },
];

export const DEFAULT_THEME = "ocean";
export const SCALE_MIN = 0.82; // ≈ 70% of the default
export const SCALE_MAX = 1.4;
export const SCALE_DEFAULT = 1.17; // the card's original --lobby-k

const THEME_KEY = "rs_theme";
const SCALE_KEY = "rs_card_scale";
const CUSTOM_KEY = "rs_custom_color";

const HEX = /^#[0-9a-f]{6}$/i;

function hexToRgb(hex: string): [number, number, number] {
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
}

/** Mix a colour into near-black: `amount` is how much of the colour survives. */
function tint(rgb: [number, number, number], amount: number): string {
  const dark = [6, 8, 12];
  const c = rgb.map((v, i) => Math.round(dark[i] + (v - dark[i]) * amount));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** A full theme derived from one picked colour. */
export function customTheme(hex: string): ThemeDef {
  const rgb = hexToRgb(HEX.test(hex) ? hex : DEFAULT_CUSTOM);
  return {
    id: CUSTOM_ID,
    name: "Custom",
    base: tint(rgb, 0.1),
    deep: tint(rgb, 0.055),
    panel: tint(rgb, 0.15),
    glow: rgb.join(", "),
  };
}

export function isValidHex(v: unknown): v is string {
  return typeof v === "string" && HEX.test(v);
}

export function getCustomColor(): string {
  try {
    const v = localStorage.getItem(CUSTOM_KEY);
    if (isValidHex(v)) return v;
  } catch { /* ignore */ }
  return DEFAULT_CUSTOM;
}

export function getTheme(): string {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === CUSTOM_ID || (v && THEMES.some((t) => t.id === v))) return v;
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
    if (raw !== null) return clampScale(Number.parseFloat(raw));
  } catch { /* ignore */ }
  return SCALE_DEFAULT;
}

export function applyTheme(id: string): void {
  const t = id === CUSTOM_ID ? customTheme(getCustomColor()) : THEMES.find((x) => x.id === id) ?? THEMES[0];
  const s = document.documentElement.style;
  s.setProperty("--bg-base", t.base);
  s.setProperty("--bg-deep", t.deep);
  s.setProperty("--bg-panel", t.panel);
  s.setProperty("--glow", `rgb(${t.glow})`);
  document.documentElement.dataset.theme = t.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.base);
}

export function applyScale(k: number): void {
  document.documentElement.style.setProperty("--lobby-k", String(clampScale(k)));
}

export function setTheme(id: string): void {
  try { localStorage.setItem(THEME_KEY, id); } catch { /* ignore */ }
  applyTheme(id);
}

/** Pick a custom colour and switch to it. */
export function setCustomColor(hex: string): void {
  if (!isValidHex(hex)) return;
  try { localStorage.setItem(CUSTOM_KEY, hex); } catch { /* ignore */ }
  setTheme(CUSTOM_ID);
}

export function setScale(k: number): void {
  const v = clampScale(k);
  try { localStorage.setItem(SCALE_KEY, String(v)); } catch { /* ignore */ }
  applyScale(v);
}

export function initAppearance(): void {
  applyTheme(getTheme());
  applyScale(getScale());
  window.addEventListener("storage", (e) => {
    if (e.key === THEME_KEY || e.key === CUSTOM_KEY) applyTheme(getTheme());
    if (e.key === SCALE_KEY) applyScale(getScale());
  });
}

/** First run on this machine: adopt what the backend config remembers. */
export function hydrateFromConfig(cfg: Record<string, unknown> | null | undefined): void {
  if (!cfg) return;
  try {
    if (localStorage.getItem(CUSTOM_KEY) === null && isValidHex(cfg.CustomThemeColor)) {
      localStorage.setItem(CUSTOM_KEY, cfg.CustomThemeColor);
    }
    if (localStorage.getItem(THEME_KEY) === null && typeof cfg.BackgroundTheme === "string"
      && (cfg.BackgroundTheme === CUSTOM_ID || THEMES.some((t) => t.id === cfg.BackgroundTheme))) {
      setTheme(cfg.BackgroundTheme);
    }
    if (localStorage.getItem(SCALE_KEY) === null && typeof cfg.PlayerCardScale === "number") {
      setScale(cfg.PlayerCardScale);
    }
  } catch { /* ignore */ }
}
