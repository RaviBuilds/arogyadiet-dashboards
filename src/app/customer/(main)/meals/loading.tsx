export default function MyMealsLoading() {
  return (
    <div className="max-w-5xl mx-auto space-y-6 sm:space-y-8 animate-pulse">
      {/* Shop orders trigger */}
      <div className="flex justify-end">
        <div className="h-9 w-40 rounded-xl bg-slate-100" />
      </div>

      {/* Hero */}
      <div className="h-40 rounded-3xl border border-slate-200 bg-slate-100 sm:h-36" />

      {/* Today's meal (with image panel) */}
      <div className="space-y-4">
        <div className="h-6 w-36 rounded bg-slate-200" />
        <div className="h-56 rounded-3xl border border-slate-200 bg-slate-100 sm:h-52" />
      </div>

      {/* Progress + transformation */}
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        <div className="h-48 rounded-3xl border border-slate-200 bg-slate-100" />
        <div className="h-48 rounded-3xl border border-slate-200 bg-slate-100" />
      </div>

      {/* Nutrition journal (timeline) */}
      <div className="space-y-4 pt-2">
        <div className="h-6 w-52 rounded bg-slate-200" />
        <div className="h-96 rounded-2xl border border-slate-200 bg-slate-100" />
      </div>
    </div>
  );
}
