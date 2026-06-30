import { cookies } from "next/headers";
import { format } from "date-fns";
import { BookOpen, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import { Badge } from "@/shared/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { getFranchiseLedger } from "@/services/franchiseInventoryEngine";
import type { Scope } from "@/types/franchise";
import type { FranchiseLedgerEntry } from "@/types/franchiseInventory";

export const revalidate = 0;

/** Human-friendly stock-out reason labels. */
const REASON_LABELS: Record<string, string> = {
  MEAL_SUBSCRIPTION_SALE: "Meal Subscription",
  KIT_SUBSCRIPTION_SALE: "Kit Subscription",
  ONE_TIME_PURCHASE_SALE: "One-Time Purchase",
  SPOILED: "Spoiled",
  DAMAGED: "Damaged",
  OTHER: "Other",
};

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
  const entries = await getFranchiseLedger(franchiseId, scope);

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <PageHeader
        title="Inventory Ledger"
        subtitle="Complete audit trail of all stock movements — incoming transfers and outgoing stock-outs."
        icon={BookOpen}
      />

      {entries.length === 0 ? (
        <EmptyLedger />
      ) : (
        <LedgerTable entries={entries} />
      )}
    </div>
  );
}

function EmptyLedger() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-16 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 mb-4">
        <BookOpen className="h-6 w-6 text-slate-400" />
      </div>
      <h3 className="text-sm font-semibold text-slate-700">
        No inventory movements recorded yet
      </h3>
      <p className="mt-1 max-w-sm text-xs text-slate-500">
        Ledger entries will appear here as you receive stock transfers and record
        stock-outs.
      </p>
    </div>
  );
}

function LedgerTable({ entries }: { entries: FranchiseLedgerEntry[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50/80">
            <TableHead className="w-[80px]">Direction</TableHead>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead>Batches</TableHead>
            <TableHead>Reason / Source</TableHead>
            <TableHead>Timestamp</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell>
                <DirectionBadge direction={entry.direction} />
              </TableCell>
              <TableCell className="font-medium text-slate-800">
                {entry.productName}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {entry.quantity}
              </TableCell>
              <TableCell>
                <BatchBreakdown entry={entry} />
              </TableCell>
              <TableCell>
                <ReasonOrSource entry={entry} />
              </TableCell>
              <TableCell className="text-xs text-slate-500">
                {format(new Date(entry.occurredAt), "dd MMM yyyy, HH:mm")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DirectionBadge({ direction }: { direction: "IN" | "OUT" }) {
  if (direction === "IN") {
    return (
      <Badge className="border-0 gap-1 bg-emerald-100 text-emerald-800">
        <ArrowDownToLine className="size-3" />
        IN
      </Badge>
    );
  }
  return (
    <Badge className="border-0 gap-1 bg-rose-100 text-rose-800">
      <ArrowUpFromLine className="size-3" />
      OUT
    </Badge>
  );
}

function BatchBreakdown({ entry }: { entry: FranchiseLedgerEntry }) {
  if (!entry.batchBreakdown || entry.batchBreakdown.length === 0) {
    return <span className="text-xs text-slate-400">—</span>;
  }

  return (
    <div className="space-y-0.5">
      {entry.batchBreakdown.map((batch, idx) => (
        <div key={idx} className="text-xs text-slate-600">
          <span className="font-medium">{batch.batchNumber}</span>
          {" × "}
          {batch.quantity}
          {batch.expiryDate && (
            <span className="text-slate-400 ml-1">
              (exp: {format(new Date(batch.expiryDate), "dd MMM yy")})
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function ReasonOrSource({ entry }: { entry: FranchiseLedgerEntry }) {
  if (entry.direction === "OUT") {
    const label = entry.stockOutReason
      ? (REASON_LABELS[entry.stockOutReason] ?? entry.stockOutReason)
      : "—";

    return (
      <div>
        <span className="text-sm text-slate-700">{label}</span>
        {entry.comment && (
          <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
            {entry.comment}
          </p>
        )}
      </div>
    );
  }

  // IN entries show the source (central kitchen)
  return (
    <span className="text-sm text-slate-600">
      {entry.sourceCentralKitchenId ? "Central Kitchen" : "Transfer"}
    </span>
  );
}
