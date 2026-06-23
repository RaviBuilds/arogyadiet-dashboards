import { cookies } from "next/headers";
import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import FranchiseReports from "@/shared/components/franchise/FranchiseReports";

export const revalidate = 0;

export default async function FranchiseReportsPage() {
  const cookieStore = await cookies();
  const franchiseId = cookieStore.get("x-franchise-id")?.value ?? "";

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <PageHeader
        title="Reports"
        subtitle="Revenue, deliveries, and subscription analytics for your franchise."
        icon={BarChart3}
      />
      <FranchiseReports role="FRANCHISE_ADMIN" franchiseId={franchiseId} />
    </div>
  );
}
