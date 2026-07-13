import LedgerWorkspace from "@/shared/components/admin/inventory/ledger/LedgerWorkspace";
import { getTransactionLedger } from "@/services/inventoryEngine";
import { listActiveFranchiseDestinations } from "@/services/franchiseInventoryEngine";

export const revalidate = 0;

export default async function MasterAuditLedgerPage() {
  const [entries, franchiseDestinations] = await Promise.all([
    getTransactionLedger(1000),
    listActiveFranchiseDestinations(),
  ]);

  return (
    <div className="space-y-6 p-6">
      <LedgerWorkspace data={entries} franchiseDestinations={franchiseDestinations} />
    </div>
  );
}
