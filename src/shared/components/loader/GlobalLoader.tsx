"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { AppLoader } from "./AppLoader";
import { APP_READY_EVENT } from "./AppReadyBeacon";
import { armSplashSafetyHide, hideNativeSplash } from "@/lib/capacitor/splash-screen";

/**
 * GlobalLoader — the app shell's branded loading surface.
 *
 * Mounted by the SYNCHRONOUS `customer/layout.tsx`, so its markup is in the
 * very first HTML chunk and is the FIRST thing the user sees — there is no
 * awaited server work between the document body and this component. The async
 * `(main)` layout (which reads the session) streams in behind a Suspense
 * boundary, so it can never delay this loader's first paint.
 *
 * Startup pipeline (no blank frame is possible):
 *   Native Splash → GlobalLoader (first paint) → wait → Crossfade → Page
 *
 *   1. The loader is server-rendered visible, so it paints with the first
 *      chunk — before hydration, before the session resolves.
 *   2. Only AFTER that first frame has painted (double rAF) do we hide the
 *      native splash. The branded loader is already on screen underneath, so
 *      the handoff has no gap: splash → loader, never splash → blank.
 *   3. The loader stays until BOTH the brand-minimum has elapsed AND the page
 *      is genuinely ready, then crossfades straight into the page.
 *
 * Readiness is deliberately simple and needs no per-page beacon:
 *   • Cold launch  → `DOMContentLoaded`. On a streamed SSR response this fires
 *     only once the final chunk (the fully-rendered dashboard) has arrived and
 *     parsed, so it is a correct "content is present" signal. If the document
 *     is already parsed by the time we mount, we're ready immediately.
 *   • Navigation   → the destination route committing (pathname change).
 *
 * The dismissal rule is one line and race-free: leave only when
 * `minElapsed && ready`. Fast devices are held to the brand floor; slow devices
 * are held to real readiness. A hard `max` cap guarantees we never trap the UI.
 */

// The loader is guaranteed to be visible for at least `min` on every visit —
// even if the page is instant — and stays until the page is genuinely ready if
// that takes longer. `max` is only a last-resort anti-hang cap (the real
// readiness signals — DOMContentLoaded on cold launch, route commit on
// navigation — always fire on a normal load), set high so a slow `await` is
// never cut short.
const COLD = { min: 1000, max: 15000 };
const NAV = { min: 1000, max: 15000 };

// Every customer app page emits an <AppReadyBeacon /> centrally, via the
// customer (main) template which sits inside a single empty Suspense boundary
// (see app/customer/(main)/template.tsx and layout.tsx). The template re-mounts
// on every navigation and is withheld until the page's real content resolves,
// so the beacon reliably fires for those routes — the loader waits for it
// (genuine "content is present") rather than the premature route commit.
//
// Auth/entry routes (login, signup, …) render OUTSIDE that (main) template and
// therefore emit no beacon; for them the loader falls back to releasing on the
// route commit, so it can never hang.
const NON_BEACON_PREFIXES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/update-password",
  "/auth",
];

function isBeaconRoute(pathname: string) {
  return !NON_BEACON_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
const FADE_MS = 500;
const INTRO_MS = 3600; // matches the .app-intro choreography window in globals.css
const STARTUP_TRACE_ENABLED = process.env.NEXT_PUBLIC_STARTUP_TRACE === "1";
const STARTUP_TRACE_ID = process.env.NEXT_PUBLIC_STARTUP_TRACE_ID ?? "unset";

type Mode = "cold" | "nav";
type Phase = "showing" | "leaving" | "idle";
type ReadySource =
  | "existing-ready-latch"
  | "app-ready-event"
  | "document-already-complete"
  | "window-load"
  | "navigation-pathname"
  | "max-safety-cap";

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

export function GlobalLoader({ message }: { message?: string }) {
  const pathname = usePathname();
  // Cold launch begins visible so the SSR'd markup is the branded loader.
  const [phase, setPhase] = useState<Phase>("showing");
  const [mode, setMode] = useState<Mode>("cold");
  const [traceReady, setTraceReady] = useState(false);
  const [traceMinElapsed, setTraceMinElapsed] = useState(false);

  // Machine state in refs so timers/listeners never read stale values.
  const phaseRef = useRef<Phase>("showing");
  const modeRef = useRef<Mode>("cold");
  const readyRef = useRef(false);
  const minElapsedRef = useRef(false);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const firstCommitRef = useRef(true);

  const syncTraceBadge = useCallback((ready: boolean, minElapsed: boolean) => {
    if (!STARTUP_TRACE_ENABLED) return;
    setTraceReady(ready);
    setTraceMinElapsed(minElapsed);
  }, []);

  startupTrace("global-loader-render", {
    pathname,
    phase,
    mode,
    documentReadyState: typeof document === "undefined" ? null : document.readyState,
  });

  const addTimer = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);

  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => clearTimeout(id));
    timers.current.clear();
  }, []);

  // The single dismissal rule.
  const finish = useCallback(() => {
    startupTrace("finish-check", {
      phase: phaseRef.current,
      ready: readyRef.current,
      minElapsed: minElapsedRef.current,
    });
    if (phaseRef.current !== "showing") return;
    if (!readyRef.current || !minElapsedRef.current) return;

    startupTrace("phase-showing-to-leaving", {
      mode: modeRef.current,
      ready: readyRef.current,
      minElapsed: minElapsedRef.current,
    });
    phaseRef.current = "leaving";
    setPhase("leaving");

    // Cold launch flows into the full cinematic choreography; navigation gets
    // only the light template transition.
    if (modeRef.current === "cold") {
      const root = document.documentElement;
      root.classList.add("app-intro");
      addTimer(() => root.classList.remove("app-intro"), INTRO_MS);
    }

    addTimer(() => {
      startupTrace("phase-leaving-to-idle", { mode: modeRef.current });
      phaseRef.current = "idle";
      setPhase("idle");
    }, FADE_MS);
  }, [addTimer]);

  const markReady = useCallback(
    (source: ReadySource) => {
      readyRef.current = true;
      syncTraceBadge(readyRef.current, minElapsedRef.current);
      startupTrace("readiness-received", {
        source,
        phase: phaseRef.current,
        ready: readyRef.current,
        minElapsed: minElapsedRef.current,
      });
      finish();
    },
    [finish, syncTraceBadge],
  );

  // Start (or restart) a loader session.
  const begin = useCallback(
    (nextMode: Mode) => {
      clearTimers();
      readyRef.current = false;
      minElapsedRef.current = false;
      modeRef.current = nextMode;
      phaseRef.current = "showing";
      setMode(nextMode);
      setPhase("showing");
      syncTraceBadge(false, false);

      // On a client navigation, invalidate the previous page's readiness latch
      // so this session waits for the DESTINATION page's beacon, never a stale
      // "ready" left over from the page we're leaving.
      if (nextMode === "nav" && typeof window !== "undefined") {
        window.__arogyaReady = false;
      }

      const { min, max } = nextMode === "cold" ? COLD : NAV;
      startupTrace("loader-begin", { mode: nextMode, min, max });
      addTimer(() => {
        minElapsedRef.current = true;
        syncTraceBadge(readyRef.current, minElapsedRef.current);
        startupTrace("minimum-elapsed", {
          mode: nextMode,
          ready: readyRef.current,
          minElapsed: minElapsedRef.current,
        });
        finish();
      }, min);
      addTimer(() => {
        // Safety cap only.
        startupTrace("max-safety-cap-fired", { mode: nextMode });
        readyRef.current = true;
        minElapsedRef.current = true;
        syncTraceBadge(readyRef.current, minElapsedRef.current);
        startupTrace("readiness-received", {
          source: "max-safety-cap",
          phase: phaseRef.current,
          ready: readyRef.current,
          minElapsed: minElapsedRef.current,
        });
        finish();
      }, max);
    },
    [addTimer, clearTimers, finish, syncTraceBadge],
  );

  // ── Cold launch ──────────────────────────────────────────────────────────
  useEffect(() => {
    startupTrace("global-loader-client-mounted", {
      pathname,
      documentReadyState: document.readyState,
    });
    // Hide the native splash ONLY after our first frame has actually painted.
    // Double rAF: the inner callback runs after the browser has committed the
    // paint scheduled by the outer one — the branded loader is guaranteed to be
    // on screen before the splash lifts.
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      startupTrace("native-hide-raf-1");
      raf2 = requestAnimationFrame(() => {
        startupTrace("native-hide-raf-2");
        hideNativeSplash();
      });
    });
    armSplashSafetyHide();

    // `begin` deliberately initializes the existing cold-start loader state on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    begin("cold");

    // Cold readiness: the landing page's content has actually mounted
    // (AppReadyBeacon). The page streams in behind a Suspense boundary, so this
    // is the only correct "content is present" signal — DOMContentLoaded fires
    // too early. `window.load` is a universal fallback for pages that carry no
    // beacon (both signals are always at-or-after content, never premature).
    const onAppReady = () => markReady("app-ready-event");
    const onWindowLoad = () => markReady("window-load");
    // Persistent (not `once`): every page's <AppReadyBeacon /> re-dispatches
    // this event when it mounts, so the SAME listener also delivers readiness
    // for the destination page on later client navigations.
    window.addEventListener(APP_READY_EVENT, onAppReady);
    if (window.__arogyaReady) {
      markReady("existing-ready-latch");
    } else if (document.readyState === "complete") {
      markReady("document-already-complete");
    } else {
      window.addEventListener("load", onWindowLoad, { once: true });
    }

    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      window.removeEventListener(APP_READY_EVENT, onAppReady);
      window.removeEventListener("load", onWindowLoad);
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Internal navigation: an internal <Link> click to a customer route ────
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as HTMLElement)?.closest("a");
      const href = anchor?.getAttribute("href");
      if (!anchor || !href || href.startsWith("#")) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // GlobalLoader is mounted only inside the customer portal, so every
      // same-origin internal link here IS a customer navigation. NOTE: on the
      // customer subdomain the visible paths are bare ("/dashboard",
      // "/profile", …) — the "/customer" prefix is an internal middleware
      // rewrite and never appears in the browser URL, so we must NOT require it.
      if (
        url.pathname + url.search ===
        window.location.pathname + window.location.search
      ) {
        return;
      }

      startupTrace("navigation-click-accepted", {
        from: window.location.pathname + window.location.search,
        to: url.pathname + url.search,
      });
      begin("nav");
    };

    // CAPTURE phase (the `true` below) is essential: Next.js's <Link> handles
    // the click at React's root and calls preventDefault() to run client-side
    // navigation. A bubble-phase document listener would therefore always see
    // event.defaultPrevented === true and bail. Capturing at the document runs
    // BEFORE React's handlers, so we detect the navigation intent first and can
    // start the loader, while Link still performs the actual navigation.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [begin]);

  // ── Navigation readiness ─────────────────────────────────────────────────
  useEffect(() => {
    if (firstCommitRef.current) {
      firstCommitRef.current = false; // cold launch handled on mount
      return;
    }
    // The route commit fires immediately — before the destination's content
    // resolves — so we deliberately do NOT release on it. Readiness comes from
    // the destination's <AppReadyBeacon /> (delivered by the persistent
    // APP_READY_EVENT listener), held to at least NAV.min and capped by NAV.max.
    if (isBeaconRoute(pathname)) {
      startupTrace("navigation-awaiting-beacon", { pathname });
      return;
    }
    // Fallback for any route that does not emit a beacon: release one frame
    // after commit so the destination has painted before we reveal it.
    startupTrace("navigation-pathname-committed", { pathname });
    const id = requestAnimationFrame(() => {
      startupTrace("navigation-pathname-ready-raf", { pathname });
      markReady("navigation-pathname");
    });
    return () => cancelAnimationFrame(id);
  }, [pathname, markReady]);

  if (phase === "idle") return null;

  return (
    <div
      aria-hidden="true"
      className={cn(
        // print:hidden matters beyond paper printing: pages like the invoice
        // trigger window.print() (browser "Save as PDF") shortly after load,
        // and this overlay's 1s+ minimum-visible time means it can still be
        // mounted — with a z-index above everything — at that exact moment.
        // Without this, the PDF captures the branded loader instead of the
        // actual page content underneath it. Matches the same print:hidden
        // convention already used on the sidebar/header/support button.
        "fixed inset-0 flex items-center justify-center transition-opacity ease-out print:hidden",
        phase === "leaving" ? "opacity-0" : "opacity-100",
      )}
      data-loader-mode={mode}
      data-loader-phase={phase}
      data-startup-trace-id={STARTUP_TRACE_ENABLED ? STARTUP_TRACE_ID : undefined}
      style={{
        zIndex: 2147483647,
        transitionDuration: `${FADE_MS}ms`,
        backgroundImage:
          "radial-gradient(120% 80% at 50% 118%, rgba(16,185,129,0.10) 0%, rgba(16,185,129,0) 55%), linear-gradient(to bottom, #ffffff 0%, #f4fbf6 100%)",
      }}
    >
      {STARTUP_TRACE_ENABLED ? (
        <div className="pointer-events-none absolute left-3 top-3 rounded bg-slate-950/85 px-2 py-1 font-mono text-[10px] leading-4 text-emerald-200 shadow-lg">
          <div>trace {STARTUP_TRACE_ID}</div>
          <div>
            {mode} / {phase} / ready:{String(traceReady)} / min:
            {String(traceMinElapsed)}
          </div>
        </div>
      ) : null}
      {/* Cold launch carries the copy; navigation shows the mark + halo only. */}
      <AppLoader message={mode === "cold" ? message : null} />
    </div>
  );
}
