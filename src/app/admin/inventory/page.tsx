import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import AddProductForm from "@/shared/components/admin/inventory/AddProductForm";

export const revalidate = 0;

export default function WarehouseInventoryPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <AdminPageHeader
        title="Warehouse Inventory Master"
        description="Register raw materials and finished goods for warehouse tracking."
      />
      <AddProductForm />
    </div>
  );
}
