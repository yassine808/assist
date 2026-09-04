export interface AgentStat {
  agent: string;
  games: number;
  winrate: number;
}

export interface RecentMatch {
  agent: string;
  map: string;
  result: 'win' | 'loss';
  score: number;
  kills: number;
  deaths: number;
  assists: number;
}

export interface ValorantData {
  tier: number;
  rank_name: string;
  rr: number;
  peak_rank_name: string;
  wins: number;
  losses: number;
  games: number;
  last_played_ms: number;
  last_updated_ms: number;
  act_id: string;
  top_agent: string;
  avg_combat_score: number;
  agent_stats: AgentStat[];
  recent_matches: RecentMatch[];
  agent_portrait: string;
  agent_role: string;
  agent_bg: string;
  agent_bg_colors: string[];
  rank_icon: string;
  player_card_bg: string;
}

export interface Profile {
  profile_name: string;
  description: string;
  valorant_puuid: string;
  valorant_region: string;
  valorant_in_game_name: string;
  valorant_data: ValorantData;
  is_running: boolean;
}

export const VALORANT_TIER_NAMES: Record<number, string> = {
  0: "Unranked",
  1: "Unrated",
  3: "Iron 1",
  4: "Iron 2",
  5: "Iron 3",
  6: "Bronze 1",
  7: "Bronze 2",
  8: "Bronze 3",
  9: "Silver 1",
  10: "Silver 2",
  11: "Silver 3",
  12: "Gold 1",
  13: "Gold 2",
  14: "Gold 3",
  15: "Platinum 1",
  16: "Platinum 2",
  17: "Platinum 3",
  18: "Diamond 1",
  19: "Diamond 2",
  20: "Diamond 3",
  21: "Ascendant 1",
  22: "Ascendant 2",
  23: "Ascendant 3",
  24: "Immortal 1",
  25: "Immortal 2",
  26: "Immortal 3",
  27: "Radiant",
};

export interface ProfileGridCallbacks {
  onPlay: (profile: Profile) => void;
  onDelete: (profile: Profile) => void;
  onReorder: (names: string[]) => Promise<void> | void;
}
