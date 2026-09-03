import { memo, useRef, useState } from "react";
import { Play, Square, Trash2, MoreVertical } from "lucide-react";
import type { Profile } from "../types/profile";
import { rankColor, rankShort } from "../lib/ranks";
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
      className={`profile-card relative flex flex-col rounded-xl w-[192px] h-[216px] p-3.5 cursor-pointer overflow-hidden ${
        dragging ? "profile-card--dragging" : ""
      } ${profile.is_running ? "profile-card--running" : ""}`}
      style={{
        animationDelay: `${index * 50}ms`,
        background: `linear-gradient(165deg, rgba(30,30,38,0.95) 0%, rgba(22,22,28,0.98) 100%)`,
        border: "1px solid rgba(255,255,255,0.07)",
        boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.04), 0 1px 3px 0 rgba(0,0,0,0.3)",
      }}
      onClick={() => onPlay(profile)}
      onContextMenu={handleContextMenu}
    >
      {/* Top row: rank badge + actions */}
      <div className="flex items-start justify-between">
        <div className="relative">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-[11px] font-bold tracking-wide"
            style={{
              background: `linear-gradient(135deg, ${color}18 0%, ${color}08 100%)`,
              color,
              border: `1px solid ${color}40`,
              boxShadow: `0 0 12px ${color}15, inset 0 1px 0 0 ${color}20`,
            }}
          >
            {rankShort(tier)}
          </div>
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
      <div className="mt-2.5 flex-1 min-h-0">
        <p className="text-[13px] font-semibold text-white/95 truncate leading-tight tracking-[-0.01em]">
          {inGame}
        </p>
        <p
          className="text-[11px] mt-1 truncate font-medium"
          style={{ color: `${color}cc` }}
        >
          {data.rank_name || "Unranked"}
        </p>
        <div className="mt-2.5 flex items-center gap-1.5 text-[10.5px]">
          <span className="px-1.5 py-0.5 rounded-md bg-white/[0.04] text-white/50 font-medium tabular-nums">
            RR {data.rr ?? 0}
          </span>
          <span className="text-white/15">·</span>
          <span className="text-white/50 font-medium tabular-nums">
            {data.wins ?? 0}W {data.losses ?? 0}L
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-white/35">
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

      {/* Play / Stop button */}
      <button
        className="no-drag group/btn flex items-center justify-center gap-1.5 mt-2 rounded-lg py-[7px] w-full text-[11.5px] font-bold tracking-wide transition-all duration-200"
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
