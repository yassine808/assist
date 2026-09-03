import { memo, useRef, useState } from "react";
import { Play, Square, Trash2, MoreVertical } from "lucide-react";
import type { Profile } from "../types/profile";
import { rankColor, rankShort, rankIconPath } from "../lib/ranks";
import { ContextMenu } from "./ContextMenu";

interface Props {
  profile: Profile;
  index: number;
  dragging: boolean;
  onPlay: (p: Profile) => void;
  onDelete: (p: Profile) => void;
  onEdit: (p: Profile) => void;
}

export const ProfileCard = memo(function ProfileCard({
  profile,
  index,
  dragging,
  onPlay,
  onDelete,
  onEdit,
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const data = profile.valorant_data ?? ({} as Profile["valorant_data"]);
  const tier = data.tier ?? 0;
  const color = rankColor(tier);
  const inGame =
    profile.valorant_in_game_name || profile.profile_name || "Unknown#0000";
  const wins = data.wins ?? 0;
  const losses = data.losses ?? 0;
  const totalGames = wins + losses;
  const winPct = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const menuItems = [
    { id: "play", label: profile.is_running ? "Stop" : "Play" },
    { id: "edit", label: "Edit profile" },
    { id: "delete", label: "Delete", danger: true },
  ];

  return (
    <div
      ref={cardRef}
      className={`profile-card relative flex flex-col rounded-xl w-[200px] h-[240px] p-3.5 cursor-default overflow-hidden ${
        dragging ? "profile-card--dragging" : ""
      } ${profile.is_running ? "profile-card--running" : ""}`}
      style={{
        animationDelay: `${index * 50}ms`,
        background: `linear-gradient(165deg, rgba(30,30,38,0.95) 0%, rgba(22,22,28,0.98) 100%)`,
        border: "1px solid rgba(255,255,255,0.07)",
        boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.04), 0 1px 3px 0 rgba(0,0,0,0.3)",
      }}
      onContextMenu={handleContextMenu}
    >
      {/* Top row: rank icon + actions */}
      <div className="flex items-start justify-between">
        <div className="relative">
          {(() => {
            const iconPath = rankIconPath(tier);
            return iconPath ? (
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center overflow-hidden"
                style={{
                  background: `linear-gradient(135deg, ${color}20 0%, ${color}08 100%)`,
                  border: `1px solid ${color}40`,
                  boxShadow: `0 0 16px ${color}18`,
                }}
              >
                <img
                  src={iconPath}
                  alt={rankShort(tier)}
                  className="w-11 h-11 object-contain"
                  draggable={false}
                />
              </div>
            ) : (
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center text-sm font-bold tracking-wide"
                style={{
                  background: `linear-gradient(135deg, ${color}20 0%, ${color}08 100%)`,
                  color,
                  border: `1px solid ${color}40`,
                  boxShadow: `0 0 16px ${color}18, inset 0 1px 0 0 ${color}20`,
                }}
              >
                {rankShort(tier)}
              </div>
            );
          })()}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            className="no-drag p-1.5 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/5 transition-all duration-150"
            onClick={(e) => {
              e.stopPropagation();
              setMenu({ x: e.clientX, y: e.clientY });
            }}
            title="More"
          >
            <MoreVertical size={14} />
          </button>
          <button
            className="no-drag p-1.5 rounded-lg text-white/30 hover:text-red-400/80 hover:bg-red-500/10 transition-all duration-150"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(profile);
            }}
            title="Delete profile"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Profile info */}
      <div className="mt-3 flex-1 min-h-0">
        <p className="text-[15px] font-bold text-white/95 truncate leading-tight tracking-[-0.02em]"
           style={{ fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif" }}
        >
          {inGame}
        </p>
        <p
          className="text-[12px] mt-1 truncate font-semibold"
          style={{ color }}
        >
          {data.rank_name || "Unranked"}
        </p>

        {/* RR */}
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-[22px] font-extrabold text-white/90 tabular-nums leading-none"
                style={{ fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif" }}
          >
            {data.rr ?? 0}
          </span>
          <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">RR</span>
        </div>

        {/* Win/Loss */}
        <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold tabular-nums">
          <span className="text-emerald-400">{wins}W</span>
          <span className="text-white/15">/</span>
          <span className="text-red-400">{losses}L</span>
          <span className="text-white/15">·</span>
          <span className="text-white/50">{winPct}%</span>
        </div>

        {/* ACS + Agent */}
        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-white/40 font-medium">
          {data.top_agent ? (
            <span className="truncate">{data.top_agent}</span>
          ) : null}
          {data.top_agent && data.avg_combat_score ? (
            <span className="text-white/15">·</span>
          ) : null}
          {data.avg_combat_score ? (
            <span className="tabular-nums">ACS {data.avg_combat_score}</span>
          ) : null}
        </div>
      </div>

      {/* Play / Stop button — only this triggers launch */}
      <button
        className="no-drag group/btn flex items-center justify-center gap-1.5 mt-2 rounded-lg py-[8px] w-full text-[12px] font-bold tracking-wide transition-all duration-200 cursor-pointer"
        style={{
          background: profile.is_running
            ? "rgba(255,255,255,0.06)"
            : "linear-gradient(135deg, #ff4655 0%, #d32f2f 100%)",
          color: profile.is_running ? "rgba(255,255,255,0.7)" : "#fff",
          boxShadow: profile.is_running
            ? "inset 0 1px 0 0 rgba(255,255,255,0.05)"
            : "0 2px 8px -1px rgba(255,70,85,0.35), inset 0 1px 0 0 rgba(255,255,255,0.15)",
          border: profile.is_running
            ? "1px solid rgba(255,255,255,0.06)"
            : "1px solid rgba(255,255,255,0.1)",
        }}
        onClick={(e) => {
          e.stopPropagation();
          onPlay(profile);
        }}
      >
        {profile.is_running ? (
          <>
            <Square size={11} className="opacity-70" /> Stop
          </>
        ) : (
          <>
            <Play size={11} className="fill-current" /> Play
          </>
        )}
      </button>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onSelect={(id) => {
            setMenu(null);
            if (id === "play") onPlay(profile);
            else if (id === "edit") onEdit(profile);
            else if (id === "delete") onDelete(profile);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
});
