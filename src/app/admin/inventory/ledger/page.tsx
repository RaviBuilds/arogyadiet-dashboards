import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import LedgerDataTable from "@/shared/components/admin/inventory/ledger/LedgerDataTable";
import { getTransactionLedger } from "@/services/inventoryEngine";

export const revalidate = 0;

export default async function AuditLedgerPage() {
  const entries = await getTransactionLedger(1000);

  return (
    <div className="space-y-6 p-6">
      <AdminPageHeader
        title="Audit Ledger"
        description="Immutable transaction history for every stock movement and financial impact."
      />
      <LedgerDataTable data={entries} />
    </div>
  );
}
