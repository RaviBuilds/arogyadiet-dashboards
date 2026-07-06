export default function ManageBillingLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-40 rounded bg-slate-200" />
        <div className="h-4 w-64 rounded bg-slate-100" />
      </div>
      {/* Active subscription summary */}
      <div className="h-32 rounded-xl border border-slate-200 bg-slate-100" />
      {/* Payment history table */}
      <div className="h-96 rounded-xl border border-slate-200 bg-slate-100" />
    </div>
  );
}
