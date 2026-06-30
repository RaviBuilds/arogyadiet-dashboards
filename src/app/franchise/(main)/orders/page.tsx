import { cookies } from "next/headers";
import { Package } from "lucide-react";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import FranchiseOrders from "@/shared/components/franchise/FranchiseOrders";

export const revalidate = 0;

export default async function FranchiseOrdersPage() {
  const cookieStore = await cookies();
  const franchiseId = cookieStore.get("x-franchise-id")?.value ?? "";

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <PageHeader
        title="Orders & Deliveries"
        subtitle="Today's delivery orders and batch tracking."
        icon={Package}
      />
      <FranchiseOrders role="FRANCHISE_ADMIN" franchiseId={franchiseId} />
    </div>
  );
}
