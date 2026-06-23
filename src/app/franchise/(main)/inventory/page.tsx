import { cookies } from "next/headers";
import FranchiseInventory from "@/shared/components/franchise/FranchiseInventory";

export const revalidate = 0;

export default async function FranchiseInventoryPage() {
  const cookieStore = await cookies();
  const franchiseId = cookieStore.get("x-franchise-id")?.value ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Inventory
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Product catalog and stock for your franchise.
        </p>
      </div>
      <FranchiseInventory role="FRANCHISE_ADMIN" franchiseId={franchiseId} />
    </div>
  );
}
