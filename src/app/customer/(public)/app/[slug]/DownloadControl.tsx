"use client";

// src/app/customer/(public)/app/[slug]/DownloadControl.tsx
// The only client component in the app distribution feature. Manages the
// Cloudflare Turnstile widget lifecycle, the download grant API call, and the
// download trigger. An explicit state union rather than a cluster of booleans,
// because Req 5 enumerates eight distinct visitor-facing states and a boolean
// soup makes "disabled but for which reason" unrepresentable.
//
// WIDGET STARTUP — the widget is rendered from the Turnstile script's `onReady`
// callback, never from a mount effect. `next/script` loads `api.js`
// asynchronously, so at hydration time `window.turnstile` is reliably undefined:
// an effect that checks for it early-returns and, with nothing to re-trigger it,
// never runs again. `onReady` fires after the script evaluates AND fires
// immediately when the script is already present from an earlier navigation,
// which covers both the cold and warm cases with one path.
//
// The widget id lives in a ref rather than state on purpose. Holding it in state
// and depending on it made the render effect re-trigger itself, stacking a
// second and third widget into the same container while the first was still
// solving. A ref also means `expired-callback` reads the current id instead of
// closing over the `null` it was created with.
//
// Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.13, 5.14,
//               7.8, 9.3, 11.1, 11.2, 11.3

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Script from "next/script";
import {
  Download,
  Loader2,
  AlertTriangle,
  RefreshCw,
  XCircle,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppSlug } from "@/lib/appDistribution/slug";

// Explicit state union per design. Each state has a clear visitor-facing
// representation and determines whether the download button is enabled.
type DownloadState =
  | { kind: "LOADING_WIDGET" }
  | { kind: "AWAITING_CHALLENGE" }
  | { kind: "READY"; token: string }
  | { kind: "REQUESTING" }
  | { kind: "DOWNLOADING"; version: string }
  | { kind: "RATE_LIMITED"; retryAfterSeconds: number }
  | { kind: "CHALLENGE_FAILED" }
  | { kind: "WIDGET_UNAVAILABLE" }
  | { kind: "ERROR"; message: string };

interface DownloadControlProps {
  slug: AppSlug;
  siteKey: string;
}

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js";

/**
 * How long to wait for the widget to produce a token before giving up.
 *
 * Without this the control can sit in `LOADING_WIDGET` indefinitely when the
 * script is blocked by an extension or a filtering DNS resolver — `onError`
 * does not fire in every blocking scenario. A bounded wait means the visitor
 * gets a real message instead of a button that is disabled for no stated reason.
 */
const WIDGET_WATCHDOG_MS = 12_000;

// ---------------------------------------------------------------------------
// Apple-device detection
// ---------------------------------------------------------------------------
// Read through `useSyncExternalStore` rather than a setState-in-effect, which
// is what React 19 wants for a browser value the component only observes: the
// server snapshot is `false`, so the markup Next.js prerenders is the Android
// variant and the Apple notice appears on hydration.
//
// Detection stays client-side on purpose (Req 11.1): sniffing the user agent on
// the server would vary the cached HTML per visitor and defeat `revalidate`.
//
// `mac os` is included because iPadOS Safari reports a Macintosh user agent. It
// also matches a desktop Mac, which is fine — neither can install an APK.

/** No-op subscribe: the user agent cannot change during a page's lifetime. */
const subscribeToNothing = () => () => {};

/** Primitive return value, so referential stability is not a concern. */
const getIsAppleDevice = (): boolean =>
  /iphone|ipad|ipod|mac os/.test(navigator.userAgent.toLowerCase());

/** During prerender there is no user agent to read. */
const getIsAppleDeviceOnServer = (): boolean => false;

// ---------------------------------------------------------------------------
// Turnstile widget type declarations
// ---------------------------------------------------------------------------

interface TurnstileRenderOptions {
  sitekey: string;
  callback?: (token: string) => void;
  "error-callback"?: () => void;
  "expired-callback"?: () => void;
  /** Fires when an interactive challenge is left unsolved long enough to lapse. */
  "timeout-callback"?: () => void;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "compact";
  /** `auto` re-attempts a failed challenge without the visitor doing anything. */
  retry?: "auto" | "never";
  "retry-interval"?: number;
  /** `auto` silently fetches a fresh token when the current one expires. */
  "refresh-expired"?: "auto" | "manual" | "never";
  /** `interaction-only` keeps the widget invisible unless a challenge is needed. */
  appearance?: "always" | "execute" | "interaction-only";
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: TurnstileRenderOptions,
      ) => string | undefined;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

export function DownloadControl({ slug, siteKey }: DownloadControlProps) {
  const [state, setState] = useState<DownloadState>({ kind: "LOADING_WIDGET" });
  const widgetContainerRef = useRef<HTMLDivElement>(null);

  /** Current widget id, read by reset/remove. A ref so callbacks never go stale. */
  const widgetIdRef = useRef<string | null>(null);
  /** Guards against a second render into the same container. */
  const hasRenderedRef = useRef(false);

  // Apple devices cannot install an APK, so the control and the widget are both
  // suppressed while the rest of the page keeps rendering (Req 11.1, 11.2, 11.3).
  const isIos = useSyncExternalStore(
    subscribeToNothing,
    getIsAppleDevice,
    getIsAppleDeviceOnServer,
  );

  // The button is enabled in exactly one state (Req 5.4, 5.5).
  const isButtonDisabled = state.kind !== "READY";

  /**
   * Renders the widget. Invoked from the script's `onReady`, so by the time it
   * runs `window.turnstile` is guaranteed to exist and the container has already
   * been painted.
   */
  const renderWidget = useCallback(() => {
    if (hasRenderedRef.current) return;

    const container = widgetContainerRef.current;
    const turnstile = window.turnstile;
    if (!container || typeof turnstile?.render !== "function") return;

    // Set before rendering, not after: a concurrent second invocation must not
    // be able to slip past the guard while `render` is still running.
    hasRenderedRef.current = true;

    const id = turnstile.render(container, {
      sitekey: siteKey,
      theme: "light",
      size: "normal",
      // Recover without visitor action wherever Turnstile allows it, so a
      // transient failure or an expired token does not strand the button.
      retry: "auto",
      "retry-interval": 2000,
      "refresh-expired": "auto",

      // Challenge passed → token in hand, button becomes enabled (Req 5.5).
      callback: (token: string) => setState({ kind: "READY", token }),

      // Challenge errored (Req 5.8).
      "error-callback": () => setState({ kind: "CHALLENGE_FAILED" }),

      // Token expired → discard it, reset the widget, await a fresh one (Req 5.9).
      "expired-callback": () => {
        if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
        setState({ kind: "AWAITING_CHALLENGE" });
      },

      // An interactive challenge lapsed before it was solved.
      "timeout-callback": () => {
        if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
        setState({ kind: "AWAITING_CHALLENGE" });
      },
    });

    widgetIdRef.current = id ?? null;

    // Managed mode frequently resolves fast enough that `callback` has already
    // moved us to READY. Only advance the state if we are still waiting, so this
    // cannot clobber a token that has already arrived.
    setState((previous) =>
      previous.kind === "LOADING_WIDGET" ? { kind: "AWAITING_CHALLENGE" } : previous,
    );
  }, [siteKey]);

  // Watchdog: if no token has appeared well after load, say so rather than
  // leaving a silently disabled button. setState here runs from a timer, not
  // synchronously in the effect body.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setState((previous) =>
        previous.kind === "LOADING_WIDGET" ? { kind: "WIDGET_UNAVAILABLE" } : previous,
      );
    }, WIDGET_WATCHDOG_MS);

    return () => window.clearTimeout(timer);
  }, []);

  // Tear the widget down on unmount so a client-side navigation back to this
  // page starts from a clean container instead of an orphaned iframe.
  useEffect(() => {
    return () => {
      if (widgetIdRef.current) window.turnstile?.remove(widgetIdRef.current);
      widgetIdRef.current = null;
      hasRenderedRef.current = false;
    };
  }, []);

  /** Resets the widget and returns to awaiting a fresh challenge. */
  const resetChallenge = useCallback(() => {
    if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
    setState({ kind: "AWAITING_CHALLENGE" });
  }, []);

  // POST to the grant endpoint, then trigger the download.
  const handleDownload = async () => {
    if (state.kind !== "READY") return;

    const { token } = state;
    setState({ kind: "REQUESTING" });

    try {
      const response = await fetch("/api/app-download/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, token }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 429) {
          // Rate limited (Req 7.8). Prefer the header, fall back to the body.
          const header = response.headers.get("Retry-After");
          const retryAfterSeconds =
            (header ? Number.parseInt(header, 10) : NaN) ||
            data.retryAfterSeconds ||
            60;
          setState({ kind: "RATE_LIMITED", retryAfterSeconds });
        } else if (response.status === 403) {
          setState({ kind: "CHALLENGE_FAILED" });
        } else {
          setState({
            kind: "ERROR",
            message: "Download temporarily unavailable. Please try again.",
          });
        }

        // The token is spent either way, so re-arm the widget for a retry.
        if (response.status !== 429) {
          if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
        }
        return;
      }

      // Success. Assigning the signed URL navigates, and because the response
      // carries `Content-Disposition: attachment` the browser downloads the file
      // without leaving the page (Req 5.7, 9.3).
      const { url, version } = data as { url: string; version: string };
      setState({ kind: "DOWNLOADING", version });
      window.location.href = url;

      // A Turnstile token is single-use, so re-arm for a possible second
      // download instead of letting the visitor hit a confusing 403.
      window.setTimeout(resetChallenge, 1500);
    } catch {
      setState({
        kind: "ERROR",
        message: "Network error. Please check your connection and try again.",
      });
      if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
    }
  };

  /** Script failed to load at all → the verification step is unavailable (Req 5.10). */
  const handleScriptError = () => setState({ kind: "WIDGET_UNAVAILABLE" });

  const getStateMessage = (): string => {
    switch (state.kind) {
      case "LOADING_WIDGET":
        return "Starting security check…";
      case "AWAITING_CHALLENGE":
        return "Running a quick security check.";
      case "READY":
        return "Verified. You're ready to install.";
      case "REQUESTING":
        return "Preparing your download…";
      case "DOWNLOADING":
        return `Downloading version ${state.version}…`;
      case "RATE_LIMITED": {
        const minutes = Math.max(1, Math.ceil(state.retryAfterSeconds / 60));
        return `Download limit reached. Please try again in ${minutes} minute${minutes > 1 ? "s" : ""}.`;
      }
      case "CHALLENGE_FAILED":
        return "Verification failed. Please try again.";
      case "WIDGET_UNAVAILABLE":
        return "The security check could not load. Please retry later.";
      case "ERROR":
        return state.message;
    }
  };

  const getButtonLabel = (): string => {
    switch (state.kind) {
      case "LOADING_WIDGET":
      case "AWAITING_CHALLENGE":
      case "READY":
        return "Download App";
      case "REQUESTING":
      case "DOWNLOADING":
        return "Downloading…";
      case "RATE_LIMITED":
        return "Limit Reached";
      case "CHALLENGE_FAILED":
        return "Retry Verification";
      case "WIDGET_UNAVAILABLE":
      case "ERROR":
        return "Unavailable";
    }
  };

  const getButtonIcon = () => {
    switch (state.kind) {
      case "LOADING_WIDGET":
      case "AWAITING_CHALLENGE":
        return <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />;
      case "READY":
        return <Download className="h-4 w-4" aria-hidden="true" />;
      case "REQUESTING":
      case "DOWNLOADING":
        return <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />;
      case "RATE_LIMITED":
        return <AlertTriangle className="h-4 w-4" aria-hidden="true" />;
      case "CHALLENGE_FAILED":
        return <RefreshCw className="h-4 w-4" aria-hidden="true" />;
      case "WIDGET_UNAVAILABLE":
      case "ERROR":
        return <XCircle className="h-4 w-4" aria-hidden="true" />;
    }
  };

  // Apple devices: suppress the control and the widget, leave the rest of the
  // page intact (Req 11.1, 11.2, 11.3).
  if (isIos) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
        <p className="text-sm font-semibold text-amber-900">iOS not supported yet</p>
        <p className="mt-1 text-sm text-amber-800">
          The ArogyaDiet app is available for Android devices today. An iOS version
          is on the way.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Opens the TLS connection to Cloudflare during page load instead of when
          the script tag is reached, which is worth roughly a round trip on
          mobile. React hoists this into <head>. */}
      <link rel="preconnect" href="https://challenges.cloudflare.com" crossOrigin="" />

      {/* `onReady` rather than `onLoad`: it also fires when the script is already
          present, so a client-side navigation back to this page still renders a
          widget. */}
      <Script
        src={TURNSTILE_SCRIPT_SRC}
        strategy="afterInteractive"
        onReady={renderWidget}
        onError={handleScriptError}
      />

      {state.kind !== "WIDGET_UNAVAILABLE" && (
        <div ref={widgetContainerRef} className="flex min-h-[65px] justify-center" />
      )}

      {/* Every state change is announced here (Req 5.14). */}
      <div id="download-state-message" role="status" aria-live="polite" className="sr-only">
        {getStateMessage()}
      </div>

      {/* Visible status. Suppressed in the two states the button already
          communicates on its own, so the card does not carry redundant copy. */}
      {state.kind !== "REQUESTING" && state.kind !== "DOWNLOADING" && (
        <p
          className={cn(
            "flex items-center justify-center gap-1.5 text-center text-xs",
            state.kind === "READY" && "font-medium",
          )}
        >
          {state.kind === "READY" && (
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          {getStateMessage()}
        </p>
      )}

      {/* Disabled in every state except READY (Req 5.4, 5.5). */}
      <Button
        size="lg"
        disabled={isButtonDisabled}
        onClick={handleDownload}
        aria-describedby="download-state-message"
        className="w-full font-semibold"
      >
        {getButtonIcon()}
        <span className="ml-2">{getButtonLabel()}</span>
      </Button>
    </div>
  );
}
