export default function SubscriptionLoading() {
  return (
    <div className="max-w-6xl mx-auto space-y-10 animate-pulse">
      {/* Header */}
      <div className="space-y-2">
        <div className="h-7 w-48 rounded bg-slate-200" />
        <div className="h-4 w-80 rounded bg-slate-100" />
      </div>

      {/* Current subscription summary */}
      <div className="h-44 rounded-xl border border-slate-200 bg-slate-100" />

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-80 rounded-xl border border-slate-200 bg-slate-100" />
        ))}
      </div>
    </div>
  );
}
