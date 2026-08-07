"use client";

// src/app/customer/(public)/app/[slug]/DownloadControl.tsx
// The only client component in the app distribution feature. Manages the
// Cloudflare Turnstile widget lifecycle, the download grant API call, and
// the download trigger. An explicit state union rather than a cluster of
// booleans, because Req 5 enumerates eight distinct visitor-facing states
// and a boolean soup makes "disabled but for which reason" unrepresentable.
//
// Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.8, 5.9, 5.10, 5.13, 5.14

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { Download, Loader2, AlertTriangle, RefreshCw, XCircle } from "lucide-react";

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

// Turnstile widget type declarations
declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact";
        }
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

export function DownloadControl({ slug, siteKey }: DownloadControlProps) {
  const [state, setState] = useState<DownloadState>({ kind: "LOADING_WIDGET" });
  const [widgetId, setWidgetId] = useState<string | null>(null);
  const [isIos, setIsIos] = useState(false);
  const widgetContainerRef = useRef<HTMLDivElement>(null);
  const hasRenderedRef = useRef(false);

  // Detect iOS user agent client-side (Req 11.1, 11.2, 11.3)
  // Server-side sniffing would vary the cached HTML per visitor and defeat revalidate
  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    const isAppleDevice = /iphone|ipad|ipod|mac os/.test(ua);
    setIsIos(isAppleDevice);
  }, []);

  // Compute whether the download button should be disabled.
  // Enabled only in the READY state (Req 5.4, 5.5).
  const isButtonDisabled = state.kind !== "READY";

  // Track if we've already attempted rendering (prevents double-render in StrictMode)
  const isRenderingRef = useRef(false);

  // Render the Turnstile widget once the script is loaded and the container exists.
  useEffect(() => {
    if (hasRenderedRef.current) return;
    if (!widgetContainerRef.current) return;
    if (typeof window.turnstile?.render !== "function") return;
    if (isRenderingRef.current) return;

    isRenderingRef.current = true;

    const id = window.turnstile.render(widgetContainerRef.current, {
      sitekey: siteKey,
      theme: "light",
      size: "normal",
      // Callback: challenge passed, token obtained → READY state (Req 5.5)
      callback: (token: string) => {
        setState({ kind: "READY", token });
        hasRenderedRef.current = true;
      },
      // Error callback: challenge failed → CHALLENGE_FAILED (Req 5.8)
      "error-callback": () => {
        setState({ kind: "CHALLENGE_FAILED" });
      },
      // Expired callback: token expired → discard, reset, return to AWAITING_CHALLENGE (Req 5.9)
      "expired-callback": () => {
        if (widgetId) {
          window.turnstile?.reset(widgetId);
        }
        setState({ kind: "AWAITING_CHALLENGE" });
      },
    });

    setWidgetId(id);
    setState({ kind: "AWAITING_CHALLENGE" });
    isRenderingRef.current = false;
  }, [siteKey, widgetId]);

  // Handle the download button click: POST to grant endpoint, trigger download on success.
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
        // Handle specific error responses
        if (response.status === 429) {
          // Rate limited (Req 7.8)
          // Try to get retry-after from response body first, then from header
          let retryAfterSeconds = data.retryAfterSeconds ?? 60;
          const retryAfterHeader = response.headers.get("Retry-After");
          if (retryAfterHeader) {
            retryAfterSeconds = parseInt(retryAfterHeader, 10) || retryAfterSeconds;
          }
          setState({ kind: "RATE_LIMITED", retryAfterSeconds: retryAfterSeconds });
        } else if (response.status === 403) {
          // Verification failed
          setState({ kind: "CHALLENGE_FAILED" });
        } else {
          // Other errors
          setState({
            kind: "ERROR",
            message: data.error ?? "Download temporarily unavailable. Please try again.",
          });
        }
        return;
      }

      // Success: trigger the download via window.location.href assignment.
      // Content-Disposition: attachment on the response means navigation downloads
      // the file without leaving the page (Req 5.7, 9.3).
      const { url, version } = data as { url: string; version: string };
      setState({ kind: "DOWNLOADING", version });
      window.location.href = url;

      // After triggering download, reset the widget for a fresh challenge on retry.
      // The token is single-use; Cloudflare rejects a reused token anyway,
      // but resetting locally gives the visitor a fresh challenge instead of a 403.
      setTimeout(() => {
        if (widgetId) {
          window.turnstile?.reset(widgetId);
        }
        setState({ kind: "AWAITING_CHALLENGE" });
      }, 1000);
    } catch {
      setState({
        kind: "ERROR",
        message: "Network error. Please check your connection and try again.",
      });
    }
  };

  // Handle script load error → WIDGET_UNAVAILABLE (Req 5.10)
  const handleScriptError = () => {
    setState({ kind: "WIDGET_UNAVAILABLE" });
  };

  // Get state message for accessibility and display
  const getStateMessage = (): string => {
    switch (state.kind) {
      case "LOADING_WIDGET":
        return "Loading verification widget...";
      case "AWAITING_CHALLENGE":
        return "Please complete the verification to download.";
      case "READY":
        return "Verification complete. Click to download.";
      case "REQUESTING":
        return "Requesting download link...";
      case "DOWNLOADING":
        return `Downloading version ${state.version}...`;
      case "RATE_LIMITED":
        const minutes = Math.ceil(state.retryAfterSeconds / 60);
        return `Download limit reached. Please try again in ${minutes} minute${minutes > 1 ? "s" : ""}.`;
      case "CHALLENGE_FAILED":
        return "Verification failed. Please try again.";
      case "WIDGET_UNAVAILABLE":
        return "Verification step is unavailable. Please retry later.";
      case "ERROR":
        return state.message;
    }
  };

  // Get button label based on state
  const getButtonLabel = (): string => {
    switch (state.kind) {
      case "LOADING_WIDGET":
      case "AWAITING_CHALLENGE":
        return "Download App";
      case "READY":
        return "Download App";
      case "REQUESTING":
      case "DOWNLOADING":
        return "Downloading...";
      case "RATE_LIMITED":
        return "Limit Reached";
      case "CHALLENGE_FAILED":
        return "Retry Verification";
      case "WIDGET_UNAVAILABLE":
      case "ERROR":
        return "Unavailable";
    }
  };

  // Get button icon based on state
  const getButtonIcon = () => {
    switch (state.kind) {
      case "LOADING_WIDGET":
      case "AWAITING_CHALLENGE":
        return <Download className="h-4 w-4" aria-hidden="true" />;
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

  // iOS user agent suppresses control and widget while leaving release details rendered (Req 11.1, 11.2, 11.3)
  if (isIos) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
        <p className="text-sm font-medium text-amber-800">
          <strong>iOS not supported</strong>
        </p>
        <p className="mt-1 text-sm text-amber-700">
          The ArogyaDiet app is available for Android devices only. The iOS version
          is coming soon. Please check back later.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Turnstile script loaded with next/script at strategy="afterInteractive" */}
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onError={handleScriptError}
      />

      {/* Widget container - only shown when not in unavailable state */}
      {state.kind !== "WIDGET_UNAVAILABLE" && !isIos && (
        <div
          ref={widgetContainerRef}
          className="flex justify-center"
        />
      )}

      {/* State message for accessibility - aria-live region (Req 5.14) */}
      <div
        id="download-state-message"
        role="status"
        aria-live="polite"
        className="sr-only"
      >
        {getStateMessage()}
      </div>

      {/* Visible state message for non-READY states */}
      {state.kind !== "READY" && state.kind !== "LOADING_WIDGET" && state.kind !== "AWAITING_CHALLENGE" && (
        <p className="text-center text-sm text-muted-foreground">
          {getStateMessage()}
        </p>
      )}

      {/* Download button - disabled in every state except READY (Req 5.4, 5.5) */}
      {!isIos && (
        <Button
          size="lg"
          disabled={isButtonDisabled}
          onClick={handleDownload}
          aria-describedby="download-state-message"
          className={cn(
            "w-full font-semibold",
            state.kind === "READY" && "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          {getButtonIcon()}
          <span className="ml-2">{getButtonLabel()}</span>
        </Button>
      )}

      {/* Unavailable notice when widget cannot be loaded (Req 5.10) */}
      {state.kind === "WIDGET_UNAVAILABLE" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
          <p className="text-sm font-medium text-amber-800">
            The verification step is currently unavailable.
          </p>
          <p className="mt-1 text-xs text-amber-700">
            Please try again later or contact support if the problem persists.
          </p>
        </div>
      )}
    </div>
  );
}
