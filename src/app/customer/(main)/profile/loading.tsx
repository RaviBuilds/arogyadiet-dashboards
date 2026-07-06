export default function ProfileLoading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 animate-pulse">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="h-7 w-40 rounded bg-slate-200" />
          <div className="h-4 w-64 rounded bg-slate-100" />
        </div>
      </div>

      {/* Profile form card */}
      <div className="h-96 rounded-xl border border-slate-200 bg-slate-100" />

      {/* Security settings */}
      <div className="border-t border-slate-200 pt-10 space-y-4">
        <div className="h-6 w-48 rounded bg-slate-200" />
        <div className="h-40 rounded-xl border border-slate-200 bg-slate-100" />
      </div>

      {/* Addresses */}
      <div className="border-t border-slate-200 pt-10 space-y-4">
        <div className="h-6 w-40 rounded bg-slate-200" />
        <div className="h-48 rounded-xl border border-slate-200 bg-slate-100" />
      </div>
    </div>
  );
}
