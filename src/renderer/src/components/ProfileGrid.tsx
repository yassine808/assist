import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Profile } from "../types/profile";
import type { LaunchState } from "../hooks/useProfileLaunch";
import { SortableEngine } from "../lib/sortable";
import { sfx } from "../lib/sfx";
import ProfileCard from "./ProfileCard";
import SkeletonCard from "./SkeletonCard";

interface Props {
  profiles: Profile[];
  loading: boolean;
  launchState?: LaunchState;
  launchingProfile?: string | null;
  onLaunch: (name: string) => void;
  onDelete: (p: Profile) => void;
  onModifyCard?: (p: Profile) => void;
  /** Called with the full new order after a drag (or Alt+Arrow) finishes. */
  onReorder?: (names: string[]) => void;
}

interface SortableItemProps {
  name: string;
  index: number;
  order: number;
  engine: SortableEngine;
  profile: Profile;
  activeProfileName: string | null;
  launchState: LaunchState;
  onLaunch: (name: string) => void;
  onDelete: (p: Profile) => void;
  onModifyCard?: (p: Profile) => void;
}

function SortableItem({
  name,
  index,
  order,
  engine,
  profile,
  activeProfileName,
  launchState,
  onLaunch,
  onDelete,
  onModifyCard,
}: Readonly<SortableItemProps>) {
  // Stable per card: a new callback identity would make React detach and
  // reattach the node, wiping the card's spring state mid-drag.
  const setRef = useCallback(
    (el: HTMLDivElement | null) => engine.register(name, el),
    [engine, name]
  );

  return (
    <div
      ref={setRef}
      className="sortable-item"
      style={{ order }}
      onPointerDown={(e) => engine.pointerDown(name, e.nativeEvent)}
      onDragStart={(e) => e.preventDefault()}
      onClickCapture={(e) => {
        if (engine.consumeSuppressedClick()) { e.stopPropagation(); e.preventDefault(); }
      }}
      onKeyDown={(e) => {
        if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
        e.preventDefault();
        engine.move(name, e.key === "ArrowLeft" ? -1 : 1);
      }}
    >
      <ProfileCard
        index={index}
        profile={profile}
        running={profile.is_running}
        activeProfileName={activeProfileName}
        launchState={launchState}
        onLaunch={onLaunch}
        onDelete={onDelete}
        onModifyCard={onModifyCard}
      />
    </div>
  );
}

export default function ProfileGrid({
  profiles,
  loading,
  launchState = "idle",
  launchingProfile = null,
  onLaunch,
  onDelete,
  onModifyCard,
  onReorder,
}: Readonly<Props>) {
  const activeProfileName = profiles.find((p) => p.is_running)?.profile_name ?? null;

  const containerRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const [engine] = useState(() => new SortableEngine());
  const [liveOrder, setLiveOrder] = useState<string[] | null>(null);

  const dataNames = useMemo(() => profiles.map((p) => p.profile_name), [profiles]);

  // The DOM order never changes (moving nodes would replay every card's intro animation);
  // the visual order is applied with CSS `order`. State, not a ref, because this
  // list is rendered; keep existing members first and append newly added ones.
  const [domNames, setDomNames] = useState<string[]>(() =>
    profiles.map((profile) => profile.profile_name)
  );
  useEffect(() => {
    setDomNames((current) => {
      const next = [
        ...current.filter((name) => dataNames.includes(name)),
        ...dataNames.filter((name) => !current.includes(name)),
      ];
      return next.length === current.length && next.every((name, i) => name === current[i])
        ? current
        : next;
    });
  }, [dataNames]);

  const visualNames = useMemo(() => {
    if (!liveOrder) return dataNames;
    const kept = liveOrder.filter((n) => dataNames.includes(n));
    return [...kept, ...dataNames.filter((n) => !kept.includes(n))];
  }, [liveOrder, dataNames]);

  const byName = useMemo(() => new Map(profiles.map((p) => [p.profile_name, p])), [profiles]);
  const onReorderRef = useRef(onReorder);
  useEffect(() => {
    onReorderRef.current = onReorder;
  }, [onReorder]);

  engine.setOrder(visualNames);
  engine.setEnabled(!loading && profiles.length > 1);

  useEffect(() => {
    engine.setHandlers({
      onOrderChange: (names) => setLiveOrder(names),
      onCommit: (names, changed) => {
        if (changed) onReorderRef.current?.(names);
        setLiveOrder(null);
      },
      onLift: sfx.lift,
      onSwap: sfx.tick,
      onDrop: sfx.drop,
    });
  }, [engine]);

  useEffect(() => {
    engine.attach(containerRef.current, slotRef.current);
    const el = containerRef.current;
    let ro: ResizeObserver | undefined;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => engine.layoutChanged());
      ro.observe(el);
    }
    return () => {
      ro?.disconnect();
      engine.dispose();
    };
  }, [engine, loading]);

  // After every reorder / add / delete, glide the cards to their new slots.
  const signature = visualNames.join("\u0000") + "|" + domNames.join("\u0000");
  useLayoutEffect(() => {
    engine.layoutChanged();
  }, [engine, signature]);

  return (
    <div ref={containerRef} className="sortable-grid flex flex-wrap gap-x-8 gap-y-10">
      <div ref={slotRef} className="sort-slot" aria-hidden />
      {loading
        ? Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
        : domNames.map((name, domIndex) => {
            const p = byName.get(name);
            if (!p) return null;
            return (
              <SortableItem
                key={name}
                name={name}
                index={domIndex}
                order={visualNames.indexOf(name) + 1}
                engine={engine}
                profile={p}
                activeProfileName={activeProfileName}
                launchState={launchingProfile === p.profile_name ? launchState : "idle"}
                onLaunch={onLaunch}
                onDelete={onDelete}
                onModifyCard={onModifyCard}
              />
            );
          })}
    </div>
  );
}
