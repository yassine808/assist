import { useState } from 'react';
import { Profile } from '../types/profile';
import { rankColor } from '../lib/ranks';
import { useProfileLaunch, LaunchState } from '../hooks/useProfileLaunch';
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
  launchState: LaunchState;
  onPlay: (p: Profile) => void;
  onDelete: (p: Profile) => void;
  onModifyCard?: (p: Profile) => void;
}

export default function ProfileCard({ profile, running, launchState, onPlay, onDelete, onModifyCard }: ProfileCardProps) {
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
  const cardGradient = `radial-gradient(ellipse at 20% 80%, ${hexToRgba(c[0], 0.35)} 0%, transparent 50%),
                         radial-gradient(ellipse at 80% 20%, ${hexToRgba(c[3], 0.25)} 0%, transparent 50%),
                         radial-gradient(ellipse at 50% 50%, ${hexToRgba(c[1], 0.15)} 0%, transparent 70%),
                         linear-gradient(135deg, ${hexToRgba(c[0], 0.5)} 0%, ${hexToRgba(c[1], 0.6)} 50%, ${hexToRgba(c[2], 0.7)} 100%)`;

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (launchState === 'idle') {
      launch(profile.profile_name);
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
      className={`card group relative overflow-hidden rounded-xl border transition-all duration-200 select-none cursor-default ${
        running ? 'card-running border-amber-500/40 shadow-[0_0_30px_rgba(245,158,11,0.25)]' :
        launchState === 'launching' ? 'border-red-500/40 shadow-[0_0_30px_rgba(239,68,68,0.25)]' :
        'border-white/[0.08] hover:border-white/[0.18] hover:shadow-[0_8px_40px_rgba(0,0,0,0.45)]'
      }`}
      style={{ width: 280, height: 400, backgroundColor: '#0a0e14' }}
      onDoubleClick={() => handlePlay({ stopPropagation: () => {} } as React.MouseEvent)}
    >
      {/* Layer 0: Agent background art */}
      {agentBg && (
        <div
          className="absolute inset-0 z-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${agentBg})`,
            filter: 'saturate(1.1) brightness(1.25)',
          }}
        />
      )}

      {/* Layer 1: Gradient overlay */}
      <div
        className="absolute inset-0 z-[1]"
        style={{ background: agentBg ? cardGradient : 'transparent' }}
      />

      {/* Layer 2: Player card art */}
      {playerCardBg && (
        <div
          className="absolute inset-0 z-[2] bg-cover bg-center opacity-30"
          style={{ backgroundImage: `url(${playerCardBg})` }}
        />
      )}

      {/* Agent Portrait */}
      {agentPortrait && (
        <img
          src={agentPortrait}
          alt={topAgent}
          className="absolute z-[3] pointer-events-none"
          style={{
            left: -20,
            bottom: 0,
            width: 340,
            height: 'auto',
            objectFit: 'cover',
            objectPosition: 'bottom',
            filter: 'drop-shadow(0 4px 30px rgba(0,0,0,0.7))',
          }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}

      {/* Darkness for text readability */}
      <div
        className="absolute inset-0 z-[4]"
        style={{
          background: `linear-gradient(90deg,
            transparent 0%,
            transparent 30%,
            rgba(10,14,20,0.3) 45%,
            rgba(10,14,20,0.6) 60%,
            rgba(10,14,20,0.85) 75%,
            rgba(10,14,20,0.95) 100%)`,
        }}
      />

      {/* Bottom vignette */}
      <div className="absolute inset-0 z-[4] bg-gradient-to-t from-black/70 via-black/10 to-black/20" />

      {/* Top vignette */}
      <div className="absolute inset-0 z-[4] bg-gradient-to-b from-black/50 via-transparent to-transparent" style={{ height: '40%' }} />

      {/* Content layer */}
      <div className="relative z-[5] flex flex-col h-full">
        {/* Username */}
        <div className="flex items-center justify-center gap-1.5 px-4 pt-4 pb-1">
          <span
            className="text-[17px] font-bold tracking-wide truncate text-center"
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
            className="flex-shrink-0 h-5 w-5 flex items-center justify-center rounded
                       bg-white/[0.06] hover:bg-white/[0.15] border border-white/[0.08]
                       text-white/50 hover:text-white/90 transition-all"
            title="Copy username"
          >
            {copied ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
              </svg>
            )}
          </button>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Stats section */}
        <div className="flex flex-col items-end px-4 pb-2 gap-0.5">
          {/* Rank icon + RR */}
          <div className="flex items-center gap-2">
            {rankIcon ? (
              <img
                src={rankIcon}
                alt="Rank"
                className="w-[44px] h-[44px] drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)]"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div className="w-[44px] h-[44px] rounded-full bg-white/10" />
            )}
            <div className="flex flex-col items-end">
              <span
                className="text-[24px] font-black leading-none tracking-tight"
                style={{
                  color: rankColor(tierId),
                  textShadow: `0 0 20px ${rankColor(tierId)}40, 0 2px 8px rgba(0,0,0,0.8)`,
                }}
              >
                {rr}
              </span>
              <span className="text-[9px] font-bold uppercase tracking-wider text-white/30">
                RR
              </span>
            </div>
          </div>

          {/* W/L */}
          <div className="flex items-center gap-1">
            <span className="text-[12px] font-bold" style={{ color: '#4ade80', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
              {wins}W
            </span>
            <span className="text-white/20">·</span>
            <span className="text-[12px] font-bold" style={{ color: '#f87171', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
              {losses}L
            </span>
            <span className="text-white/20">·</span>
            <span className="text-[12px] font-bold text-white/60" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
              {winPct}%
            </span>
          </div>

          {/* ACS */}
          <div className="flex items-center gap-1">
            <span className="text-[9px] font-medium uppercase tracking-wider text-white/30">
              ACS
            </span>
            <span className="text-[12px] font-bold text-white/80" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
              {avgScore}
            </span>
          </div>

          {/* Agent name */}
          {topAgent && (
            <span
              className="text-[12px] font-semibold tracking-wide"
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

        {/* Buttons */}
        <div className="flex items-center gap-1 px-3 pb-3 pt-1.5">
          <button
            onClick={handlePlay}
            disabled={running || launchState === 'launching'}
            className={`flex-1 h-8 rounded-lg font-bold text-[12px] transition-all
                        disabled:opacity-40 disabled:cursor-not-allowed
                        active:scale-[0.97] ${
              launchState === 'launched'
                ? 'bg-gradient-to-r from-emerald-600 to-emerald-700 text-white shadow-lg shadow-emerald-600/25'
                : launchState === 'launching'
                ? 'bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg shadow-red-600/25 animate-pulse'
                : 'bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg shadow-red-600/25 hover:from-red-500 hover:to-red-600 hover:shadow-red-500/40'
            }`}
          >
            {running ? 'Running' : launchState === 'launching' ? 'Launching…' : launchState === 'launched' ? 'Launched ✓' : 'Play'}
          </button>
          {onModifyCard && (
            <button
              onClick={(e) => { e.stopPropagation(); onModifyCard(profile); }}
              className="h-8 w-8 flex items-center justify-center rounded-lg
                         bg-white/[0.06] hover:bg-white/[0.15] border border-white/[0.08]
                         text-white/50 hover:text-white/90 transition-all"
              title="Change playercard"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="13.5" cy="6.5" r="2.5"/><circle cx="19" cy="17" r="2.5"/><circle cx="6" cy="12" r="2.5"/>
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.75 1.5-1.5 0-.39-.15-.74-.39-1.02-.23-.27-.38-.62-.38-1.01 0-.75.6-1.35 1.35-1.35H16c3.31 0 6-2.69 6-6 0-5.5-4.5-9.94-10-9.94Z"/>
              </svg>
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(profile); }}
            className="h-8 w-8 flex items-center justify-center rounded-lg
                       bg-white/[0.06] hover:bg-red-500/20 border border-white/[0.08]
                       text-white/50 hover:text-red-400 transition-all"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Running pulse animation */}
      {running && (
        <div className="absolute inset-0 z-[6] rounded-xl pointer-events-none">
          <div className="absolute inset-0 rounded-xl border-2 border-amber-400/30 card-pulse" />
        </div>
      )}
    </div>
  );
}
