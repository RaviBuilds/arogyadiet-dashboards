"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { AppLoader } from "./AppLoader";
import { APP_READY_EVENT } from "./AppReadyBeacon";

/**
 * AppLoaderOverlay — the branded "opening the app" experience.
 *
 * Covers the very first paint of a COLD app launch, then dissolves once the
 * page's real content has actually mounted (signalled by AppReadyBeacon) —
 * never on a blind timer. Because the content is already present when this
 * fires, the loader hands off directly to the real dashboard: the user only
 * ever perceives Loader → Dashboard, never Loader → Skeleton.
 *
 * At the moment the dissolve begins it adds `.app-intro` to <html>, starting
 * the one-time opening choreography (hero → ring → cards …) over the real,
 * present elements — perfectly in sync — then removes it once the sequence
 * completes so later in-app navigations use the lighter page transition.
 *
 * Determinism:
 *   - This overlay mounts with the customer layout, which mounts only on a
 *     cold launch. Internal navigations reuse the persistent layout, so the
 *     overlay never re-appears — those get the light `.reveal-page` transition.
 *   - It dissolves ONLY when real content signals readiness (or the hard
 *     safety cap), so it can never uncover an intermediate loading state.
 *
 * Timing:
 *   MIN_VISIBLE_MS — floor so the branded moment is always felt, never a flash.
 *   MAX_VISIBLE_MS — hard safety cap in case a readiness signal never arrives.
 */
const MIN_VISIBLE_MS = 900;
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

    // Reveal only when real content is ready, honouring the minimum floor so
    // the branded moment is always felt. The `revealed` guard makes any later
    // trigger a no-op.
    const scheduleReveal = () => {
      const wait = Math.max(0, MIN_VISIBLE_MS - (now() - start));
      window.setTimeout(reveal, wait);
    };

    // Primary (and only meaningful) trigger: the page's content-ready beacon.
    if (window.__arogyaReady) {
      scheduleReveal();
    } else {
      window.addEventListener(APP_READY_EVENT, scheduleReveal, { once: true });
    }

    // Safety net only: if readiness never signals (e.g. a JS error on a
    // beacon-less page), reveal anyway so the app is never trapped behind it.
    const maxTimer = setTimeout(reveal, MAX_VISIBLE_MS);

    return () => {
      window.removeEventListener(APP_READY_EVENT, scheduleReveal);
      if (fadeTimer) clearTimeout(fadeTimer);
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
