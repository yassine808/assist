import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { X, Shuffle, Monitor, Check } from "lucide-react";
import { useIPC } from "../hooks/useIPC";
import { useToast } from "../lib/toast";

const keyframes = `
@keyframes modalFadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
@keyframes backdropFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes cardIn { from { opacity: 0; transform: translateY(12px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes pickerCharge {
  0% { background-position: 180% 0, 0 0; }
  100% { background-position: -80% 0, 0 0; }
}
.picker-card-skeleton {
  background:
    linear-gradient(100deg, rgba(190, 225, 240, 0.03) 24%, rgba(190, 225, 240, 0.16) 48%, rgba(190, 225, 240, 0.03) 72%),
    radial-gradient(ellipse at 50% 30%, rgba(36, 64, 90, 0.65), rgba(15, 25, 35, 0.7));
  background-size: 220% 100%, 100% 100%;
  animation: pickerCharge 1.5s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .picker-card-skeleton { animation: none; }
}
`;

// Both catalogue images are 268x640 (the animated APNGs and the normal
// playercards), so every picker tile uses the same tall frame.
const TILE_SHAPE = "aspect-[67/160]";

function CardSkeleton({ delay = 0 }: Readonly<{ delay?: number }>) {
  return (
    <div className={`relative ${TILE_SHAPE} rounded-md overflow-hidden border-2 border-transparent bg-white/[0.03]`}>
      <div className="picker-card-skeleton absolute inset-0" style={{ animationDelay: `${delay}ms` }} />
    </div>
  );
}

interface PlayerCard {
  uuid: string;
  displayName: string;
  largeArt: string;
}

type Category = "static" | "animated";

interface PlayerCardPickerProps {
  profileName: string;
  currentCardUrl: string;
  onClose: () => void;
  onApplied: () => void;
}

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "animated", label: "Animated" },
  { id: "static", label: "Normal" },
];

export default function PlayerCardPicker({ profileName, currentCardUrl, onClose, onApplied }: Readonly<PlayerCardPickerProps>) {
  const { call } = useIPC();
  const toast = useToast();
  const [cards, setCards] = useState<PlayerCard[]>([]);
  const [animated, setAnimated] = useState<PlayerCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [shortcutState, setShortcutState] = useState<"idle" | "busy" | "done">("idle");
  const [filter, setFilter] = useState("");
  const [loadedArt, setLoadedArt] = useState<Record<string, boolean>>({});
  // New profiles start with an animated card, so the picker opens on that tab
  // and the static catalogue lives one click away.
  const [category, setCategory] = useState<Category>("animated");

  const markLoaded = useCallback((url: string) => {
    setLoadedArt((current) => (current[url] ? current : { ...current, [url]: true }));
  }, []);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      call<PlayerCard[]>("get_playercards").catch(() => [] as PlayerCard[]),
      window.electronAPI.getAnimatedCards().catch(() => [] as { name: string; url: string }[]),
    ]).then(([remote, local]) => {
      if (!alive) return;
      setCards(remote ?? []);
      setAnimated(
        (local ?? []).map((c) => ({ uuid: c.url, displayName: c.name, largeArt: c.url }))
      );
      setLoading(false);
    });
    return () => { alive = false; };
  }, [call]);

  const active = category === "animated" ? animated : cards;

  const handleSelect = useCallback(async (card: PlayerCard) => {
    setApplying(true);
    try {
      await call("set_playercard", { name: profileName, card_url: card.largeArt });
      onApplied();
      onClose();
    } catch (e) {
      console.error("Failed to set playercard", e);
    } finally {
      setApplying(false);
    }
  }, [call, profileName, onApplied, onClose]);

  const handleRandom = useCallback(() => {
    if (active.length === 0) return;
    const randomCard = active[Math.floor(Math.random() * active.length)]; // SonarCloud: safe — used for UI shuffle only
    void handleSelect(randomCard);
  }, [active, handleSelect]);

  const handleShortcut = useCallback(async () => {
    setShortcutState("busy");
    try {
      const result = await window.electronAPI.createProfileShortcut(profileName);
      setShortcutState("done");
      toast.show({
        kind: "success",
        title: "Desktop shortcut created",
        message: result.path,
        duration: 3000,
      });
      setTimeout(() => setShortcutState("idle"), 2000);
    } catch (e) {
      console.error("Failed to create desktop shortcut", e);
      setShortcutState("idle");
      toast.show({ kind: "error", title: "Shortcut failed", message: String(e) });
    }
  }, [profileName, toast]);

  const filtered = useMemo(
    () => active.filter((c) => c.displayName.toLowerCase().includes(filter.toLowerCase())),
    [active, filter]
  );

  let gridContent: ReactNode;
  if (loading) {
    gridContent = (
      <div className="grid grid-cols-4 gap-2" aria-label="Loading cards">
        {Array.from({ length: 8 }).map((_, index) => (
          <CardSkeleton key={index} delay={-index * 120} />
        ))}
      </div>
    );
  } else if (filtered.length === 0) {
    gridContent = (
      <p className="text-white/40 text-sm text-center py-12">
        {category === "animated" ? "No animated cards found" : "No playercards found"}
      </p>
    );
  } else {
    gridContent = (
      <div className="grid grid-cols-4 gap-2">
        {filtered.map((card, index) => {
          const loaded = loadedArt[card.largeArt] === true;
          return (
            <button
              key={card.uuid}
              onClick={() => void handleSelect(card)}
              disabled={applying}
              className={`relative ${TILE_SHAPE} rounded-md overflow-hidden border-2 transition-all
                         disabled:opacity-40 group bg-white/[0.03] ${
                card.largeArt === currentCardUrl
                  ? "border-riot-red shadow-[0_0_12px_rgba(255,70,85,0.4)]"
                  : "border-transparent hover:border-white/30"
              }`}
              style={{
                animation: `cardIn 0.35s ease-out ${index * 0.03}s both`,
                transition: "transform 0.2s ease, border-color 0.2s ease",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "scale(1.04)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = "scale(1)"; }}
            >
              {!loaded && (
                <div
                  className="picker-card-skeleton absolute inset-0"
                  style={{ animationDelay: `${-index * 120}ms` }}
                  aria-hidden="true"
                />
              )}
              <img
                src={card.largeArt}
                alt={card.displayName}
                className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
                loading="lazy"
                decoding="async"
                onLoad={() => markLoaded(card.largeArt)}
                onError={() => markLoaded(card.largeArt)}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent
                              opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="absolute bottom-1 left-1 right-1 text-[9px] font-semibold text-white/80
                               truncate opacity-0 group-hover:opacity-100 transition-opacity">
                {card.displayName}
              </span>
              {card.largeArt === currentCardUrl && (
                <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-riot-red flex items-center justify-center">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <style>{keyframes}</style>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <button
          type="button"
          aria-label="Close playercard picker"
          className="absolute inset-0 bg-black/70 cursor-default"
          onClick={onClose}
          style={{ animation: "backdropFade 0.2s ease-out" }}
        />
        <div
          className="relative w-[680px] max-h-[80vh] modal-panel flex flex-col"
          style={{ animation: "modalFadeIn 0.25s ease-out" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <div>
              <h3 className="text-white font-bold text-base">Change Playercard</h3>
              <p className="text-white/40 text-xs mt-0.5">{profileName}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleShortcut()}
                disabled={shortcutState === "busy"}
                title="Create a desktop shortcut that launches this profile directly"
                className="flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-semibold
                           text-white/70 hover:text-white bg-white/5 hover:bg-white/10
                           disabled:opacity-40 transition-colors"
              >
                {shortcutState === "done" ? <Check size={12} /> : <Monitor size={12} />}
                {shortcutState === "done" ? "Shortcut ready" : "Desktop shortcut"}
              </button>
              <button
                onClick={() => void handleRandom()}
                disabled={applying || active.length === 0}
                className="flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-semibold
                           text-white/70 hover:text-white bg-white/5 hover:bg-white/10
                           disabled:opacity-40 transition-colors"
              >
                <Shuffle size={12} /> Random
              </button>
              <button
                onClick={onClose}
                className="h-7 w-7 flex items-center justify-center rounded-md
                           bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Categories */}
          <div className="flex items-center gap-1.5 px-5 pt-3">
            {CATEGORIES.map((c) => {
              const count = c.id === "animated" ? animated.length : cards.length;
              const selected = category === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => { setCategory(c.id); setFilter(""); }}
                  className={`h-7 px-3 rounded-md text-xs font-semibold transition-colors ${
                    selected
                      ? "bg-riot-red/15 text-riot-red border border-riot-red/40"
                      : "text-white/50 hover:text-white/80 bg-white/5 hover:bg-white/10 border border-transparent"
                  }`}
                >
                  {c.label}
                  <span className={`ml-1.5 text-[10px] ${selected ? "text-riot-red/70" : "text-white/30"}`}>
                    {count || ""}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search */}
          <div className="px-5 py-3 border-b border-white/5">
            <input
              type="text"
              placeholder={category === "animated" ? "Search animated cards…" : "Search playercards…"}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full h-8 px-3 rounded-md bg-white/5 border border-white/10 text-white text-sm
                          placeholder:text-white/30 focus:outline-none focus:border-riot-red/50"
            />
          </div>

          {/* Grid */}
          <div
            className="flex-1 overflow-y-auto p-5"
            style={{ scrollBehavior: "smooth" }}
          >
            {gridContent}
          </div>
        </div>
      </div>
    </>
  );
}
