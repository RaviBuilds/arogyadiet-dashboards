"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { AppLoader } from "@/shared/components/loader/AppLoader";

/**
 * Dashboard loading fallback (client navigations / streaming).
 *
 * Branded loader first — the skeleton is a true fallback that only cross-fades
 * in if loading is unusually slow (>1s), so users almost never see raw
 * skeletons. This is the reference pattern for every page's loading.tsx.
 */
export default function DashboardLoading() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 1000);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      {/* Skeleton — hidden until loading proves slow, then gently fades in */}
      <div
        aria-hidden="true"
        className={cn(
          "relative z-10 mx-auto max-w-5xl space-y-6 transition-opacity duration-500 sm:space-y-8",
          slow ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="h-48 rounded-3xl bg-emerald-100/70 sm:h-52" />
        <div className="h-44 rounded-3xl border border-orange-100 bg-orange-50" />
        <div className="h-28 rounded-3xl border border-emerald-900/10 bg-emerald-50/60" />
        <div className="h-64 rounded-3xl bg-emerald-100/60" />
        <div className="space-y-3">
          <div className="h-6 w-40 rounded bg-slate-200" />
          <div className="h-28 rounded-3xl border border-slate-200 bg-white" />
        </div>
        <div className="space-y-4">
          <div className="h-6 w-40 rounded bg-slate-200" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 sm:gap-5">
            <div className="h-48 rounded-2xl border border-slate-200 bg-slate-100 md:col-span-2" />
            <div className="h-48 rounded-2xl border border-slate-200 bg-slate-100" />
          </div>
        </div>
      </div>

      {/* Branded loader — covers the skeleton, fades out once loading is slow */}
      <div
        className={cn(
          "fixed inset-0 flex items-center justify-center transition-opacity duration-500 ease-out",
          slow ? "pointer-events-none opacity-0" : "opacity-100",
        )}
        style={{
          zIndex: 2147483646,
          backgroundImage:
            "radial-gradient(120% 80% at 50% 118%, rgba(16,185,129,0.10) 0%, rgba(16,185,129,0) 55%), linear-gradient(to bottom, #ffffff 0%, #f4fbf6 100%)",
        }}
      >
        <AppLoader message="Preparing today's wellness journey…" />
      </div>
    </>
  );
}
