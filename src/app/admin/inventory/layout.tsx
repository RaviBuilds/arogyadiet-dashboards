import { redirect } from "next/navigation";
import InventoryHeader from "@/shared/components/admin/inventory/InventoryHeader";
import OperationsCart from "@/shared/components/admin/inventory/OperationsCart";
import {
  getCurrentAdminContext,
  canAccess,
  landingRouteFor,
} from "@/lib/auth/adminAccess";

export default async function InventoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, roleCode, accessLevel } = await getCurrentAdminContext();

  // No session / non-admin -> /unauthorized (defense-in-depth behind middleware).
  if (roleCode !== "ADMIN") redirect("/unauthorized");
  // Operations-only admins cannot see inventory -> their landing route (/dashboard).
  if (!canAccess(accessLevel, "inventory")) redirect(landingRouteFor(accessLevel));

  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      {/* Pass the resolved user id so the header can render the NotificationBell.
          Inventory-only admins land here, so the bell must be present. */}
      <InventoryHeader userId={userId ?? undefined} />
      <main className="flex-1">{children}</main>
      <OperationsCart />
    </div>
  );
}
