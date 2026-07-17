/**
 * Native splash-screen handoff helper.
 *
 * The Capacitor app loads the deployed web build inside its WebView, so the
 * JavaScript running on the device is THIS build. The native splash is shown
 * by the OS before the WebView paints; we want it to stay up until the branded
 * React loader (GlobalLoader) has actually painted its first frame, then
 * hand off with no gap — never a frame where neither is visible.
 *
 * To make that deterministic, `capacitor.config.json` sets
 * `SplashScreen.launchAutoHide: false`, and we call `hide()` from JS the moment
 * the React loader paints. A safety timeout guarantees the splash can never get
 * stuck even if that path is somehow missed.
 *
 * We reach the native plugin through `registerPlugin` (from the already-present
 * @capacitor/core) rather than a static `@capacitor/splash-screen` import, so
 * there is no extra dependency and the web build is unaffected — mirroring the
 * existing background-geolocation shim. On web, `isNativePlatform()` is false
 * and every call here is a no-op.
 */

import { Capacitor, registerPlugin } from "@capacitor/core";

interface SplashScreenPlugin {
  hide(options?: { fadeOutDuration?: number }): Promise<void>;
}

const SplashScreen = registerPlugin<SplashScreenPlugin>("SplashScreen");

/** Hardware safety net: never let the native splash linger past this, even if
 *  something upstream prevents the paint-driven hide from running. */
const SAFETY_HIDE_MS = 4000;
const STARTUP_TRACE_ENABLED = process.env.NEXT_PUBLIC_STARTUP_TRACE === "1";
const STARTUP_TRACE_ID = process.env.NEXT_PUBLIC_STARTUP_TRACE_ID ?? "unset";

let hidden = false;

function startupTrace(event: string, details: Record<string, unknown> = {}) {
  if (!STARTUP_TRACE_ENABLED) return;

  const isBrowser = typeof window !== "undefined";
  console.info("[AROGYA_STARTUP]", {
    event,
    traceId: STARTUP_TRACE_ID,
    runtime: isBrowser ? "browser" : "server",
    at: isBrowser ? performance.now().toFixed(1) : null,
    href: isBrowser ? window.location.href : null,
    ...details,
  });
}

/**
 * Dissolve the native splash. Idempotent and safe to call repeatedly. No-op on
 * web. Intended to be called once the branded React loader has painted.
 */
export function hideNativeSplash(fadeOutDuration = 250): void {
  const isBrowser = typeof window !== "undefined";
  const isNative = isBrowser && Capacitor?.isNativePlatform?.();
  startupTrace("native-hide-called", {
    hidden,
    fadeOutDuration,
    isBrowser,
    isNative,
  });

  if (hidden) {
    startupTrace("native-hide-skipped", { reason: "already-hidden" });
    return;
  }
  if (!isBrowser) {
    startupTrace("native-hide-skipped", { reason: "no-window" });
    return;
  }
  if (!isNative) {
    startupTrace("native-hide-skipped", { reason: "web-platform" });
    return;
  }

  hidden = true;
  // Fire-and-forget; the native side resolves when the fade completes.
  startupTrace("native-hide-requested", { fadeOutDuration });
  void SplashScreen.hide({ fadeOutDuration })
    .then(() => startupTrace("native-hide-resolved", { fadeOutDuration }))
    .catch((error: unknown) => {
      startupTrace("native-hide-rejected", {
        fadeOutDuration,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

/**
 * Arm a one-time safety timer that force-hides the splash after SAFETY_HIDE_MS.
 * Call this on app boot alongside the paint-driven hide.
 */
export function armSplashSafetyHide(): void {
  if (typeof window === "undefined") {
    startupTrace("native-safety-hide-skipped", { reason: "no-window" });
    return;
  }
  if (!Capacitor?.isNativePlatform?.()) {
    startupTrace("native-safety-hide-skipped", { reason: "web-platform" });
    return;
  }

  startupTrace("native-safety-hide-armed", { delay: SAFETY_HIDE_MS });
  window.setTimeout(() => {
    startupTrace("native-safety-hide-fired", { delay: SAFETY_HIDE_MS });
    hideNativeSplash(0);
  }, SAFETY_HIDE_MS);
}
