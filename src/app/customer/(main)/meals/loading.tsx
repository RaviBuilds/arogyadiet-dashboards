export default function MyMealsLoading() {
  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-pulse">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 sm:gap-6">
        <div className="space-y-2">
          <div className="h-7 w-40 rounded bg-slate-200" />
          <div className="h-4 w-72 rounded bg-slate-100" />
        </div>
        <div className="h-9 w-32 rounded-xl bg-slate-100" />
      </div>

      {/* Today's meal */}
      <div className="space-y-4">
        <div className="h-6 w-36 rounded bg-slate-200" />
        <div className="h-32 rounded-xl border border-slate-200 bg-slate-100" />
      </div>

      {/* History table */}
      <div className="space-y-4 pt-2">
        <div className="h-6 w-52 rounded bg-slate-200" />
        <div className="h-96 rounded-xl border border-slate-200 bg-slate-100" />
      </div>
    </div>
  );
}
