import { useCallback, useEffect, useState } from "react";
import { X, Shuffle, Loader2 } from "lucide-react";
import { useIPC } from "../hooks/useIPC";

const keyframes = `
@keyframes modalFadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
@keyframes backdropFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes cardIn { from { opacity: 0; transform: translateY(12px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
`;

interface PlayerCard {
  uuid: string;
  displayName: string;
  largeArt: string;
}

interface PlayerCardPickerProps {
  profileName: string;
  currentCardUrl: string;
  onClose: () => void;
  onApplied: () => void;
}

export default function PlayerCardPicker({ profileName, currentCardUrl, onClose, onApplied }: PlayerCardPickerProps) {
  const { call } = useIPC();
  const [cards, setCards] = useState<PlayerCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    void call<PlayerCard[]>("get_playercards").then((result) => {
      setCards(result ?? []);
      setLoading(false);
    });
  }, [call]);

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
    if (cards.length === 0) return;
    const randomCard = cards[Math.floor(Math.random() * cards.length)];
    void handleSelect(randomCard);
  }, [cards, handleSelect]);

  const filtered = cards.filter((c) =>
    c.displayName.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <>
      <style>{keyframes}</style>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
        onClick={onClose}
        style={{ animation: "backdropFade 0.2s ease-out" }}
      >
        <div
          className="w-[680px] max-h-[80vh] rounded-lg bg-bg-card border border-white/10 shadow-xl flex flex-col"
          onClick={(e) => e.stopPropagation()}
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
                onClick={() => void handleRandom()}
                disabled={applying || cards.length === 0}
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

          {/* Search */}
          <div className="px-5 py-3 border-b border-white/5">
            <input
              type="text"
              placeholder="Search playercards…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full h-8 px-3 rounded-md bg-white/5 border border-white/10 text-white text-sm
                         placeholder:text-white/30 focus:outline-none focus:border-riot-red/50"
              autoFocus
            />
          </div>

          {/* Grid */}
          <div
            className="flex-1 overflow-y-auto p-5"
            style={{ scrollBehavior: "smooth" }}
          >
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="text-riot-red" style={{ animation: "pulse 2s ease-in-out infinite" }} />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-white/40 text-sm text-center py-12">No playercards found</p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {filtered.map((card, index) => (
                  <button
                    key={card.uuid}
                    onClick={() => void handleSelect(card)}
                    disabled={applying}
                    className={`relative aspect-[3/4] rounded-md overflow-hidden border-2 transition-all
                               disabled:opacity-40 group ${
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
                    <img
                      src={card.largeArt}
                      alt={card.displayName}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent
                                    opacity-0 group-hover:opacity-100 transition-opacity" />
                    <span className="absolute bottom-1 left-1 right-1 text-[9px] font-semibold text-white/80
                                     truncate opacity-0 group-hover:opacity-100 transition-opacity">
                      {card.displayName}
                    </span>
                    {card.largeArt === currentCardUrl && (
                      <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-riot-red flex items-center justify-center">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
