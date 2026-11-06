import { useEffect, useRef, useState } from "react";
import { Check, Copy, Palette, Trash2 } from "lucide-react";
import { Profile, VALORANT_TIER_NAMES } from "../types/profile";
import { rankColor } from "../lib/ranks";
import { sfx } from "../lib/sfx";
import { isAnimatedCardUrl, visibleImageSrc } from "../lib/pausedImage";
import { useAppActive } from "../hooks/useAppActive";
import type { LaunchState } from "../hooks/useProfileLaunch";
import "../styles/card-glow.css";

interface ProfileCardProps {
  profile: Profile;
  running: boolean;
  activeProfileName?: string | null;
  launchState: LaunchState;
  index?: number;
  onLaunch: (name: string) => void;
  onDelete: (p: Profile) => void;
  onModifyCard?: (p: Profile) => void;
}

function agentIconFor(vd: Profile["valorant_data"] | undefined): string {
  if (vd?.agent_display_icon) return vd.agent_display_icon;
  const bg = vd?.agent_bg ?? "";
  if (bg.includes("/agents/")) {
    const uuid = bg.split("/agents/")[1]?.split("/")[0];
    if (uuid) return `https://media.valorant-api.com/agents/${uuid}/displayicon.png`;
  }
  return "";
}

function StartIcon({ state }: Readonly<{ state: LaunchState }>) {
  return (
    <svg className={`start-icon ${state === "launching" ? "spin" : ""}`} width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2.5" y="2.5" width="19" height="19" rx="3" />
      {state === "launched"
        ? <path className="check" d="M7 12.5l3.2 3.2L17 8.8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        : <path d="M12 6.5l5.5 5.5-5.5 5.5L6.5 12z" />}
    </svg>
  );
}

export default function ProfileCard({ profile, running, activeProfileName, launchState, index = 0, onLaunch, onDelete, onModifyCard }: Readonly<ProfileCardProps>) {
  const vd = profile.valorant_data;
  const tier = vd?.tier ?? 0;
  const rr = vd?.rr ?? 0;
  const color = rankColor(tier);
  const rankName = VALORANT_TIER_NAMES[tier] ?? "Unranked";
  const agentIcon = agentIconFor(vd);
  const [copied, setCopied] = useState(false);
  const active = useAppActive();

  // Tall portrait art (the 1:2 "large" player cards) is shown whole, fitted to the width.
  // Anything else (wide / square art) keeps the cover crop so it still fills the card.
  const artRef = useRef<HTMLImageElement>(null);
  const [portrait, setPortrait] = useState(false);
  // Card art comes from valorant-api.com over the network. `loading="lazy"`
  // defers the ones below the fold; this flag swaps the charging shimmer for
  // the picture once that particular file has decoded.
  //
  // Readiness is stored as "which URL finished loading", not a boolean. A
  // boolean reset in an effect races the image cache: picking a card that the
  // picker already rendered makes `load` fire during commit, then the effect
  // flips the flag back to false and no second `load` ever arrives — the art
  // stays at opacity 0 behind the shimmer. Deriving it from the URL can never
  // go stale.
  const cardSrc = vd?.player_card_bg ?? "";
  const animatedCard = isAnimatedCardUrl(cardSrc);
  const artSrc = visibleImageSrc(cardSrc, active);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const artReady = cardSrc !== "" && loadedSrc === cardSrc;
  const measureArt = (el: HTMLImageElement | null) => {
    if (el && el.naturalWidth > 0) setPortrait(el.naturalHeight / el.naturalWidth >= 1.3);
  };
  useEffect(() => {
    const el = artRef.current;
    if (!el) return;
    // An earlier card that failed to load is hidden inline; the next selection
    // has to start visible again.
    el.style.display = "";
    measureArt(el);
  }, [cardSrc]);

  useEffect(() => {
    // An APNG has no pause API. Swapping it for a transparent still stops the
    // decoder; clearing readiness makes the charging shimmer return while the
    // original decodes again after focus.
    if (!active && animatedCard) setLoadedSrc(null);
  }, [active, animatedCard]);

  useEffect(() => {
    if (launchState === "launched") sfx.launched();
  }, [launchState]);

  const play = () => {
    if (launchState !== "idle") return;
    sfx.start();
    onLaunch(profile.profile_name);
  };

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(profile.profile_name).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const busy = launchState !== "idle";
  let btnClass = "is-idle";
  let label = activeProfileName && activeProfileName !== profile.profile_name ? "SWITCH" : "START";
  if (launchState === "launching") { btnClass = "is-launching"; label = "LAUNCHING"; }
  else if (launchState === "launched") { btnClass = "is-launched"; label = "LAUNCHED"; }
  else if (running) { btnClass = "is-running"; label = "RUNNING"; }

  let status = "READY";
  if (launchState === "launching") status = "LAUNCHING";
  else if (running || launchState === "launched") status = "ACTIVE";

  const isMe = running || launchState === "launched";

  return (
    <div className="lobby-slot" style={{ ["--i" as string]: index, ["--rank" as string]: color }}>
      <div
        className={`lobby-card ${isMe ? "is-me" : ""} ${launchState === "launching" ? "is-busy" : ""}`}
        onDoubleClick={play}
        onMouseEnter={sfx.hover}
      >
        {/* everything below is drawn in a 186x472 box (the real lobby card's proportions) and scaled to fit */}
        <div className="lobby-stage">
          <svg className="lobby-signal" width="12" height="11" viewBox="0 0 12 11" fill="currentColor" aria-hidden>
            <rect x="0" y="7" width="3" height="4" /><rect x="4.5" y="3.5" width="3" height="7.5" /><rect x="9" y="0" width="3" height="11" />
          </svg>
          <i className="lobby-caret" />

          <div className="lobby-inner">
            {/* frame: chamfered top, faint outer rail, bright rail that folds into the V, the rank kite, brackets and the two wings */}
            <svg className="lobby-outline" width="186" height="472" viewBox="0 0 186 472" aria-hidden>
              <defs>
                <linearGradient id="lf-rail" gradientUnits="userSpaceOnUse" x1="0" y1="30" x2="0" y2="435">
                  <stop offset="0" stopColor="#bfe3f2" stopOpacity="0.1" />
                  <stop offset="0.42" stopColor="#bfe3f2" stopOpacity="0.16" />
                  <stop offset="0.68" stopColor="#cfe8f6" stopOpacity="0.55" />
                  <stop offset="0.78" stopColor="#dcefff" stopOpacity="0.78" />
                  <stop offset="1" stopColor="#cfe3f5" stopOpacity="0.5" />
                </linearGradient>
                <linearGradient id="lf-body" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#14405f" stopOpacity="0.94" />
                  <stop offset="0.6" stopColor="#153a58" stopOpacity="0.95" />
                  <stop offset="1" stopColor="#24546f" stopOpacity="0.95" />
                </linearGradient>
                <linearGradient id="lf-kite" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#7f9bc4" stopOpacity="0.26" />
                  <stop offset="0.45" stopColor="#4a6788" stopOpacity="0.1" />
                  <stop offset="1" stopColor="#081522" stopOpacity="0.62" />
                </linearGradient>
              </defs>
              <path className="o-fill" d="M7.5 30L15 22H170L177.5 30V342L92.5 441L7.5 342Z" />
            </svg>

            <div className="lobby-topbar" />

            <div className="lobby-art-wrap">
              {cardSrc
                ? <>
                    {!artReady && <span className="lobby-art-charge" aria-hidden />}
                    <img
                      ref={artRef}
                      src={artSrc}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      className={`lobby-art${portrait ? " is-portrait" : ""}${artReady ? "" : " is-charging"}`}
                      onLoad={(e) => {
                        if (artSrc !== cardSrc) return;
                        measureArt(e.currentTarget);
                        setLoadedSrc(cardSrc);
                      }}
                      onError={(e) => {
                        if (artSrc !== cardSrc) return;
                        e.currentTarget.style.display = "none";
                        setLoadedSrc(cardSrc);
                      }}
                    />
                  </>
                : <div className="lobby-art lobby-art-empty" />}
              <span className="lobby-scan" />
              <div className="lobby-actions">
                {onModifyCard && <button onClick={(e) => { e.stopPropagation(); onModifyCard(profile); }} title="Customize playercard"><Palette size={12} /></button>}
                <button className="danger" onClick={(e) => { e.stopPropagation(); onDelete(profile); }} title="Delete profile"><Trash2 size={12} /></button>
              </div>
            </div>

            {/* frame lines are drawn ABOVE the art, so the art shows behind the frame */}
            <svg className="lobby-outline lobby-frame" width="186" height="472" viewBox="0 0 186 472" aria-hidden>
              <path className="o-outer" d="M3.5 60V330M181.5 60V330" />
              <path className="o-inner" d="M11.5 313V347L56 399M173.5 313V347L129 399" />
              <path className="o-rail" d="M7.5 26V342L87.5 435M177.5 26V342L97.5 435" />
              <polygon className="o-kite-fill" points="92.5,372 60,404 60,421 92.5,453 125,421 125,404" />
              <polyline className="o-kite" points="60,404 60,421 92.5,453 125,421 125,404" />
              <path className="o-bracket" d="M58 397L70 410V424M127 397L115 410V424" />
              <path className="o-tick" d="M70 418V424M115 418V424" />
              <polygon className="wing" points="19.9,349.3 54.1,383.6 54.1,400.7 19.9,366.4" />
              <polygon className="wing" points="165.1,349.3 130.9,383.6 130.9,400.7 165.1,366.4" />
            </svg>

            <span className="lobby-status">{status}</span>
            <div className="lobby-plate" title={profile.profile_name}>
              <span className="lobby-plate-name">{profile.profile_name}</span>
              <button type="button" className={`lobby-copy${copied ? " is-copied" : ""}`} onClick={copy} title="Copy username" aria-label="Copy username">
                {copied ? <Check size={12} strokeWidth={2.6} /> : <Copy size={12} strokeWidth={2.2} />}
              </button>
            </div>

            <div className="lobby-sub">
              <div>
                {agentIcon && <img src={agentIcon} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}
                <span>{rankName}{rr > 0 ? ` · ${rr} RR` : ""}</span>
              </div>
              <div className="lobby-wl"><b>{vd?.wins ?? 0}W</b><i>{vd?.losses ?? 0}L</i></div>
            </div>

            <div className="rank-emblem">
              <span className="rank-halo" />
              <span className="rank-ping" />
              {vd?.rank_icon
                ? <img src={vd.rank_icon} alt={rankName} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                : <span className="rank-none" />}
            </div>
            <i className="rank-dash" />
            <svg className="rank-mute" width="11" height="8" viewBox="0 0 11 8" aria-hidden><path d="M0 2.4h1.8L4.4.5v7L1.8 5.6H0z" fill="currentColor" /><path d="M6.3 2.6l3.2 2.8M9.5 2.6L6.3 5.4" stroke="currentColor" strokeWidth="0.9" /></svg>
          </div>
        </div>
      </div>

      <button className={`lobby-start ${btnClass}`} onClick={play} disabled={busy} onMouseEnter={sfx.hover}>
        <span className="lobby-start-label">{label}</span>
        {busy && <StartIcon state={launchState} />}
        {launchState === "launching" && <span className="lobby-bar" />}
      </button>
    </div>
  );
}