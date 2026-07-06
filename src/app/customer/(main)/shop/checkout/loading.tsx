export default function ShopCheckoutLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="space-y-2">
        <div className="h-8 w-56 rounded bg-slate-200" />
        <div className="h-4 w-80 rounded bg-slate-100" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
        <div className="space-y-6 lg:col-span-2">
          <div className="h-40 rounded-xl border border-slate-200 bg-slate-100" />
          <div className="h-56 rounded-xl border border-slate-200 bg-slate-100" />
        </div>
        <div className="space-y-6 lg:col-span-1">
          <div className="h-40 rounded-xl border border-slate-200 bg-slate-100" />
          <div className="h-56 rounded-xl border border-slate-200 bg-slate-100" />
        </div>
      </div>
    </div>
  );
}
