export default function DashboardLoading() {
  return (
    <div className="relative z-10 max-w-5xl mx-auto space-y-10 animate-pulse">
      {/* Hero banner */}
      <div className="h-40 sm:h-48 md:h-56 rounded-xl bg-slate-200 border border-slate-200" />

      {/* Title + status badge */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-2">
          <div className="h-7 w-48 rounded bg-slate-200" />
          <div className="h-4 w-40 rounded bg-slate-100" />
        </div>
        <div className="h-6 w-20 rounded-full bg-slate-100" />
      </div>

      {/* Plan timeline + pause credits cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 h-48 rounded-xl bg-slate-100 border border-slate-200" />
        <div className="h-48 rounded-xl bg-slate-100 border border-slate-200" />
      </div>

      {/* Upcoming deliveries grid */}
      <div className="space-y-4">
        <div className="h-6 w-48 rounded bg-slate-200" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-40 rounded-xl bg-slate-100 border border-slate-200" />
          ))}
        </div>
      </div>
    </div>
  );
}
