"use client";

import { useEffect, useRef } from "react";

/**
 * AutoPrintTrigger — opens the browser print dialog once, after the invoice has
 * finished rendering.
 *
 * REPLACES a `<script dangerouslySetInnerHTML>` tag that used to sit inside
 * `InvoiceDocument`. That never worked: React does not execute script tags
 * rendered as part of a component tree, so the browser logged
 * "Encountered a script tag while rendering React component" and the print
 * dialog never opened. The old approach was doubly broken — it hung the print
 * call off `window.onload`, which has usually already fired by the time React
 * hydrates, so even an executed script would have missed the event.
 *
 * Renders nothing; it exists purely for the effect.
 */
export function AutoPrintTrigger() {
  // React runs effects twice in development Strict Mode. Without this guard the
  // admin would get two stacked print dialogs locally.
  const hasPrinted = useRef(false);

  useEffect(() => {
    if (hasPrinted.current) return;
    hasPrinted.current = true;

    /**
     * Print only once the page has actually loaded. The invoice includes a logo
     * `<img>`, and printing before it resolves produces a logo-less PDF — the
     * one artefact of this page that is handed to a customer.
     */
    const print = () => {
      // A frame's grace so the final layout pass is committed before the dialog
      // freezes the page.
      requestAnimationFrame(() => window.print());
    };

    if (document.readyState === "complete") {
      print();
      return;
    }

    window.addEventListener("load", print, { once: true });
    return () => window.removeEventListener("load", print);
  }, []);

  return null;
}
