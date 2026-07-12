import { Suspense } from "react";
import { RiderDashboardContent } from "./dashboard-content";
import { RiderLoader } from "@/shared/components/rider/RiderLoader";

export const revalidate = 0;

export default function RiderDashboard() {
  return (
    <div className="p-4 space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <Suspense fallback={<RiderLoader />}>
        <RiderDashboardContent />
      </Suspense>
    </div>
  );
}
