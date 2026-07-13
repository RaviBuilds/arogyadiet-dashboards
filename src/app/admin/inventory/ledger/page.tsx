import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import LedgerWorkspace from "@/shared/components/admin/inventory/ledger/LedgerWorkspace";
import { getTransactionLedger } from "@/services/inventoryEngine";
import { listActiveFranchiseDestinations } from "@/services/franchiseInventoryEngine";

export const revalidate = 0;

export default async function AuditLedgerPage() {
  const [entries, franchiseDestinations] = await Promise.all([
    getTransactionLedger(1000),
    listActiveFranchiseDestinations(),
  ]);

  return (
    <div className="space-y-6 p-6">
      <AdminPageHeader
        title="Audit Ledger"
        description="Immutable transaction history for every stock movement and financial impact. Switch between incoming, outgoing, and manufacturing entries for a focused view."
      />
      <LedgerWorkspace data={entries} franchiseDestinations={franchiseDestinations} />
    </div>
  );
}
