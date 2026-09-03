import { Profile } from '../types/profile';
import { rankColor, rankShort, rankIconPath } from '../lib/ranks';
import { useProfileLaunch } from '../hooks/useProfileLaunch';
import '../styles/card-glow.css';

interface ProfileCardProps {
  profile: Profile;
  running: boolean;
  onPlay: (p: Profile) => void;
  onDelete: (p: Profile) => void;
  onEdit: (p: Profile) => void;
  onDragStart?: (p: Profile) => void;
  onDragEnd?: () => void;
}

export default function ProfileCard({ profile, running, onPlay, onDelete, onEdit }: ProfileCardProps) {
  const { launch } = useProfileLaunch();
  const { valorant_data: vd } = profile;
  const rr = vd?.rr ?? 0;
  const tierId = vd?.tier ?? 0;
  const rankName = vd?.rank_name || 'Unknown';
  const wins = vd?.wins ?? 0;
  const losses = vd?.losses ?? 0;
  const winPct = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
  const topAgent = vd?.top_agent ?? '';
  const avgScore = vd?.avg_combat_score ?? 0;
  const agentBg = vd?.agent_background ?? '';
  const agentPortrait = vd?.agent_portrait ?? '';
  const agentRole = vd?.agent_role ?? '';

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!running) {
      launch(profile);
      onPlay(profile);
    }
  };

  return (
    <div
      className={`card group relative flex flex-col overflow-hidden rounded-2xl border transition-all duration-200 select-none cursor-default ${
        running ? 'card-running border-amber-500/40 shadow-[0_0_30px_rgba(245,158,11,0.25)]' :
        'border-white/[0.08] hover:border-white/[0.18] hover:shadow-[0_8px_40px_rgba(0,0,0,0.45)]'
      }`}
      style={{
        width: 700,
        height: 1024,
        backgroundColor: '#0d1117',
      }}
      onDoubleClick={() => handlePlay({ stopPropagation: () => {} } as React.MouseEvent)}
    >
      {/* Agent Background — full bleed */}
      {agentBg && (
        <div
          className="absolute inset-0 z-0"
          style={{
            backgroundImage: `url(${agentBg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center top',
          }}
        />
      )}

      {/* Dark overlay for readability */}
      <div className="absolute inset-0 z-[1] bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
      <div className="absolute inset-0 z-[1] bg-gradient-to-r from-black/70 via-transparent to-transparent" />

      {/* Content layer */}
      <div className="relative z-[2] flex flex-col h-full">
        {/* Top bar: profile name */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <span
            className="text-[22px] font-extrabold tracking-tight truncate"
            style={{
              fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
              color: '#fff',
              textShadow: '0 2px 12px rgba(0,0,0,0.7)',
            }}
          >
            {profile.profile_name}
          </span>
          {running && (
            <span className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-400 rounded-full border border-amber-500/30">
              Running
            </span>
          )}
        </div>

        {/* Spacer — pushes content to bottom */}
        <div className="flex-1" />

        {/* Bottom section — stats + portrait */}
        <div className="flex items-end gap-4 px-5 pb-5">
          {/* Left: Rank + Stats */}
          <div className="flex-1 min-w-0">
            {/* Rank icon + rank name + RR */}
            <div className="flex items-center gap-3 mb-3">
              <img
                src={rankIconPath(tierId)}
                alt={rankName}
                className="w-16 h-16 drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div className="flex flex-col">
                <span
                  className="text-[13px] font-semibold leading-tight"
                  style={{ color: rankColor(tierId) }}
                >
                  {rankShort(tierId)}
                </span>
                <span
                  className="text-[28px] font-black leading-none tracking-tight"
                  style={{ color: '#fff' }}
                >
                  {rr}
                  <span className="text-[14px] font-bold text-white/40 ml-1">RR</span>
                </span>
              </div>
            </div>

            {/* W/L */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[14px] font-bold" style={{ color: '#4ade80' }}>
                {wins}W
              </span>
              <span className="text-white/20">·</span>
              <span className="text-[14px] font-bold" style={{ color: '#f87171' }}>
                {losses}L
              </span>
              <span className="text-white/20">·</span>
              <span className="text-[14px] font-bold text-white/60">
                {winPct}%
              </span>
            </div>

            {/* ACS + Agent */}
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium text-white/40">
                ACS <span className="text-white/70 font-bold">{avgScore}</span>
              </span>
              {topAgent && (
                <>
                  <span className="text-white/20">·</span>
                  <span className="text-[12px] font-medium text-white/40">
                    {topAgent}
                  </span>
                </>
              )}
              {agentRole && (
                <>
                  <span className="text-white/20">·</span>
                  <span className="text-[11px] font-medium text-white/30 uppercase tracking-wider">
                    {agentRole}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Right: Agent portrait */}
          {agentPortrait && (
            <div className="flex-shrink-0">
              <img
                src={agentPortrait}
                alt={topAgent}
                className="h-[280px] w-auto object-contain drop-shadow-[0_4px_20px_rgba(0,0,0,0.6)]"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
          )}
        </div>

        {/* Bottom toolbar: Play / Edit / Delete */}
        <div className="flex items-center gap-2 px-5 pb-5 pt-2">
          <button
            onClick={handlePlay}
            disabled={running}
            className="flex-1 h-11 rounded-lg font-bold text-[15px] transition-all
                       bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/25
                       hover:from-cyan-400 hover:to-blue-500 hover:shadow-cyan-500/40
                       disabled:opacity-40 disabled:cursor-not-allowed
                       active:scale-[0.97]"
          >
            {running ? 'Running' : 'Play'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(profile); }}
            className="h-11 w-11 flex items-center justify-center rounded-lg
                       bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08]
                       text-white/50 hover:text-white/80 transition-all text-[15px]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z"/>
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(profile); }}
            className="h-11 w-11 flex items-center justify-center rounded-lg
                       bg-white/[0.06] hover:bg-red-500/20 border border-white/[0.08]
                       text-white/50 hover:text-red-400 transition-all text-[15px]"
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
        <div className="absolute inset-0 z-[3] rounded-2xl pointer-events-none">
          <div className="absolute inset-0 rounded-2xl border-2 border-amber-400/30 card-pulse" />
        </div>
      )}
    </div>
  );
}
