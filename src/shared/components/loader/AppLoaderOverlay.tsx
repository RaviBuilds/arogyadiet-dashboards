"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { AppLoader } from "./AppLoader";
import { APP_READY_EVENT } from "./AppReadyBeacon";

/**
 * AppLoaderOverlay — the branded "opening the app" experience.
 *
 * Covers the very first paint, then dissolves once the page's real content is
 * ready (signalled by AppReadyBeacon) — not on a blind timer. At the moment
 * the dissolve begins it adds `.app-intro` to <html>, which starts the one-time
 * opening choreography. Because the content is already mounted when this fires,
 * the whole hero → sections sequence plays over real elements, perfectly in
 * sync, and the loader dissolves *as* the hero settles: the handoff is felt as
 * "I entered my dashboard", never "the loader finished".
 *
 * `.app-intro` is removed once the sequence completes so later in-app
 * navigations use the lighter page transition instead of replaying it.
 *
 * Timing:
 *   MIN_VISIBLE_MS — floor so it never flashes, even on instant loads.
 *   FALLBACK_MS    — reveal anyway if no readiness signal (non-beacon pages).
 *   MAX_VISIBLE_MS — hard safety cap.
 */
const MIN_VISIBLE_MS = 1000;
const FALLBACK_MS = 1800;
const MAX_VISIBLE_MS = 6000;
const FADE_MS = 650;

type Phase = "visible" | "leaving" | "gone";

export function AppLoaderOverlay({ message }: { message?: string }) {
  const [phase, setPhase] = useState<Phase>("visible");

  useEffect(() => {
    const now = () =>
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const start = now();
    let revealed = false;
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;

    const reveal = () => {
      if (revealed) return;
      revealed = true;

      // Start the one-time opening choreography over the now-present content,
      // and remove it once the sequence has finished.
      const root = document.documentElement;
      root.classList.add("app-intro");
      window.setTimeout(() => root.classList.remove("app-intro"), 3600);

      setPhase("leaving");
      fadeTimer = setTimeout(() => setPhase("gone"), FADE_MS);
    };

    // Reveal respecting the minimum visible floor. The `revealed` guard makes
    // any later triggers no-ops.
    const scheduleReveal = () => {
      const wait = Math.max(0, MIN_VISIBLE_MS - (now() - start));
      window.setTimeout(reveal, wait);
    };

    // Primary: wait for the page's content-ready beacon.
    if (window.__arogyaReady) {
      scheduleReveal();
    } else {
      window.addEventListener(APP_READY_EVENT, scheduleReveal, { once: true });
    }

    // Fallbacks: pages without a beacon, or a stalled load.
    const fallbackTimer = setTimeout(scheduleReveal, FALLBACK_MS);
    const maxTimer = setTimeout(reveal, MAX_VISIBLE_MS);

    return () => {
      window.removeEventListener(APP_READY_EVENT, scheduleReveal);
      if (fadeTimer) clearTimeout(fadeTimer);
      clearTimeout(fallbackTimer);
      clearTimeout(maxTimer);
    };
  }, []);

  if (phase === "gone") return null;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "fixed inset-0 flex items-center justify-center transition-opacity ease-out",
        phase === "leaving" ? "opacity-0" : "opacity-100",
      )}
      style={{
        zIndex: 2147483647,
        transitionDuration: `${FADE_MS}ms`,
        backgroundImage:
          "radial-gradient(120% 80% at 50% 118%, rgba(16,185,129,0.10) 0%, rgba(16,185,129,0) 55%), linear-gradient(to bottom, #ffffff 0%, #f4fbf6 100%)",
      }}
    >
      <AppLoader message={message} />
    </div>
  );
}
