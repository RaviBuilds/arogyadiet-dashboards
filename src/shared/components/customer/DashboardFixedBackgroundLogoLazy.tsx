"use client";

import dynamic from "next/dynamic";

const DashboardFixedBackgroundLogo = dynamic(
  () =>
    import("@/shared/components/customer/DashboardFixedBackgroundLogo").then(
      (mod) => mod.DashboardFixedBackgroundLogo,
    ),
  { ssr: false },
);

export function DashboardFixedBackgroundLogoLazy() {
  return <DashboardFixedBackgroundLogo />;
}
