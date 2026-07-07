"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Lightweight top-of-page progress bar for App Router navigations.
 *
 * The App Router exposes no public "navigation started" event, so this
 * listens for clicks on internal <Link> anchors to START the bar, then
 * watches pathname/searchParams to detect when the new route has actually
 * committed (navigation COMPLETE) to finish and hide it. A safety timeout
 * prevents the bar from getting stuck if a click doesn't result in a
 * navigation (e.g. same route, prevented default, external link).
 */
export function RouteProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const safetyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trickleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = () => {
    if (safetyTimeoutRef.current) clearTimeout(safetyTimeoutRef.current);
    if (trickleIntervalRef.current) clearInterval(trickleIntervalRef.current);
  };

  const start = () => {
    clearTimers();
    setVisible(true);
    setProgress(15);

    // Performance mark for profiling SPA transition time
    if (typeof performance !== "undefined") {
      performance.clearMarks("route-transition-start");
      performance.mark("route-transition-start");
    }

    // Trickle the bar forward while we wait for the RSC payload to arrive,
    // so it never looks fully stalled even on slow requests.
    trickleIntervalRef.current = setInterval(() => {
      setProgress((prev) => (prev < 85 ? prev + (85 - prev) * 0.1 : prev));
    }, 200);

    // Safety net: if no navigation actually happens (same route, blocked
    // click, etc.), don't leave the bar hanging forever.
    safetyTimeoutRef.current = setTimeout(() => {
      finish();
    }, 4000);
  };

  const finish = () => {
    clearTimers();
    setProgress(100);
    setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 200);
  };

  useEffect(() => {
    // Fires whenever the committed route changes — this is our signal that
    // the navigation actually finished, regardless of how it was started.
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as HTMLElement)?.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }

      // Only trigger for same-origin navigations to a different URL.
      if (url.origin !== window.location.origin) return;
      if (url.pathname + url.search === window.location.pathname + window.location.search) {
        return;
      }

      start();
    };

    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("click", handleClick);
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;

  return (
    <div
      role="progressbar"
      aria-hidden="true"
      className="fixed top-0 left-0 z-[100] h-0.5 w-full bg-transparent"
    >
      <div
        className="h-full bg-primary shadow-[0_0_8px_theme(colors.primary)] transition-all duration-200 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
