export default function CheckoutLoading() {
  return (
    <div className="bg-slate-50/50 min-h-screen animate-pulse">
      <div className="mx-auto max-w-5xl px-4 py-10 space-y-6">
        <div className="h-8 w-56 rounded bg-slate-200" />
        <div className="h-24 rounded-xl border border-slate-200 bg-slate-100" />
        <div className="h-96 rounded-xl border border-slate-200 bg-slate-100" />
      </div>
    </div>
  );
}
