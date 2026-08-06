"use client";

// src/shared/components/admin/customers/StayRecalculationHistoryCard.tsx
//
// Dedicated Recalculation History card for the Accommodation tab, sitting
// beside (never merged with) the existing inline Extension History card in
// `StayPaymentPanel`. Renders exclusively from `ledger.recalculations` via
// `buildRecalculationHistoryRows` — it never reads `ledger.extensions`, and
// the Extension History card is left untouched and never reads
// `ledger.recalculations` (Req 13.6, 13.7).
//
// Props: `{ recalculations: StayRecalculation[] }` — the raw array from
// `StayLedgerView.recalculations`. This component calls
// `buildRecalculationHistoryRows` internally (mirroring how `StayPaymentPanel`
// calls `buildExtensionHistoryRows` inline for the Extension History card), so
// callers (e.g. `StayPaymentPanel`, `AccommodationTab`) just pass the array
// straight through without pre-building rows themselves.
//
// Styling mirrors the Extension History card exactly: same Card/CardHeader/
// CardTitle/CardContent structure, same empty-state paragraph classes, same
// per-row `flex items-start justify-between gap-4 rounded-lg border px-4 py-3`
// layout, and the same ₹ / toLocaleString("en-IN") amount formatting
// convention used elsewhere in `StayPaymentPanel.tsx`.
//
// Requirements: 13.3, 13.4, 13.5, 13.6, 13.7

import { Calculator } from "lucide-react";

import { buildRecalculationHistoryRows } from "@/lib/accommodation/recalculationHistory";
import type {
  StayRecalculation,
  RecalculationHistoryRow,
} from "@/types/accommodation";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

/** `totalAmountBefore` is nullable (Total_Stay_Amount may not have existed
 * yet before the first recalculation on some historical stays); render an
 * em dash rather than a misleading ₹0. */
function formatRupeesOrDash(amount: number | null): string {
  return amount === null ? "—" : formatRupees(amount);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface StayRecalculationHistoryCardProps {
  /** `StayLedgerView.recalculations` — the raw, unsorted array. */
  recalculations: StayRecalculation[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StayRecalculationHistoryCard({
  recalculations,
}: StayRecalculationHistoryCardProps) {
  const recalculationRows: RecalculationHistoryRow[] =
    buildRecalculationHistoryRows(recalculations);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Recalculation History</CardTitle>
      </CardHeader>
      <CardContent>
        {recalculationRows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No recalculations recorded for this stay.
          </p>
        ) : (
          <div className="space-y-3">
            {recalculationRows.map((row) => (
              <div
                key={row.id}
                className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="gap-1">
                      <Calculator className="h-3.5 w-3.5" />
                      Recalculated
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {row.date}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {row.nightsBefore} → {row.nightsAfter} nights
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="font-semibold">
                    {formatRupeesOrDash(row.totalAmountBefore)} →{" "}
                    {formatRupees(row.totalAmountAfter)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
