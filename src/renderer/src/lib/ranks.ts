import { VALORANT_TIER_NAMES } from "../types/profile";

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

const TIER_ICON_MAP: Record<number, string> = {
  3: "Iron_1_Rank",
  4: "Iron_2_Rank",
  5: "Iron_3_Rank",
  6: "Bronze_1_Rank",
  7: "Bronze_2_Rank",
  8: "Bronze_3_Rank",
  9: "Silver_1_Rank",
  10: "Silver_2_Rank",
  11: "Silver_3_Rank",
  12: "Gold_1_Rank",
  13: "Gold_2_Rank",
  14: "Gold_3_Rank",
  15: "Platinum_1_Rank",
  16: "Platinum_2_Rank",
  17: "Platinum_3_Rank",
  18: "Diamond_1_Rank",
  19: "Diamond_2_Rank",
  20: "Diamond_3_Rank",
  21: "Ascendant_1_Rank",
  22: "Ascendant_2_Rank",
  23: "Ascendant_3_Rank",
  24: "Immortal_1_Rank",
  25: "Immortal_2_Rank",
  26: "Immortal_3_Rank",
  27: "Radiant_Rank",
};

export function rankIconPath(tier: number): string | null {
  const name = TIER_ICON_MAP[tier];
  if (!name) return null;
  return `/assets/icons/ranks/${name}.png`;
}
