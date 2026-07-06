import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft, BookOpen } from "lucide-react";

import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import { getFranchiseLedger } from "@/services/franchiseInventoryEngine";
import type { Scope } from "@/types/franchise";
import { Button } from "@/shared/components/ui/button";
import FranchiseLedgerWorkspace from "./_components/FranchiseLedgerWorkspace";

export const revalidate = 0;

export default async function FranchiseLedgerPage() {
  const cookieStore = await cookies();
  const franchiseId = cookieStore.get("x-franchise-id")?.value ?? "";

  if (!franchiseId) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p>Unable to determine franchise. Please contact support.</p>
      </div>
    );
  }

  const scope: Scope = { kind: "franchise", franchise_id: franchiseId };
  // Fetch the full ledger; the workspace handles date filtering client-side.
  const entries = await getFranchiseLedger(franchiseId, scope, 1000);

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <Button asChild variant="outline" size="sm">
          <Link href="/inventory">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Inventory
          </Link>
        </Button>
      </div>
      <PageHeader
        title="Audit Ledger"
        subtitle="Immutable transaction history for every stock movement. Switch between incoming and outgoing entries for a focused view."
        icon={BookOpen}
      />
      <FranchiseLedgerWorkspace entries={entries} />
    </div>
  );
}
