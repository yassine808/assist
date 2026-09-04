import { VALORANT_TIER_NAMES } from "../types/profile";

const TIER_ICON_BASE = "https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04";

export function rankColor(tier: number): string {
  if (tier <= 0) return "#7a7a85";
  if (tier <= 5) return "#9d9ea3"; // Iron
  if (tier <= 8) return "#cd7f32"; // Bronze
  if (tier <= 11) return "#c0c0c8"; // Silver
  if (tier <= 14) return "#c8aa6e"; // Gold
  if (tier <= 17) return "#4fd1c5"; // Platinum
  if (tier <= 20) return "#5b9bd5"; // Diamond
  if (tier <= 23) return "#e05cf5"; // Ascendant
  if (tier <= 26) return "#ff5f7a"; // Immortal
  return "#ff4655"; // Radiant
}

export function rankShort(tier: number): string {
  const name = VALORANT_TIER_NAMES[tier] ?? "Unranked";
  if (tier <= 0) return "UR";
  const seg = name.split(" ");
  return seg[seg.length - 1] ?? "?";
}

export function rankIconUrl(tier: number): string {
  if (tier <= 0) return "";
  return `${TIER_ICON_BASE}/${tier}/largeicon.png`;
}
