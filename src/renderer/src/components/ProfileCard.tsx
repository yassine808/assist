import { useState } from 'react';
import { Profile } from '../types/profile';
import { rankColor, rankIconUrl } from '../lib/ranks';
import { useProfileLaunch } from '../hooks/useProfileLaunch';
import '../styles/card-glow.css';

const ROLE_COLORS: Record<string, string> = {
  Duelist: '#ff4655',
  Initiator: '#00b8d4',
  Controller: '#00c853',
  Sentinel: '#ffc107',
};

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '').replace(/ff$/i, '');
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

interface ProfileCardProps {
  profile: Profile;
  running: boolean;
  onPlay: (p: Profile) => void;
  onDelete: (p: Profile) => void;
}

export default function ProfileCard({ profile, running, onPlay, onDelete }: ProfileCardProps) {
  const { launch } = useProfileLaunch();
  const { valorant_data: vd } = profile;
  const rr = vd?.rr ?? 0;
  const tierId = vd?.tier ?? 0;
  const wins = vd?.wins ?? 0;
  const losses = vd?.losses ?? 0;
  const winPct = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
  const topAgent = vd?.top_agent ?? '';
  const avgScore = vd?.avg_combat_score ?? 0;
  const agentPortrait = vd?.agent_portrait ?? '';
  const agentRole = vd?.agent_role ?? '';
  const rankIcon = vd?.rank_icon ?? '';
  const agentBg = vd?.agent_bg ?? '';
  const agentBgColors = vd?.agent_bg_colors ?? [];
  const playerCardBg = vd?.player_card_bg ?? '';

  const roleColor = ROLE_COLORS[agentRole] ?? '#00d4ff';

  const [copied, setCopied] = useState(false);

  // Build gradient from agent background colors (4 colors from VALORANT API)
  const c = agentBgColors.length >= 4 ? agentBgColors : ['0f1923ff', '0f1923ff', '0f1923ff', '0f1923ff'];
  const cardGradient = `radial-gradient(ellipse at 20% 80%, ${hexToRgba(c[0], 0.6)} 0%, transparent 50%),
                         radial-gradient(ellipse at 80% 20%, ${hexToRgba(c[3], 0.5)} 0%, transparent 50%),
                         radial-gradient(ellipse at 50% 50%, ${hexToRgba(c[1], 0.3)} 0%, transparent 70%),
                         linear-gradient(135deg, ${hexToRgba(c[0], 0.9)} 0%, ${hexToRgba(c[1], 0.95)} 50%, ${hexToRgba(c[2], 1)} 100%)`;

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!running) {
      launch(profile);
      onPlay(profile);
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(profile.profile_name).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className={`card group relative overflow-hidden rounded-2xl border transition-all duration-200 select-none cursor-default ${
        running ? 'card-running border-amber-500/40 shadow-[0_0_30px_rgba(245,158,11,0.25)]' :
        'border-white/[0.08] hover:border-white/[0.18] hover:shadow-[0_8px_40px_rgba(0,0,0,0.45)]'
      }`}
      style={{ width: 320, height: 480, backgroundColor: '#0a0e14' }}
      onDoubleClick={() => handlePlay({ stopPropagation: () => {} } as React.MouseEvent)}
    >
      {/* Layer 0: Agent background art (full bleed, covers entire card) */}
      {agentBg && (
        <div
          className="absolute inset-0 z-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${agentBg})`,
            filter: 'saturate(1.2) brightness(1.1)',
          }}
        />
      )}

      {/* Layer 1: Gradient overlay from agent's backgroundGradientColors */}
      <div
        className="absolute inset-0 z-[1]"
        style={{ background: agentBg ? cardGradient : 'transparent' }}
      />

      {/* Layer 2: Player card art as secondary background (if available) */}
      {playerCardBg && (
        <div
          className="absolute inset-0 z-[2] bg-cover bg-center opacity-30"
          style={{ backgroundImage: `url(${playerCardBg})` }}
        />
      )}

      {/* Agent Portrait — left side, bigger, dramatic positioning */}
      {agentPortrait && (
        <img
          src={agentPortrait}
          alt={topAgent}
          className="absolute z-[3] pointer-events-none"
          style={{
            left: -40,
            bottom: 0,
            height: '130%',
            width: 'auto',
            objectFit: 'contain',
            objectPosition: 'bottom',
            filter: 'drop-shadow(0 4px 30px rgba(0,0,0,0.7))',
          }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}

      {/* Layer 4: Darkness for text readability — stronger gradient on right */}
      <div
        className="absolute inset-0 z-[4]"
        style={{
          background: `linear-gradient(90deg,
            transparent 0%,
            transparent 25%,
            rgba(10,14,20,0.4) 40%,
            rgba(10,14,20,0.75) 55%,
            rgba(10,14,20,0.95) 75%,
            rgba(10,14,20,1) 100%)`,
        }}
      />

      {/* Bottom vignette for depth */}
      <div className="absolute inset-0 z-[4] bg-gradient-to-t from-black/90 via-black/20 to-black/30" />

      {/* Top vignette for polish */}
      <div className="absolute inset-0 z-[4] bg-gradient-to-b from-black/50 via-transparent to-transparent" style={{ height: '40%' }} />

      {/* Content layer */}
      <div className="relative z-[5] flex flex-col h-full">
        {/* Username — centered with copy button on right */}
        <div className="flex items-center justify-center gap-2 px-5 pt-5 pb-2">
          <span
            className="text-[20px] font-bold tracking-wide truncate text-center"
            style={{
              fontFamily: "'Rajdhani', 'Segoe UI', system-ui, sans-serif",
              color: '#fff',
              textShadow: '0 2px 20px rgba(0,0,0,0.9), 0 1px 4px rgba(0,0,0,0.8)',
            }}
          >
            {profile.profile_name}
          </span>
          <button
            onClick={handleCopy}
            className="flex-shrink-0 h-6 w-6 flex items-center justify-center rounded
                       bg-white/[0.06] hover:bg-white/[0.15] border border-white/[0.08]
                       text-white/50 hover:text-white/90 transition-all"
            title="Copy username"
          >
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
              </svg>
            )}
          </button>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom section — stats */}
        <div className="flex flex-col items-end px-5 pb-2 gap-1">
          {/* Rank icon + RR */}
          <div className="flex items-center gap-2.5">
            {rankIcon ? (
              <img
                src={rankIcon}
                alt="Rank"
                className="w-[52px] h-[52px] drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)]"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div className="w-[52px] h-[52px] rounded-full bg-white/10" />
            )}
            <div className="flex flex-col items-end">
              <span
                className="text-[28px] font-black leading-none tracking-tight"
                style={{
                  color: rankColor(tierId),
                  textShadow: `0 0 20px ${rankColor(tierId)}40, 0 2px 8px rgba(0,0,0,0.8)`,
                }}
              >
                {rr}
              </span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-white/30">
                RR
              </span>
            </div>
          </div>

          {/* W/L */}
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-bold" style={{ color: '#4ade80', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
              {wins}W
            </span>
            <span className="text-white/20">·</span>
            <span className="text-[13px] font-bold" style={{ color: '#f87171', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
              {losses}L
            </span>
            <span className="text-white/20">·</span>
            <span className="text-[13px] font-bold text-white/60" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
              {winPct}%
            </span>
          </div>

          {/* ACS */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-white/30">
              ACS
            </span>
            <span className="text-[13px] font-bold text-white/80" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
              {avgScore}
            </span>
          </div>

          {/* Agent name */}
          {topAgent && (
            <span
              className="text-[13px] font-semibold tracking-wide"
              style={{
                fontFamily: "'Rajdhani', 'Segoe UI', system-ui, sans-serif",
                color: roleColor,
                textShadow: `0 0 12px ${roleColor}60, 0 1px 4px rgba(0,0,0,0.8)`,
              }}
            >
              {topAgent}
            </span>
          )}
        </div>

        {/* Buttons — Play (red VALORANT theme) + Delete */}
        <div className="flex items-center gap-1.5 px-4 pb-4 pt-2">
          <button
            onClick={handlePlay}
            disabled={running}
            className="flex-1 h-9 rounded-lg font-bold text-[13px] transition-all
                       bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg shadow-red-600/25
                       hover:from-red-500 hover:to-red-600 hover:shadow-red-500/40
                       disabled:opacity-40 disabled:cursor-not-allowed
                       active:scale-[0.97]"
          >
            {running ? 'Running' : 'Play'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(profile); }}
            className="h-9 w-9 flex items-center justify-center rounded-lg
                       bg-white/[0.06] hover:bg-red-500/20 border border-white/[0.08]
                       text-white/50 hover:text-red-400 transition-all text-[13px]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Running pulse animation */}
      {running && (
        <div className="absolute inset-0 z-[6] rounded-2xl pointer-events-none">
          <div className="absolute inset-0 rounded-2xl border-2 border-amber-400/30 card-pulse" />
        </div>
      )}
    </div>
  );
}
