export function SkeletonCard({ index }: { index: number }) {
  return (
    <div
      className="animate-pulse flex flex-col rounded-xl w-[192px] h-[216px] p-3.5"
      style={{
        animationDelay: `${index * 50}ms`,
        background: "linear-gradient(165deg, rgba(30,30,38,0.95) 0%, rgba(22,22,28,0.98) 100%)",
        border: "1px solid rgba(255,255,255,0.07)",
        boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.04), 0 1px 3px 0 rgba(0,0,0,0.3)",
      }}
    >
      <div className="flex items-start justify-between">
        <div className="w-10 h-10 rounded-xl bg-white/[0.05]" />
        <div className="flex items-center gap-0.5">
          <div className="w-7 h-7 rounded-lg bg-white/[0.04]" />
          <div className="w-7 h-7 rounded-lg bg-white/[0.04]" />
        </div>
      </div>
      <div className="mt-3.5 space-y-2 flex-1 min-h-0">
        <div className="h-3 w-4/5 rounded-md bg-white/[0.07]" />
        <div className="h-2.5 w-1/2 rounded-md bg-white/[0.04] mt-0.5" />
        <div className="mt-3 flex items-center gap-1.5">
          <div className="h-5 w-12 rounded-md bg-white/[0.04]" />
          <div className="h-5 w-14 rounded-md bg-white/[0.04]" />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-16 rounded-md bg-white/[0.03]" />
          <div className="h-2.5 w-10 rounded-md bg-white/[0.03]" />
        </div>
      </div>
      <div className="h-[30px] w-full rounded-lg bg-white/[0.05] mt-2" />
    </div>
  );
}
