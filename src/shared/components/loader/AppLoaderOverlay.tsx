"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { AppLoader } from "./AppLoader";

/**
 * AppLoaderOverlay — the initial-load "opening the app" experience.
 *
 * Renders a full-screen branded overlay (above the page and its skeletons) on
 * first paint, keeps it visible for at least MIN_VISIBLE_MS so it always feels
 * intentional rather than flashing, then fades it away once the page is ready.
 *
 * At the moment the fade begins it adds `.app-intro` to <html>, which is the
 * single signal that gates the one-time opening choreography (and is removed
 * once it completes). This guarantees the signature is *perceived* — it starts
 * as the loader dissolves, never underneath it.
 *
 * Mounted once in the customer layout, so it plays each time the app is opened
 * (a full load) but not on client-side navigations between pages, which use
 * their own branded loading fallbacks.
 */
// Held long enough for the orbiting leaf to complete a clear revolution
// (~1.3s) so the opening reads as animated and intentional, never a flash.
const MIN_VISIBLE_MS = 1400;
const MAX_VISIBLE_MS = 5000;
const FADE_MS = 500;

type Phase = "visible" | "leaving" | "gone";

export function AppLoaderOverlay({
  message,
}: {
  message?: string;
}) {
  const [phase, setPhase] = useState<Phase>("visible");

  useEffect(() => {
    const start =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    let revealed = false;
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;

    const reveal = () => {
      if (revealed) return;
      revealed = true;
      // Starts the one-time opening choreography. Removed once the sequence
      // has finished so later in-app navigations don't replay it.
      const root = document.documentElement;
      root.classList.add("app-intro");
      window.setTimeout(() => root.classList.remove("app-intro"), 3600);
      setPhase("leaving");
      fadeTimer = setTimeout(() => setPhase("gone"), FADE_MS);
    };

    const schedule = () => {
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const wait = Math.max(0, MIN_VISIBLE_MS - (now - start));
      window.setTimeout(reveal, wait);
    };

    if (document.readyState === "complete") {
      schedule();
    } else {
      window.addEventListener("load", schedule, { once: true });
    }

    // Safety net: never let the overlay outstay its welcome on a stalled load.
    const maxTimer = setTimeout(reveal, MAX_VISIBLE_MS);

    return () => {
      window.removeEventListener("load", schedule);
      clearTimeout(maxTimer);
      if (fadeTimer) clearTimeout(fadeTimer);
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
        // Sit above any third-party floating widgets (chat launchers, etc.)
        // so nothing punches through the branded opening.
        zIndex: 2147483647,
        transitionDuration: `${FADE_MS}ms`,
        // Smooth vertical light: soft green at the base rising to clean white.
        backgroundImage:
          "radial-gradient(120% 80% at 50% 118%, rgba(16,185,129,0.10) 0%, rgba(16,185,129,0) 55%), linear-gradient(to bottom, #ffffff 0%, #f4fbf6 100%)",
      }}
    >
      <AppLoader message={message} />
    </div>
  );
}
