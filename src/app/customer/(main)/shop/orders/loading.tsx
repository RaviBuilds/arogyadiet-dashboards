export default function ShopOrdersLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 animate-pulse">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-8 w-48 rounded bg-slate-200" />
          <div className="h-4 w-72 rounded bg-slate-100" />
        </div>
        <div className="h-9 w-32 rounded-xl bg-slate-100" />
      </div>
      <div className="h-14 rounded-xl border border-slate-200 bg-slate-100" />
      <div className="h-96 rounded-xl border border-slate-200 bg-slate-100" />
    </div>
  );
}
