export default function KitTrackerLoading() {
  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-44 rounded bg-slate-200" />
        <div className="h-4 w-64 rounded bg-slate-100" />
      </div>
      <div className="h-[420px] rounded-xl border border-slate-200 bg-slate-100" />
    </div>
  );
}
