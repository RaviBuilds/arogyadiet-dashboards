export default function HealthLogsLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl p-4 md:p-6 space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-6 w-40 rounded bg-slate-200" />
        <div className="h-4 w-72 rounded bg-slate-100" />
      </div>
      <div className="h-72 rounded-xl border border-slate-200 bg-slate-100" />
      <div className="h-40 rounded-xl border border-slate-200 bg-slate-100" />
    </div>
  );
}
