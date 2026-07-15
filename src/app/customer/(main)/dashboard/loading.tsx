export default function DashboardLoading() {
  return (
    <div className="relative z-10 mx-auto max-w-5xl space-y-6 animate-pulse sm:space-y-8">
      {/* Zone 1 — Journey header */}
      <div className="h-44 rounded-3xl bg-emerald-100/70 sm:h-48" />

      {/* Zone 2 — Today's focus */}
      <div className="h-40 rounded-3xl bg-orange-50 border border-orange-100" />

      {/* Zone 3 — Momentum strip */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-20 rounded-2xl border border-slate-200 bg-white"
          />
        ))}
      </div>

      {/* Zone 4 — Transformation spotlight */}
      <div className="h-40 rounded-3xl bg-emerald-100/60" />

      {/* Zone 5 — Manage plan */}
      <div className="space-y-5">
        <div className="h-6 w-40 rounded bg-slate-200" />
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <div className="h-48 rounded-2xl border border-slate-200 bg-slate-100 md:col-span-2" />
          <div className="h-48 rounded-2xl border border-slate-200 bg-slate-100" />
        </div>
      </div>

      {/* Upcoming deliveries grid */}
      <div className="space-y-4">
        <div className="h-6 w-48 rounded bg-slate-200" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-5">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-40 rounded-xl border border-slate-200 bg-slate-100"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
