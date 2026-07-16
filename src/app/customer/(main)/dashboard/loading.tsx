import { AppLoader } from "@/shared/components/loader/AppLoader";

/**
 * Dashboard loading fallback (shown during client navigations / streaming).
 *
 * The existing skeleton renders underneath a branded overlay so users almost
 * never see the raw skeleton during normal loading — but if latency is high
 * and this fallback lingers, the calm loader simply keeps flowing over it.
 *
 * This is the reference pattern for every page's loading.tsx: render the page
 * skeleton, then layer <AppLoader /> above it.
 */
export default function DashboardLoading() {
  return (
    <>
      {/* Branded overlay (sits above floating widgets, matching the app-open loader) */}
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{
          zIndex: 2147483646,
          backgroundImage:
            "radial-gradient(120% 80% at 50% 118%, rgba(16,185,129,0.10) 0%, rgba(16,185,129,0) 55%), linear-gradient(to bottom, #ffffff 0%, #f4fbf6 100%)",
        }}
      >
        <AppLoader message="Preparing today's wellness journey…" />
      </div>

      {/* Skeleton underneath */}
      <div
        aria-hidden="true"
        className="relative z-10 mx-auto max-w-5xl space-y-6 sm:space-y-8"
      >
        {/* Zone 1 — Journey header */}
        <div className="h-48 rounded-3xl bg-emerald-100/70 sm:h-52" />

        {/* Zone 2 — Today's focus */}
        <div className="h-44 rounded-3xl border border-orange-100 bg-orange-50" />

        {/* Zone 3 — Momentum strip */}
        <div className="h-28 rounded-3xl border border-emerald-900/10 bg-emerald-50/60" />

        {/* Zone 4 — Transformation */}
        <div className="h-64 rounded-3xl bg-emerald-100/60" />

        {/* Zone 5 — Week ahead (compact week band) */}
        <div className="space-y-3">
          <div className="h-6 w-40 rounded bg-slate-200" />
          <div className="h-28 rounded-3xl border border-slate-200 bg-white" />
        </div>

        {/* Zone 6 — Manage plan */}
        <div className="space-y-4">
          <div className="h-6 w-40 rounded bg-slate-200" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 sm:gap-5">
            <div className="h-48 rounded-2xl border border-slate-200 bg-slate-100 md:col-span-2" />
            <div className="h-48 rounded-2xl border border-slate-200 bg-slate-100" />
          </div>
        </div>
      </div>
    </>
  );
}
