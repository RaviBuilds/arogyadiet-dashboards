import LedgerWorkspace from "@/shared/components/admin/inventory/ledger/LedgerWorkspace";
import { getTransactionLedger } from "@/services/inventoryEngine";

export const revalidate = 0;

export default async function MasterAuditLedgerPage() {
  const entries = await getTransactionLedger(1000);

  return (
    <div className="space-y-6 p-6">
      <LedgerWorkspace data={entries} />
    </div>
  );
}
