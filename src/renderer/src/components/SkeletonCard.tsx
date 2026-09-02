export function SkeletonCard({ index }: { index: number }) {
  return (
    <div
      className="animate-pulse flex flex-col rounded-lg bg-bg-card border border-white/10 w-[181px] h-[200px] p-3"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-start justify-between">
        <div className="w-9 h-9 rounded-full bg-white/10" />
        <div className="w-5 h-5 rounded bg-white/10" />
      </div>
      <div className="mt-3 space-y-2 flex-1 min-h-0">
        <div className="h-3 w-4/5 rounded bg-white/10" />
        <div className="h-2.5 w-1/2 rounded bg-white/5" />
        <div className="h-2.5 w-2/3 rounded bg-white/5 mt-3" />
        <div className="h-2.5 w-1/2 rounded bg-white/5" />
      </div>
      <div className="h-7 w-full rounded-md bg-white/10 mt-1" />
    </div>
  );
}
