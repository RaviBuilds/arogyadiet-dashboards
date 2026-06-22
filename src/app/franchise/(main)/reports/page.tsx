import { cookies } from "next/headers";
import FranchiseReports from "@/shared/components/franchise/FranchiseReports";

export const revalidate = 0;

export default async function FranchiseReportsPage() {
  const cookieStore = await cookies();
  const franchiseId = cookieStore.get("x-franchise-id")?.value ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Reports
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Revenue, deliveries, and subscription analytics for your franchise.
        </p>
      </div>
      <FranchiseReports role="FRANCHISE_ADMIN" franchiseId={franchiseId} />
    </div>
  );
}
