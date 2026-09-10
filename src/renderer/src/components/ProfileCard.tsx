import { useState } from "react";
import { Profile, VALORANT_TIER_NAMES } from "../types/profile";
import { rankColor } from "../lib/ranks";
import { useProfileLaunch, LaunchState } from "../hooks/useProfileLaunch";
import "../styles/card-glow.css";

interface ProfileCardProps {
  profile: Profile;
  running: boolean;
  activeProfileName?: string | null;
  launchState: LaunchState;
  onDelete: (p: Profile) => void;
  onModifyCard?: (p: Profile) => void;
}

export default function ProfileCard({ profile, running, activeProfileName, launchState, onDelete, onModifyCard }: Readonly<ProfileCardProps>) {
  const { launch } = useProfileLaunch();
  const { valorant_data: vd } = profile;
  const rr = vd?.rr ?? 0;
  const tierId = vd?.tier ?? 0;
  const rankIcon = vd?.rank_icon ?? "";
  const playerCardBg = vd?.player_card_bg ?? "";
  const agentIcon = vd?.agent_display_icon ?? "";
  const topAgent = vd?.top_agent ?? "";
  // Fallback: construct displayIcon from agent_bg UUID if displayIcon is empty
  const resolvedAgentIcon = agentIcon || (() => {
    const bg = vd?.agent_bg ?? "";
    if (bg.includes("/agents/")) {
      try {
        const uuid = bg.split("/agents/")[1].split("/")[0];
        return `https://media.valorant-api.com/agents/${uuid}/displayicon.png`;
      } catch { /* ignore */ }
    }
    return "";
  })();
  const rankName = VALORANT_TIER_NAMES[tierId] ?? "Unranked";
  const wins = vd?.wins ?? 0;
  const losses = vd?.losses ?? 0;

  const [copied, setCopied] = useState(false);

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (launchState === "idle") {
      launch(profile.profile_name);
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(profile.profile_name).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  let cardBorderClass: string;
  if (running) {
    cardBorderClass = "card-running border-amber-500/40 shadow-[0_0_30px_rgba(245,158,11,0.25)]";
  } else if (launchState === "launching") {
    cardBorderClass = "border-red-500/40 shadow-[0_0_30px_rgba(239,68,68,0.25)]";
  } else {
    cardBorderClass = "border-white/[0.08] hover:border-white/[0.18] hover:shadow-[0_8px_40px_rgba(0,0,0,0.45)]";
  }

  let startButtonClass: string;
  if (launchState === "launched") {
    startButtonClass = "bg-gradient-to-b from-emerald-500 to-emerald-700 text-white shadow-lg shadow-emerald-600/30";
  } else if (launchState === "launching") {
    startButtonClass = "bg-gradient-to-b from-red-500 to-red-700 text-white shadow-lg shadow-red-600/30 animate-pulse";
  } else {
    startButtonClass = "bg-gradient-to-b from-red-500 to-red-700 text-white shadow-lg shadow-red-600/30 hover:from-red-400 hover:to-red-600 hover:shadow-red-500/50";
  }

  let startButtonText: string;
  if (launchState === "launching") {
    startButtonText = "LAUNCHING…";
  } else if (launchState === "launched") {
    startButtonText = "LAUNCHED ✓";
  } else if (running) {
    startButtonText = "RUNNING";
  } else if (activeProfileName && activeProfileName !== profile.profile_name) {
    startButtonText = "SWITCH";
  } else {
    startButtonText = "START";
  }

  return (
    <div
      className={`card group relative overflow-hidden rounded-xl border transition-all duration-200 select-none cursor-default ${cardBorderClass}`}
      style={{ width: 220, height: 525, backgroundColor: "#0a0e14" }}
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
          <span
            className="text-[15px] font-bold tracking-wide truncate text-center"
            style={{
              fontFamily: "'Rajdhani', 'Noto Sans JP', 'Yu Gothic UI', 'Yu Gothic', 'Meiryo', system-ui, sans-serif",
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
              className="w-[64px] h-[64px] rank-glow"
              style={{
                ["--rank-color" as string]: `${rankColor(tierId)}60`,
              }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-[64px] h-[64px] rounded-full bg-white/5 border border-white/10" />
          )}
          <span
            className="text-[12px] font-bold uppercase tracking-widest"
            style={{
              color: rankColor(tierId),
              textShadow: `0 0 20px ${rankColor(tierId)}50, 0 2px 8px rgba(0,0,0,0.9)`,
            }}
          >
            {rankName}
          </span>
          {rr > 0 && (
            <span
              className="text-[18px] font-black leading-none"
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

        {/* Top agent image */}
        {topAgent && resolvedAgentIcon && (
          <div className="flex flex-col items-center gap-0.5 px-4 pb-1">
            <img
              src={resolvedAgentIcon}
              alt={topAgent}
              className="w-[36px] h-[36px] object-contain"
              style={{
                filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.7))",
              }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <span
              className="text-[11px] font-bold uppercase tracking-wider"
              style={{
                color: "rgba(255,255,255,0.5)",
                textShadow: "0 1px 4px rgba(0,0,0,0.8)",
              }}
            >
              {topAgent}
            </span>
            {vd?.agent_role && (
              <span
                className="text-[10px] font-semibold uppercase tracking-widest"
                style={{
                  color: "rgba(255,255,255,0.35)",
                  textShadow: "0 1px 4px rgba(0,0,0,0.8)",
                }}
              >
                {vd.agent_role}
              </span>
            )}
          </div>
        )}

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
        <div className="flex flex-col gap-1.5 px-3 pb-3 pt-1">
          {/* Two small buttons row — up top */}
          <div className="flex gap-1.5">
            {onModifyCard && (
              <button
                onClick={(e) => { e.stopPropagation(); onModifyCard(profile); }}
                className="flex-1 h-7 flex items-center justify-center gap-1 rounded
                           bg-white/[0.06] hover:bg-white/[0.15] border border-white/[0.08]
                           text-white/50 hover:text-white/90 transition-all text-[10px] font-semibold uppercase tracking-wider"
                title="Customize playercard"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="13.5" cy="6.5" r="2.5"/><circle cx="19" cy="17" r="2.5"/><circle cx="6" cy="12" r="2.5"/>
                  <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.75 1.5-1.5 0-.39-.15-.74-.39-1.02-.23-.27-.38-.62-.38-1.01 0-.75.6-1.35 1.35-1.35H16c3.31 0 6-2.69 6-6 0-5.5-4.5-9.94-10-9.94Z"/>
                </svg>
                CUSTOMIZE
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(profile); }}
              className="flex-1 h-7 flex items-center justify-center gap-1 rounded
                         bg-white/[0.06] hover:bg-red-500/20 border border-white/[0.08]
                         text-white/50 hover:text-red-400 transition-all text-[10px] font-semibold uppercase tracking-wider"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
              </svg>
              DELETE
            </button>
          </div>
          {/* Large START button — at the bottom */}
          <button
            onClick={handlePlay}
            disabled={launchState !== "idle"}
            className={`w-full h-13 rounded font-black text-[22px] uppercase tracking-[0.3em] transition-all
                        disabled:opacity-40 disabled:cursor-not-allowed
                        active:scale-[0.98] ${startButtonClass}`}
            style={{
              fontFamily: "'Rajdhani', 'Noto Sans JP', 'Impact', 'Segoe UI', system-ui, sans-serif",
              textShadow: "0 2px 8px rgba(0,0,0,0.5)",
            }}
          >
            {startButtonText}
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
