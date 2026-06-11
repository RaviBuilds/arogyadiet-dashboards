import { Suspense } from "react";
import { RiderDashboardContent } from "./dashboard-content";
import { DashboardSkeleton } from "./dashboard-skeleton";

export const revalidate = 0;

export default function RiderDashboard() {
  return (
    <div className="p-4 space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <Suspense fallback={<DashboardSkeleton />}>
        <RiderDashboardContent />
      </Suspense>
    </div>
  );
}
