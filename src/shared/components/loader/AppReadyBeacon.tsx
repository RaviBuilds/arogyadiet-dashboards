"use client";

import { useEffect } from "react";

/**
 * AppReadyBeacon — a zero-render signal that the page's real content has
 * mounted and hydrated on the client.
 *
 * Placed at the end of a page's content, it fires exactly when the whole page
 * (hero + every section) is present in the DOM. AppLoaderOverlay waits for this
 * signal before dissolving, so the branded loader always hands off to *real*
 * content and the opening choreography plays over elements that actually exist
 * — never a blind timer against an empty stage.
 *
 * Reusable on any page that wants the loader to wait for its content.
 */
export const APP_READY_EVENT = "arogya:ready";

declare global {
  interface Window {
    __arogyaReady?: boolean;
  }
}

export function AppReadyBeacon() {
  useEffect(() => {
    // A frame after mount so layout/paint has settled before we hand off.
    const id = requestAnimationFrame(() => {
      window.__arogyaReady = true;
      window.dispatchEvent(new Event(APP_READY_EVENT));
    });
    return () => cancelAnimationFrame(id);
  }, []);

  return null;
}
