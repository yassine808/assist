export default function SkeletonCard() {
  return (
    <div
      className="relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.06] animate-pulse"
      style={{ width: 320, height: 480, backgroundColor: '#0d1117' }}
    >
      {/* Fake agent background */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

      {/* Top: profile name */}
      <div className="relative z-10 px-4 pt-4 pb-2">
        <div className="h-4 w-28 rounded bg-white/[0.08]" />
      </div>

      <div className="flex-1" />

      {/* Bottom: rank + portrait area */}
      <div className="relative z-10 flex items-end gap-3 px-4 pb-4">
        {/* Left: rank + stats */}
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-12 h-12 rounded-xl bg-white/[0.06]" />
            <div className="space-y-1">
              <div className="h-3 w-14 rounded bg-white/[0.06]" />
              <div className="h-5 w-16 rounded bg-white/[0.06]" />
            </div>
          </div>
          <div className="h-3 w-24 rounded bg-white/[0.06]" />
          <div className="h-3 w-28 rounded bg-white/[0.06]" />
        </div>

        {/* Right: agent portrait placeholder */}
        <div className="flex-shrink-0 w-[100px] h-[180px] rounded-xl bg-white/[0.04]" />
      </div>

      {/* Toolbar */}
      <div className="relative z-10 flex items-center gap-1.5 px-4 pb-4 pt-1">
        <div className="flex-1 h-9 rounded-lg bg-white/[0.06]" />
        <div className="h-9 w-9 rounded-lg bg-white/[0.06]" />
        <div className="h-9 w-9 rounded-lg bg-white/[0.06]" />
      </div>
    </div>
  );
}
