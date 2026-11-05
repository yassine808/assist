import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  // the visual order is applied with CSS `order`.
  const domRef = useRef<string[]>([]);
  domRef.current = [
    ...domRef.current.filter((n) => dataNames.includes(n)),
    ...dataNames.filter((n) => !domRef.current.includes(n)),
  ];

  const visualNames = useMemo(() => {
    if (!liveOrder) return dataNames;
    const kept = liveOrder.filter((n) => dataNames.includes(n));
    return [...kept, ...dataNames.filter((n) => !kept.includes(n))];
  }, [liveOrder, dataNames]);

  // Ref callbacks must keep a stable identity: React re-invokes a changed callback on every render
  // (null, then the element), which would wipe each card's spring state in the middle of a drag.
  // The cache is never pruned: deleting an entry on detach would hand React a *new* callback on the
  // next render, which detaches and re-attaches every card's ref (and resets its spring) again.
  const refCache = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const refFor = (name: string) => {
    let cb = refCache.current.get(name);
    if (!cb) {
      cb = (el) => engine.register(name, el);
      refCache.current.set(name, cb);
    }
    return cb;
  };

  const byName = useMemo(() => new Map(profiles.map((p) => [p.profile_name, p])), [profiles]);
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

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
  const signature = visualNames.join("\u0000") + "|" + domRef.current.join("\u0000");
  useLayoutEffect(() => {
    engine.layoutChanged();
  }, [engine, signature]);

  return (
    <div ref={containerRef} className="sortable-grid flex flex-wrap gap-x-8 gap-y-10">
      <div ref={slotRef} className="sort-slot" aria-hidden />
      {loading
        ? Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
        : domRef.current.map((name, domIndex) => {
            const p = byName.get(name);
            if (!p) return null;
            return (
              <div
                key={name}
                ref={refFor(name)}
                className="sortable-item"
                style={{ order: visualNames.indexOf(name) + 1 }}
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
                  index={domIndex}
                  profile={p}
                  running={p.is_running}
                  activeProfileName={activeProfileName}
                  launchState={launchingProfile === p.profile_name ? launchState : "idle"}
                  onLaunch={onLaunch}
                  onDelete={onDelete}
                  onModifyCard={onModifyCard}
                />
              </div>
            );
          })}
    </div>
  );
}
