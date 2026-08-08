import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentAdminContext } from "@/lib/auth/adminAccess";
import InventoryHeader from "@/shared/components/admin/inventory/InventoryHeader";
import OperationsCart from "@/shared/components/admin/inventory/OperationsCart";

export default async function MasterWarehouseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, roleCode } = await getCurrentAdminContext();

  // Defense-in-depth: the parent (main) layout already guards MASTER_ADMIN,
  // but we re-assert here per Requirement 8.4.
  if (roleCode !== "MASTER_ADMIN") redirect("/unauthorized");

  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      <InventoryHeader
        basePath="/inventory/warehouse"
        userId={userId ?? undefined}
        endSlot={
          <Link
            href="/inventory"
            className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Back to Inventory BI
          </Link>
        }
      />
      <main className="flex-1">{children}</main>
      {/* Shop Products owns its own Stock In cart (`ShopStockInCart`), so the
          master-catalog staging cart is suppressed there to avoid two
          floating cart buttons overlapping. */}
      <OperationsCart hideOnPathSuffixes={["/shop-products"]} />
    </div>
  );
}
