"use client";

import dynamic from "next/dynamic";

// These components are purely interactive (push notifications SDK, support FAB).
// They're not needed for first paint, so we load them lazily after hydration to
// reduce the initial client JS bundle size on every customer page navigation.
const OneSignalProvider = dynamic(
  () => import("@/shared/components/notifications/OneSignalProvider").then((m) => m.OneSignalProvider),
  { ssr: false },
);

const FloatingSupportMenu = dynamic(
  () => import("@/shared/components/customer/FloatingSupportMenu").then((m) => m.FloatingSupportMenu),
  { ssr: false },
);

interface DeferredClientProvidersProps {
  userId: string | null;
}

/**
 * Thin client boundary that lazily loads non-critical interactive components
 * (OneSignal push SDK, floating support FAB) after hydration.
 */
export function DeferredClientProviders({ userId }: DeferredClientProvidersProps) {
  return (
    <>
      <OneSignalProvider userId={userId} />
      <FloatingSupportMenu />
    </>
  );
}
