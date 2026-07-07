"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Client-side performance instrumentation.
 * Measures time from navigation start to hydration complete.
 * Only active when NEXT_PUBLIC_PERF_TIMING=1.
 *
 * Logs to browser console:
 * - Navigation → First Byte (responseStart - navigationStart)
 * - First Byte → DOM Content Loaded
 * - DOM Content Loaded → Hydration Complete (this component's useEffect fires)
 * - Total: Navigation Start → Hydration Complete
 * - Route transition time (for SPA navigations)
 *
 * [Req 13.1-13.6] This component is rendered once inside the persistent
 * CustomerLayout, which does NOT remount when the App Router swaps only the
 * child page segment during an SPA navigation. The original implementation
 * relied on this component's own re-render to detect subsequent
 * navigations, but a persistent layout has no reliable re-render trigger on
 * every route change. The fix: read `usePathname()` and put it in the
 * `useEffect` dependency array, so the logging logic re-executes on every
 * committed route change (a change in the returned pathname string),
 * regardless of whether CustomerLayout itself re-renders.
 */
export function HydrationTimer() {
  const pathname = usePathname();
  const isFirstPathnameRef = useRef(true);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_PERF_TIMING !== "1") return;

    const now = performance.now();

    if (isFirstPathnameRef.current) {
      // [Req 13.4] Full-page-load branch — fires exactly once, on the true
      // initial mount only. This ref is never reset by subsequent pathname
      // changes, so it cannot re-fire even though the effect itself now
      // re-runs on every navigation.
      isFirstPathnameRef.current = false;

      // Wait a tick for performance entries to be available
      requestAnimationFrame(() => {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        if (nav) {
          console.group("⏱ [PERF] Client Hydration Timing (full page load)");
          console.log(`  DNS + TCP + TLS: ${(nav.connectEnd - nav.connectStart).toFixed(1)}ms`);
          console.log(`  Request → First Byte (TTFB): ${(nav.responseStart - nav.requestStart).toFixed(1)}ms`);
          console.log(`  Response download: ${(nav.responseEnd - nav.responseStart).toFixed(1)}ms`);
          console.log(`  DOM Content Loaded: ${(nav.domContentLoadedEventEnd - nav.startTime).toFixed(1)}ms`);
          console.log(`  Load event: ${(nav.loadEventEnd - nav.startTime).toFixed(1)}ms`);
          console.log(`  Hydration complete (useEffect): ${now.toFixed(1)}ms from page start`);
          console.log(`  Total startTime → interactive: ${now.toFixed(1)}ms`);
          console.groupEnd();
        }
      });
      return;
    }

    // [Req 13.1, 13.2, 13.3] SPA transition branch — re-executes on every
    // committed route change because `pathname` is in the dependency array
    // below, not because of remounting.
    const marks = performance.getEntriesByName("route-transition-start", "mark");
    const lastMark = marks[marks.length - 1];
    if (lastMark) {
      // [Req 13.5] Only log when a real mark exists — no fabricated or
      // reused duration for navigations without a preceding mark (e.g. a
      // programmatic router.push outside RouteProgressBar's click handler).
      const transitionTime = now - lastMark.startTime;
      console.log(`⏱ [PERF] SPA route transition: ${transitionTime.toFixed(1)}ms (click → hydrated)`);
      // [Req 13.6] Clear the mark after use so it cannot be reused on the
      // next navigation (prevents stale-mark reuse / physically impossible
      // repeated timestamps).
      performance.clearMarks("route-transition-start");
    }
  }, [pathname]);

  return null;
}
