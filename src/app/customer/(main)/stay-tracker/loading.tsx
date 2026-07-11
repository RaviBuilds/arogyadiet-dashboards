export default function StayTrackerLoading() {
  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-40 rounded bg-slate-200" />
          <div className="h-4 w-56 rounded bg-slate-100" />
        </div>
        <div className="h-6 w-20 rounded-full bg-slate-100" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="h-52 rounded-xl border border-slate-200 bg-slate-100" />
        <div className="h-52 rounded-xl border border-slate-200 bg-slate-100" />
      </div>
      <div className="h-32 rounded-xl border border-slate-200 bg-slate-100" />
    </div>
  );
}
