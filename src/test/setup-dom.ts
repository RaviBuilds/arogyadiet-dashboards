// src/test/setup-dom.ts
//
// Vitest global setup for DOM component tests (customer-mobile-onboarding,
// Task 11.3). This file is referenced from `vitest.config.ts` `setupFiles`, so
// it runs for EVERY test regardless of environment. To avoid breaking the
// existing node-environment unit/property tests, every DOM-specific polyfill is
// guarded behind a `typeof window`/`typeof document` check and only takes
// effect in the jsdom-environment component tests (those declare
// `// @vitest-environment jsdom` at the top of the file).
//
// Registering `@testing-library/jest-dom` matchers is safe in the node
// environment — it only calls `expect.extend`, adding matchers like
// `toBeInTheDocument` used by the DOM tests.

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// Clean up the rendered tree between DOM tests so components don't leak state.
if (typeof document !== "undefined") {
  // Lazy import keeps this out of the node-only test graph.
  const { cleanup } = await import("@testing-library/react");
  afterEach(() => cleanup());
}

// ---------------------------------------------------------------------------
// jsdom polyfills for Radix UI / Shadcn primitives
// ---------------------------------------------------------------------------
// Radix Dialog/Select rely on a handful of browser APIs that jsdom does not
// implement. Without these, mounting the ProfileCompletionDialog (Radix Dialog)
// or any Radix Select throws. All are no-op/minimal shims sufficient for render
// + interaction assertions.

if (typeof window !== "undefined") {
  // matchMedia — used by responsive helpers and some primitives.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  // ResizeObserver — required by Radix Select/Popover positioning.
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof window.ResizeObserver;
  }

  // Pointer capture APIs — Radix uses these on triggers; jsdom lacks them.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }

  // scrollIntoView — called by Radix Select when an item is highlighted.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }

  // PointerEvent — jsdom does not implement it; Radix triggers dispatch pointer
  // events. Alias it to MouseEvent (sufficient for open/close interactions).
  if (typeof window.PointerEvent === "undefined") {
    window.PointerEvent = window.MouseEvent as unknown as typeof window.PointerEvent;
  }
}
