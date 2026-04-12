export default function DashboardLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <div className="h-[148px] animate-pulse rounded-[12px] border border-white/[0.08] bg-white/[0.03]" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="h-[148px] animate-pulse rounded-[12px] border border-white/[0.08] bg-white/[0.03]"
          />
        ))}
      </div>
      <div className="grid flex-1 gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.8fr)]">
        <div className="grid gap-3">
          <div className="min-h-[360px] animate-pulse rounded-[12px] border border-white/[0.08] bg-white/[0.03]" />
          <div className="min-h-[320px] animate-pulse rounded-[12px] border border-white/[0.08] bg-white/[0.03]" />
        </div>
        <div className="min-h-[683px] animate-pulse rounded-[12px] border border-white/[0.08] bg-white/[0.03]" />
      </div>
    </div>
  );
}
