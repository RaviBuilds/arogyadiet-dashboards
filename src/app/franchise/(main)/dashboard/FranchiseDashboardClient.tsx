"use client";

import FranchiseReports from "@/shared/components/franchise/FranchiseReports";
import FranchiseOrders from "@/shared/components/franchise/FranchiseOrders";

interface Props {
  franchiseId: string;
}

export default function FranchiseDashboardClient({ franchiseId }: Props) {
  if (!franchiseId) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p>Unable to determine franchise. Please contact support.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <FranchiseReports role="FRANCHISE_ADMIN" franchiseId={franchiseId} />
      <FranchiseOrders role="FRANCHISE_ADMIN" franchiseId={franchiseId} />
    </div>
  );
}
