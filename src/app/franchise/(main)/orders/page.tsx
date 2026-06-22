import { cookies } from "next/headers";
import FranchiseOrders from "@/shared/components/franchise/FranchiseOrders";

export const revalidate = 0;

export default async function FranchiseOrdersPage() {
  const cookieStore = await cookies();
  const franchiseId = cookieStore.get("x-franchise-id")?.value ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Orders & Deliveries
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Today&apos;s delivery orders and batch tracking.
        </p>
      </div>
      <FranchiseOrders role="FRANCHISE_ADMIN" franchiseId={franchiseId} />
    </div>
  );
}
