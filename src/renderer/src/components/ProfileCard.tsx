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

interface ProfileCardProps {
  profile: Profile;
  running: boolean;
  onPlay: (p: Profile) => void;
  onDelete: (p: Profile) => void;
  onEdit: (p: Profile) => void;
}

export default function ProfileCard({ profile, running, onPlay, onDelete, onEdit }: ProfileCardProps) {
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
  const playerCardBg = vd?.player_card_bg ?? '';

  const roleColor = ROLE_COLORS[agentRole] ?? '#00d4ff';

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!running) {
      launch(profile);
      onPlay(profile);
    }
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
      {/* Background — player card or role gradient */}
      {playerCardBg ? (
        <div
          className="absolute inset-0 z-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${playerCardBg})` }}
        />
      ) : (
        <div
          className="absolute inset-0 z-0"
          style={{
            background: `linear-gradient(135deg, ${roleColor}18 0%, transparent 50%, ${roleColor}0a 100%)`,
          }}
        />
      )}

      {/* Agent Portrait — left side, large */}
      {agentPortrait && (
        <img
          src={agentPortrait}
          alt={topAgent}
          className="absolute z-[1] pointer-events-none"
          style={{
            left: -30,
            bottom: -10,
            height: '105%',
            width: 'auto',
            objectFit: 'contain',
            objectPosition: 'bottom',
            filter: 'drop-shadow(0 4px 20px rgba(0,0,0,0.6))',
          }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}

      {/* Dark overlay for text readability — stronger on right */}
      <div
        className="absolute inset-0 z-[2]"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, transparent 35%, rgba(10,14,20,0.7) 55%, rgba(10,14,20,0.95) 75%, rgba(10,14,20,1) 100%)',
        }}
      />
      <div className="absolute inset-0 z-[2] bg-gradient-to-t from-black/80 via-transparent to-black/40" />

      {/* Content layer */}
      <div className="relative z-[3] flex flex-col h-full">
        {/* Username — right-aligned over dark bg */}
        <div className="flex items-center justify-end px-5 pt-5 pb-2">
          <span
            className="text-[20px] font-bold tracking-wide truncate text-right"
            style={{
              fontFamily: "'Rajdhani', 'Segoe UI', system-ui, sans-serif",
              color: '#fff',
              textShadow: '0 2px 16px rgba(0,0,0,0.8)',
            }}
          >
            {profile.profile_name}
          </span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom section — stats right side */}
        <div className="flex flex-col items-end px-5 pb-2 gap-1">
          {/* Rank icon + RR */}
          <div className="flex items-center gap-2.5">
            {rankIcon ? (
              <img
                src={rankIcon}
                alt="Rank"
                className="w-[52px] h-[52px] drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div className="w-[52px] h-[52px] rounded-full bg-white/10" />
            )}
            <div className="flex flex-col items-end">
              <span
                className="text-[28px] font-black leading-none tracking-tight"
                style={{ color: rankColor(tierId) }}
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
            <span className="text-[13px] font-bold" style={{ color: '#4ade80' }}>
              {wins}W
            </span>
            <span className="text-white/20">·</span>
            <span className="text-[13px] font-bold" style={{ color: '#f87171' }}>
              {losses}L
            </span>
            <span className="text-white/20">·</span>
            <span className="text-[13px] font-bold text-white/60">
              {winPct}%
            </span>
          </div>

          {/* ACS */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-white/30">
              ACS
            </span>
            <span className="text-[13px] font-bold text-white/80">
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
              }}
            >
              {topAgent}
            </span>
          )}
        </div>

        {/* Buttons — pinned to very bottom */}
        <div className="flex items-center gap-1.5 px-4 pb-4 pt-2">
          <button
            onClick={handlePlay}
            disabled={running}
            className="flex-1 h-9 rounded-lg font-bold text-[13px] transition-all
                       bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/25
                       hover:from-cyan-400 hover:to-blue-500 hover:shadow-cyan-500/40
                       disabled:opacity-40 disabled:cursor-not-allowed
                       active:scale-[0.97]"
          >
            {running ? 'Running' : 'Play'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(profile); }}
            className="h-9 w-9 flex items-center justify-center rounded-lg
                       bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08]
                       text-white/50 hover:text-white/80 transition-all text-[13px]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z"/>
            </svg>
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
        <div className="absolute inset-0 z-[4] rounded-2xl pointer-events-none">
          <div className="absolute inset-0 rounded-2xl border-2 border-amber-400/30 card-pulse" />
        </div>
      )}
    </div>
  );
}
