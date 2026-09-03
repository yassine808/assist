export default function SkeletonCard() {
  return (
    <div
      className="relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.06] animate-pulse"
      style={{ width: 700, height: 1024, backgroundColor: '#0d1117' }}
    >
      {/* Fake agent background */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

      {/* Top: profile name */}
      <div className="relative z-10 px-5 pt-5 pb-3">
        <div className="h-6 w-36 rounded bg-white/[0.08]" />
      </div>

      <div className="flex-1" />

      {/* Bottom: rank + portrait area */}
      <div className="relative z-10 flex items-end gap-4 px-5 pb-5">
        {/* Left: rank + stats */}
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-xl bg-white/[0.06]" />
            <div className="space-y-1.5">
              <div className="h-3.5 w-16 rounded bg-white/[0.06]" />
              <div className="h-7 w-20 rounded bg-white/[0.06]" />
            </div>
          </div>
          <div className="h-4 w-28 rounded bg-white/[0.06]" />
          <div className="h-3.5 w-32 rounded bg-white/[0.06]" />
        </div>

        {/* Right: agent portrait placeholder */}
        <div className="flex-shrink-0 w-[160px] h-[280px] rounded-xl bg-white/[0.04]" />
      </div>

      {/* Toolbar */}
      <div className="relative z-10 flex items-center gap-2 px-5 pb-5 pt-2">
        <div className="flex-1 h-11 rounded-lg bg-white/[0.06]" />
        <div className="h-11 w-11 rounded-lg bg-white/[0.06]" />
        <div className="h-11 w-11 rounded-lg bg-white/[0.06]" />
      </div>
    </div>
  );
}
