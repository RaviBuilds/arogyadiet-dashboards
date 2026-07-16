"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { AppLoader } from "@/shared/components/loader/AppLoader";

/**
 * Profile loading fallback — mirrors the dashboard's loading.tsx pattern
 * exactly (see src/app/customer/(main)/dashboard/loading.tsx) so every page
 * in the app feels like the same product: branded loader first, skeleton
 * only cross-fades in if loading proves unusually slow (>1s).
 */
export default function ProfileLoading() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 1000);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <div
        aria-hidden="true"
        className={cn(
          "relative z-10 mx-auto max-w-5xl space-y-6 transition-opacity duration-500 sm:space-y-8",
          slow ? "opacity-100" : "opacity-0",
        )}
      >
        {/* Hero */}
        <div className="h-20 rounded-3xl bg-slate-100 sm:h-24" />

        {/* Personal Details (incl. Medical Assessment inside) */}
        <div className="h-[26rem] rounded-3xl border border-slate-200 bg-white" />

        {/* Security */}
        <div className="h-24 rounded-3xl border border-slate-200 bg-slate-100" />

        {/* Delivery Addresses */}
        <div className="h-56 rounded-3xl border border-slate-200 bg-slate-100" />

        {/* Logout */}
        <div className="h-12 rounded-2xl bg-slate-100" />
      </div>

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
        <AppLoader message="Loading your health profile…" />
      </div>
    </>
  );
}
