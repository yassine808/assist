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
      className={`profile-card relative flex flex-col rounded-lg bg-bg-card border border-white/10 w-[181px] h-[200px] p-3 cursor-pointer overflow-hidden ${
        dragging ? "profile-card--dragging" : ""
      } ${profile.is_running ? "profile-card--running" : ""}`}
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={() => onPlay(profile)}
      onContextMenu={handleContextMenu}
    >
      <div className="flex items-start justify-between">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold"
          style={{
            background: `${color}22`,
            color,
            border: `1px solid ${color}`,
          }}
        >
          {rankShort(tier)}
        </div>
        <button
          className="no-drag p-1 rounded text-white/40 hover:text-white/80"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(profile);
          }}
          title="Delete profile"
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div className="mt-2 flex-1 min-h-0">
        <p className="text-sm font-semibold text-white truncate leading-tight">
          {inGame}
        </p>
        <p className="text-[11px] text-white/40 mt-0.5 truncate">
          {data.rank_name || "Unranked"}
        </p>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-white/60">
          <span>RR {data.rr ?? 0}</span>
          <span className="text-white/25">•</span>
          <span>
            W/L {data.wins ?? 0}/{data.losses ?? 0}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-white/60">
          <span>{data.top_agent ? `Agent: ${data.top_agent}` : ""}</span>
          {data.avg_combat_score ? (
            <span>ACS {data.avg_combat_score}</span>
          ) : null}
        </div>
      </div>

      <div
        className="no-drag flex items-center justify-center gap-1.5 mt-1 rounded-md py-1.5 w-full text-xs font-semibold text-black transition-colors"
        style={{ background: profile.is_running ? "#3a3a42" : "#ff4655" }}
        onClick={(e) => {
          e.stopPropagation();
          onPlay(profile);
        }}
      >
        {profile.is_running ? (
          <>
            <Square size={12} /> Stop
          </>
        ) : (
          <>
            <Play size={12} /> Play
          </>
        )}
      </div>

      <button
        className="no-drag absolute top-1 right-7 p-1 rounded text-white/40 hover:text-white/80"
        onClick={(e) => {
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        title="More"
      >
        <MoreVertical size={15} />
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
