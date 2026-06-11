export default function CustomersLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="h-24 rounded-2xl bg-slate-100 border border-slate-200" />
      {/* KPI row skeleton */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 rounded-2xl bg-slate-100 border border-slate-200" />
        ))}
      </div>
      {/* Table skeleton */}
      <div className="h-96 rounded-2xl bg-slate-100 border border-slate-200" />
    </div>
  );
}
