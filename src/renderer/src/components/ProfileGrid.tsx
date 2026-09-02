import { useState } from "react";
import type { Profile, ProfileGridCallbacks } from "../types/profile";
import { ProfileCard } from "./ProfileCard";
import { SkeletonCard } from "./SkeletonCard";

interface Props extends ProfileGridCallbacks {
  profiles: Profile[];
  loading: boolean;
}

export function ProfileGrid({
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
    <div className="flex flex-wrap gap-4">
      {loading
        ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} index={i} />)
        : visible.map((p, i) => (
            <div
              key={p.profile_name}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => {
                e.preventDefault();
                setOverIndex(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) move(dragIndex, i);
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              className={
                overIndex === i && dragIndex !== null && dragIndex !== i
                  ? "profile-card--drop-target"
                  : ""
              }
            >
              <ProfileCard
                profile={p}
                index={i}
                dragging={dragIndex === i}
                onPlay={onPlay}
                onDelete={onDelete}
                onEdit={onEdit}
              />
            </div>
          ))}
    </div>
  );
}
