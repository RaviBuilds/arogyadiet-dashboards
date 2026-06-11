"use client";

import dynamic from "next/dynamic";

const OneSignalProvider = dynamic(
  () =>
    import("@/shared/components/notifications/OneSignalProvider").then((m) => ({
      default: m.OneSignalProvider,
    })),
  { ssr: false },
);

const NotificationBell = dynamic(
  () =>
    import("@/components/shared/NotificationBell").then((m) => ({
      default: m.NotificationBell,
    })),
  { ssr: false, loading: () => <div className="w-8 h-8" /> },
);

export function RiderOneSignal({ userId }: { userId: string | null }) {
  return <OneSignalProvider userId={userId} />;
}

export function RiderNotificationBell({ userId }: { userId: string | null }) {
  return <NotificationBell userId={userId ?? undefined} />;
}
