import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { BulkImportTabs } from "@/shared/components/admin/customers/BulkImportTabs";
import { getBulkMigrationReferenceAction } from "@/actions/admin-actions/bulkImportActions";
import { getKitBulkImportReferenceAction } from "@/actions/admin-actions/kitBulkImportActions";
import { guardAdminGroup } from "@/lib/auth/adminAccess";

export default async function BulkImportPage() {
  await guardAdminGroup("customers");
  const [reference, kitReference] = await Promise.all([
    getBulkMigrationReferenceAction(),
    getKitBulkImportReferenceAction(),
  ]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Bulk migration"
        description="Import meal and KIT customers from Excel or CSV for offline-to-platform migration."
      />
      <BulkImportTabs
        plans={reference.plans}
        meals={reference.meals}
        kitProducts={kitReference.kitProducts}
      />
    </div>
  );
}
