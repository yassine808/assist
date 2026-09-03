import { useState } from "react";
import type { Profile, ProfileGridCallbacks } from "../types/profile";
import ProfileCard from "./ProfileCard";
import SkeletonCard from "./SkeletonCard";

interface Props extends ProfileGridCallbacks {
  profiles: Profile[];
  loading: boolean;
}

export default function ProfileGrid({
  profiles,
  loading,
  onPlay,
  onDelete,
  onEdit,
  onReorder,
}: Props) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const visible = order
    ? [...profiles].sort(
        (a, b) =>
          order.indexOf(a.profile_name) - order.indexOf(b.profile_name)
      )
    : profiles;

  const commit = (next: Profile[]) => {
    setOrder(next.map((p) => p.profile_name));
    void onReorder(next.map((p) => p.profile_name));
  };

  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...visible];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next);
  };

  return (
    <div className="flex flex-wrap gap-5">
      {loading
        ? Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
        : visible.map((p, i) => (
            <div
              key={p.profile_name}
              className={
                overIndex === i && dragIndex !== null && dragIndex !== i
                  ? "profile-card--drop-target"
                  : ""
              }
            >
              <ProfileCard
                profile={p}
                running={p.is_running}
                onPlay={onPlay}
                onDelete={onDelete}
                onEdit={onEdit}
                onDragStart={() => setDragIndex(i)}
                onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
              />
            </div>
          ))}
    </div>
  );
}
