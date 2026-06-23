import { cookies } from "next/headers";
import FranchiseCustomers from "@/shared/components/franchise/FranchiseCustomers";

export const revalidate = 0;

export default async function FranchiseCustomersPage() {
  const cookieStore = await cookies();
  const franchiseId = cookieStore.get("x-franchise-id")?.value ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Customers
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage your franchise customers and their subscriptions.
        </p>
      </div>
      <FranchiseCustomers role="FRANCHISE_ADMIN" franchiseId={franchiseId} />
    </div>
  );
}
