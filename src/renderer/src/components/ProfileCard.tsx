import { useState } from "react";
import { Profile } from "../types/profile";
import { rankColor } from "../lib/ranks";
import { VALORANT_TIER_NAMES } from "../types/profile";
import { useProfileLaunch, LaunchState } from "../hooks/useProfileLaunch";
import "../styles/card-glow.css";

interface ProfileCardProps {
  profile: Profile;
  running: boolean;
  launchState: LaunchState;
  onPlay: (p: Profile) => void;
  onDelete: (p: Profile) => void;
  onModifyCard?: (p: Profile) => void;
}

export default function ProfileCard({ profile, running, launchState, onPlay, onDelete, onModifyCard }: ProfileCardProps) {
  const { launch } = useProfileLaunch();
  const { valorant_data: vd } = profile;
  const rr = vd?.rr ?? 0;
  const tierId = vd?.tier ?? 0;
  const rankIcon = vd?.rank_icon ?? "";
  const playerCardBg = vd?.player_card_bg ?? "";
  const agentIcon = vd?.agent_display_icon ?? "";
  const rankName = VALORANT_TIER_NAMES[tierId] ?? "Unranked";
  const wins = vd?.wins ?? 0;
  const losses = vd?.losses ?? 0;

  const [copied, setCopied] = useState(false);

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (launchState === "idle") {
      launch(profile.profile_name);
      onPlay(profile);
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(profile.profile_name).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className={`card group relative overflow-hidden rounded-xl border transition-all duration-200 select-none cursor-default ${
        running ? "card-running border-amber-500/40 shadow-[0_0_30px_rgba(245,158,11,0.25)]" :
        launchState === "launching" ? "border-red-500/40 shadow-[0_0_30px_rgba(239,68,68,0.25)]" :
        "border-white/[0.08] hover:border-white/[0.18] hover:shadow-[0_8px_40px_rgba(0,0,0,0.45)]"
      }`}
      style={{ width: 280, height: 670, backgroundColor: "#0a0e14" }}
      onDoubleClick={() => handlePlay({ stopPropagation: () => {} } as React.MouseEvent)}
    >
      {/* Full playercard art background */}
      {playerCardBg ? (
        <img
          src={playerCardBg}
          alt=""
          className="absolute inset-0 w-full h-full object-contain z-0"
          style={{
            filter: "saturate(1.05) brightness(0.95)",
          }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <div
          className="absolute inset-0 z-0"
          style={{
            background: "radial-gradient(ellipse at 50% 40%, #1a2332 0%, #0a0e14 100%)",
          }}
        />
      )}

      {/* Subtle vignette */}
      <div className="absolute inset-0 z-[1]" style={{
        background: "radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(0,0,0,0.3) 100%)",
      }} />

      {/* Dark gradient at bottom for text readability */}
      <div className="absolute inset-0 z-[2]" style={{
        background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 35%, transparent 55%)",
      }} />

      {/* Top gradient for username area */}
      <div className="absolute inset-0 z-[2]" style={{
        background: "linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 30%)",
        height: "40%",
      }} />

      {/* Content layer */}
      <div className="relative z-[5] flex flex-col h-full">
        {/* Username at top */}
        <div className="flex items-center justify-center gap-2 px-4 pt-3 pb-1">
          {agentIcon && (
            <img
              src={agentIcon}
              alt=""
              className="w-[22px] h-[22px] rounded-full flex-shrink-0 border border-white/20 object-cover"
              style={{
                filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.6))",
              }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <span
            className="text-[18px] font-bold tracking-wide truncate text-center"
            style={{
              fontFamily: "'Rajdhani', 'Segoe UI', system-ui, sans-serif",
              color: "#fff",
              textShadow: "0 2px 20px rgba(0,0,0,0.9), 0 1px 4px rgba(0,0,0,0.8)",
            }}
          >
            {profile.profile_name}
          </span>
          <button
            onClick={handleCopy}
            className="flex-shrink-0 h-4 w-4 flex items-center justify-center rounded
                       bg-white/[0.06] hover:bg-white/[0.15] border border-white/[0.08]
                       text-white/50 hover:text-white/90 transition-all"
            title="Copy username"
          >
            {copied ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
              </svg>
            )}
          </button>
        </div>

        {/* Spacer pushes rank to center */}
        <div className="flex-[1.8]" />

        {/* Rank centered - the hero of the card */}
        <div className="flex flex-col items-center gap-1 px-4 pb-1">
          {rankIcon ? (
            <img
              src={rankIcon}
              alt={rankName}
              className="w-[88px] h-[88px] drop-shadow-[0_4px_20px_rgba(0,0,0,0.8)]"
              style={{
                filter: `drop-shadow(0 0 16px ${rankColor(tierId)}40)`,
              }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-[88px] h-[88px] rounded-full bg-white/5 border border-white/10" />
          )}
          <span
            className="text-[14px] font-bold uppercase tracking-widest"
            style={{
              color: rankColor(tierId),
              textShadow: `0 0 20px ${rankColor(tierId)}50, 0 2px 8px rgba(0,0,0,0.9)`,
            }}
          >
            {rankName}
          </span>
          {rr > 0 && (
            <span
              className="text-[22px] font-black leading-none"
              style={{
                color: "#fff",
                textShadow: "0 0 16px rgba(0,0,0,0.8)",
              }}
            >
              {rr} <span className="text-[11px] font-bold text-white/50">RR</span>
            </span>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-[1.2]" />

        {/* Stats row at bottom */}
        <div className="flex items-center justify-center gap-3 px-4 pb-1">
          <span className="text-[12px] font-bold" style={{ color: "#4ade80", textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}>
            {wins}W
          </span>
          <span className="text-white/20">·</span>
          <span className="text-[12px] font-bold" style={{ color: "#f87171", textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}>
            {losses}L
          </span>
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-1.5 px-3 pb-3 pt-1">
          <button
            onClick={handlePlay}
            disabled={running || launchState === "launching"}
            className={`flex-1 h-9 rounded-lg font-bold text-[13px] transition-all
                        disabled:opacity-40 disabled:cursor-not-allowed
                        active:scale-[0.97] ${
              launchState === "launched"
                ? "bg-gradient-to-r from-emerald-600 to-emerald-700 text-white shadow-lg shadow-emerald-600/25"
                : launchState === "launching"
                ? "bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg shadow-red-600/25 animate-pulse"
                : "bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg shadow-red-600/25 hover:from-red-500 hover:to-red-600 hover:shadow-red-500/40"
            }`}
          >
            {running ? "Running" : launchState === "launching" ? "Launching…" : launchState === "launched" ? "Launched ✓" : "Play"}
          </button>
          {onModifyCard && (
            <button
              onClick={(e) => { e.stopPropagation(); onModifyCard(profile); }}
              className="h-9 w-9 flex items-center justify-center rounded-lg
                         bg-white/[0.06] hover:bg-white/[0.15] border border-white/[0.08]
                         text-white/50 hover:text-white/90 transition-all"
              title="Change playercard"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="13.5" cy="6.5" r="2.5"/><circle cx="19" cy="17" r="2.5"/><circle cx="6" cy="12" r="2.5"/>
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.75 1.5-1.5 0-.39-.15-.74-.39-1.02-.23-.27-.38-.62-.38-1.01 0-.75.6-1.35 1.35-1.35H16c3.31 0 6-2.69 6-6 0-5.5-4.5-9.94-10-9.94Z"/>
              </svg>
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(profile); }}
            className="h-9 w-9 flex items-center justify-center rounded-lg
                       bg-white/[0.06] hover:bg-red-500/20 border border-white/[0.08]
                       text-white/50 hover:text-red-400 transition-all"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Running pulse animation */}
      {running && (
        <div className="absolute inset-0 z-[6] rounded-xl pointer-events-none">
          <div className="absolute inset-0 rounded-xl border-2 border-amber-400/30 card-pulse" />
        </div>
      )}
    </div>
  );
}
