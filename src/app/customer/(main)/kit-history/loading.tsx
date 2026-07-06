export default function KitHistoryLoading() {
  return (
    <div className="relative z-10 max-w-5xl mx-auto space-y-6 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-full bg-slate-100 shrink-0" />
        <div className="space-y-2">
          <div className="h-7 w-40 rounded bg-slate-200" />
          <div className="h-4 w-64 rounded bg-slate-100" />
        </div>
      </div>
      <div className="h-96 rounded-xl border border-slate-200 bg-slate-100" />
    </div>
  );
}
