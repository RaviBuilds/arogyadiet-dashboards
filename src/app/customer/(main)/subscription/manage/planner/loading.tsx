export default function ManagePlannerLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-44 rounded bg-slate-200" />
        <div className="h-4 w-72 rounded bg-slate-100" />
      </div>
      {/* Pause credits summary */}
      <div className="h-20 rounded-xl border border-slate-200 bg-slate-100" />
      {/* Calendar / daily roster grid */}
      <div className="h-[480px] rounded-xl border border-slate-200 bg-slate-100" />
    </div>
  );
}
