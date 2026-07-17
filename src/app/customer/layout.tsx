import { Suspense } from "react";
import { GlobalLoader } from "@/shared/components/loader/GlobalLoader";

/**
 * Customer shell layout — SYNCHRONOUS on purpose.
 *
 * This is the first layout below the root for every `/customer` route, and it
 * does no awaiting, so it renders as part of the very first HTML chunk. That
 * makes `<GlobalLoader />` the first thing painted — before the session-reading
 * `(main)` layout runs.
 *
 * The `(main)` layout awaits the session (cookies/headers). Wrapping the route
 * subtree in `<Suspense fallback={null}>` lets this shell (and the branded
 * loader) stream to the device immediately while that async work resolves
 * behind it. The GlobalLoader overlay covers the (empty) frame until the real
 * page is ready, so there is never a moment where neither the native splash,
 * the loader, nor the page is visible.
 *
 *   Native Splash → GlobalLoader (first paint) → Crossfade → Page
 */
export default function CustomerShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (process.env.NEXT_PUBLIC_STARTUP_TRACE === "1") {
    console.info("[AROGYA_STARTUP]", {
      event: "customer-shell-render",
      runtime: "server",
      traceId: process.env.NEXT_PUBLIC_STARTUP_TRACE_ID ?? "unset",
    });
  }

  return (
    <>
      <GlobalLoader message="Preparing today's wellness journey…" />
      <Suspense fallback={null}>{children}</Suspense>
    </>
  );
}
