import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { BulkMigrationClient } from "@/shared/components/admin/customers/BulkMigrationClient";
import { getBulkMigrationReferenceAction } from "@/actions/admin-actions/bulkImportActions";

export default async function BulkImportPage() {
  const reference = await getBulkMigrationReferenceAction();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Bulk migration"
        description="Import customers and subscriptions from Excel or CSV for offline-to-platform migration."
      />
      <BulkMigrationClient
        plans={reference.plans}
        meals={reference.meals}
      />
    </div>
  );
}
