import LedgerWorkspace from "@/shared/components/admin/inventory/ledger/LedgerWorkspace";
import {
  getTransactionLedger,
  listCoreClinicsForDispatch,
} from "@/services/inventoryEngine";
import { listActiveFranchiseDestinations } from "@/services/franchiseInventoryEngine";

export const revalidate = 0;

export default async function MasterAuditLedgerPage() {
  const [entries, franchiseDestinations, clinicDestinations] = await Promise.all([
    getTransactionLedger(1000),
    listActiveFranchiseDestinations(),
    listCoreClinicsForDispatch(),
  ]);

  return (
    <div className="space-y-6 p-6">
      <LedgerWorkspace
        data={entries}
        franchiseDestinations={franchiseDestinations}
        clinicDestinations={clinicDestinations}
      />
    </div>
  );
}
