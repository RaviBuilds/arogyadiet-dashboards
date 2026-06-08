import InventoryHeader from "@/shared/components/admin/inventory/InventoryHeader";
import OperationsCart from "@/shared/components/admin/inventory/OperationsCart";

export default function InventoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      <InventoryHeader />
      <main className="flex-1">{children}</main>
      <OperationsCart />
    </div>
  );
}
