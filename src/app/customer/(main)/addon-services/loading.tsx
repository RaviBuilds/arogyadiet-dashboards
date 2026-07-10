export default function AddonServicesLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6 space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-6 w-44 rounded bg-slate-200" />
        <div className="h-4 w-72 rounded bg-slate-100" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-40 rounded-xl border border-slate-200 bg-slate-100" />
        ))}
      </div>
      <div className="h-48 rounded-xl border border-slate-200 bg-slate-100" />
    </div>
  );
}
