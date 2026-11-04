import { useEffect, useState } from "react";
import { Check, Copy, Palette, Trash2 } from "lucide-react";
import { Profile, VALORANT_TIER_NAMES } from "../types/profile";
import { rankColor } from "../lib/ranks";
import { sfx } from "../lib/sfx";
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

  const hasSweep = tier >= 18;
  const isMe = running || launchState === "launched";

  return (
    <div className="lobby-slot" style={{ ["--i" as string]: index, ["--rank" as string]: color }}>
      <div
        className={`lobby-card ${isMe ? "is-me" : ""} ${launchState === "launching" ? "is-busy" : ""}`}
        onDoubleClick={play}
        onMouseEnter={sfx.hover}
      >
        <svg className="lobby-signal" width="14" height="12" viewBox="0 0 14 12" fill="currentColor" aria-hidden>
          <rect x="0" y="8" width="3" height="4" /><rect x="5" y="4" width="3" height="8" /><rect x="10" y="0" width="3" height="12" />
        </svg>

        <div className="lobby-inner">
          {/* open banner outline, exactly like the lobby: hollow body, pointed bottom, double line */}
          <svg className="lobby-outline" width="196" height="470" viewBox="0 0 196 470" aria-hidden>
            <polygon className="o-fill" points="0.5,0.5 195.5,0.5 195.5,372 98,469.5 0.5,372" />
            <polygon className="o-line" points="0.5,0.5 195.5,0.5 195.5,372 98,469.5 0.5,372" />
            <path className="o-line o-inner" d="M5.5 321 V369.5 L98 460 L190.5 369.5 V321" />
          </svg>

          <div className="lobby-topbar" />

          <div className="lobby-art-wrap">
            {vd?.player_card_bg
              ? <img src={vd.player_card_bg} alt="" className="lobby-art" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              : <div className="lobby-art lobby-art-empty" />}
            <div className="lobby-shade" />
            <div className="lobby-sheen" />

            <div className="lobby-actions">
              <button onClick={copy} title="Copy username">{copied ? <Check size={12} /> : <Copy size={12} />}</button>
              {onModifyCard && <button onClick={(e) => { e.stopPropagation(); onModifyCard(profile); }} title="Customize playercard"><Palette size={12} /></button>}
              <button className="danger" onClick={(e) => { e.stopPropagation(); onDelete(profile); }} title="Delete profile"><Trash2 size={12} /></button>
            </div>

            <span className="lobby-status">{status}</span>
            <div className="lobby-plate" title={profile.profile_name}>
              {isMe && <i className="plate-mark" />}
              <span className="lobby-plate-name">{profile.profile_name}</span>
            </div>
          </div>

          <div className="lobby-sub">
            <div>
              {agentIcon && <img src={agentIcon} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}
              <span>{rankName}{rr > 0 ? ` · ${rr} RR` : ""}</span>
            </div>
            <div className="lobby-wl"><b>{vd?.wins ?? 0}W</b><i>{vd?.losses ?? 0}L</i></div>
          </div>

          {isMe && <><span className="lobby-wing l" /><span className="lobby-wing r" /></>}

          <div className={`rank-emblem ${hasSweep ? "has-sweep" : ""} ${tier >= 27 ? "is-radiant" : ""}`}>
            <span className="rank-sweep" />
            <span className="rank-diamond" />
            {vd?.rank_icon
              ? <img src={vd.rank_icon} alt={rankName} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              : <span className="rank-none" />}
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
