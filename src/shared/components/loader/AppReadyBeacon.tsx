"use client";

import { useEffect } from "react";

/**
 * AppReadyBeacon — a zero-render signal that a page's real content has mounted
 * and hydrated on the client.
 *
 * Placed at the very end of a page's content, it fires exactly when the whole
 * page is present in the DOM. GlobalLoader waits for this before dissolving on
 * a cold launch, so the branded loader always hands off to REAL content — never
 * a blank frame.
 *
 * Why this is needed (and DOMContentLoaded is not): the page streams in behind
 * a Suspense boundary, so `DOMContentLoaded` / `readyState` can report "done"
 * while the page's content is still streaming. This beacon only mounts once the
 * content itself is actually rendered, which is the correct readiness signal.
 *
 * It also sets a `window.__arogyaReady` latch so a loader that mounts slightly
 * later still sees that readiness already happened (no missed-event race).
 */
export const APP_READY_EVENT = "arogya:ready";

declare global {
  interface Window {
    __arogyaReady?: boolean;
  }
}

const STARTUP_TRACE_ENABLED = process.env.NEXT_PUBLIC_STARTUP_TRACE === "1";
const STARTUP_TRACE_ID = process.env.NEXT_PUBLIC_STARTUP_TRACE_ID ?? "unset";

function startupTrace(event: string) {
  if (!STARTUP_TRACE_ENABLED) return;

  console.info("[AROGYA_STARTUP]", {
    event,
    traceId: STARTUP_TRACE_ID,
    runtime: "browser",
    at: performance.now().toFixed(1),
    href: window.location.href,
  });
}

export function AppReadyBeacon() {
  useEffect(() => {
    startupTrace("app-ready-beacon-effect-mounted");
    // One frame after mount so layout/paint has settled before we hand off.
    const id = requestAnimationFrame(() => {
      startupTrace("app-ready-beacon-dispatching");
      window.__arogyaReady = true;
      window.dispatchEvent(new Event(APP_READY_EVENT));
      startupTrace("app-ready-beacon-dispatched");
    });
    return () => cancelAnimationFrame(id);
  }, []);

  return null;
}
