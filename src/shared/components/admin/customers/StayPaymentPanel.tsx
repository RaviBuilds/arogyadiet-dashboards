"use client";

// src/shared/components/admin/customers/StayPaymentPanel.tsx
//
// Total_Stay_Amount / Total_Paid / Remaining_Balance summary cards, the
// chronological payment history list (with a receipt link per row), and the
// fully-paid message when Remaining_Balance is zero.
//
// Self-sufficient: fetches and refreshes its own ledger via
// `getStayPaymentLedgerAction`. Sibling mutation components (RecordStayPaymentForm,
// RecordStayRefundDialog, StayCheckoutActionBar — tasks 11.2/11.3/11.5) drive
// refresh through two independent channels:
//   1. `balanceOverride` — the authoritative StayBalanceSnapshot returned
//      immediately by a mutation's own server action response, passed down by
//      the parent so totals update without waiting for a refetch.
//   2. `refreshToken` — bumped by the parent inside a mutation's `finally`
//      block, which always triggers a full `getStayPaymentLedgerAction`
//      refetch here regardless of whether the write succeeded, guaranteeing
//      eventual consistency (Req 5.9, 6.6).
//
// Requirements: 5.1, 5.9, 5.10, 6.5, 6.6, 6.7, 10.3

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Receipt, Wallet, CheckCircle2, Banknote, CircleDollarSign } from "lucide-react";

import { getStayPaymentLedgerAction } from "@/actions/stayPaymentActions";
import {
  buildPaymentHistoryRows,
  buildExtensionHistoryRows,
} from "@/lib/accommodation/paymentHistory";
import type {
  StayBalanceSnapshot,
  StayLedgerView,
  PaymentHistoryRow,
  ExtensionHistoryRow,
} from "@/types/accommodation";
import { StayRecalculationHistoryCard } from "@/shared/components/admin/customers/StayRecalculationHistoryCard";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { CalendarPlus } from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface StayPaymentPanelProps {
  /** The Stay_Entry this panel loads and displays the ledger for. */
  stayId: string;
  /**
   * Authoritative balance snapshot returned by a sibling mutation's server
   * action response (e.g. RecordStayPaymentForm, RecordStayRefundDialog).
   * When provided, it immediately overrides the displayed totals ahead of
   * the next full refetch.
   */
  balanceOverride?: StayBalanceSnapshot;
  /**
   * Bumped by the parent inside a mutation's `finally` block to force a full
   * ledger refetch, independent of whether the write succeeded.
   */
  refreshToken?: number;
  /** Notifies the parent whenever a fresh ledger view has been loaded. */
  onLedgerChange?: (ledger: StayLedgerView) => void;
  /**
   * When false, the Total / Paid / Remaining summary cards and the fully-paid
   * banner are omitted so the parent can surface those figures elsewhere
   * (the Active Stay Overview card renders them for the current stay).
   * Payment history is always rendered. Defaults to true.
   */
  showSummary?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StayPaymentPanel({
  stayId,
  balanceOverride,
  refreshToken,
  onLedgerChange,
  showSummary = true,
}: StayPaymentPanelProps) {
  const [ledger, setLedger] = useState<StayLedgerView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Keep the latest onLedgerChange without re-triggering the fetch effect.
  const onLedgerChangeRef = useRef(onLedgerChange);
  onLedgerChangeRef.current = onLedgerChange;

  const fetchLedger = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getStayPaymentLedgerAction(stayId);
      if ("error" in result) {
        setError(result.error);
      } else {
        setLedger(result.data);
        onLedgerChangeRef.current?.(result.data);
      }
    } catch {
      setError("Failed to load payment ledger.");
    } finally {
      setLoading(false);
    }
  }, [stayId]);

  // Reload on mount, whenever stayId changes, and whenever the parent bumps
  // refreshToken in a mutation's `finally` block (Req 5.9, 6.6).
  useEffect(() => {
    fetchLedger();
  }, [fetchLedger, refreshToken]);

  if (loading && !ledger) {
    return (
      <div className="space-y-4">
        {showSummary && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        )}
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  if (error && !ledger) {
    return (
      <div className="text-center py-8">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  if (!ledger) {
    return null;
  }

  // The immediate mutation-returned snapshot takes priority; otherwise fall
  // back to the last fetched ledger's derived balance.
  const balance = balanceOverride ?? ledger.balance;
  const historyRows: PaymentHistoryRow[] = buildPaymentHistoryRows(
    ledger.transactions
  );
  const extensionRows: ExtensionHistoryRow[] = buildExtensionHistoryRows(
    ledger.extensions
  );

  return (
    <div className="space-y-4">
      {/* ─── Summary cards ─── */}
      {showSummary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="flex items-start gap-3 py-2">
              <Banknote className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Total Stay Amount
                </p>
                <p className="text-lg font-semibold">
                  {formatRupees(balance.totalStayAmount)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-start gap-3 py-2">
              <Wallet className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Total Paid
                </p>
                <p className="text-lg font-semibold">
                  {formatRupees(balance.totalPaid)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card
            className={
              balance.isFullyPaid ? "border-emerald-500/40 bg-emerald-50/40" : undefined
            }
          >
            <CardContent className="flex items-start gap-3 py-2">
              <CircleDollarSign className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Remaining Balance
                </p>
                <p className="text-lg font-semibold">
                  {formatRupees(Math.max(0, balance.remainingBalance))}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Fully paid message ─── */}
      {showSummary && balance.isFullyPaid && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          <p className="text-sm font-medium">This stay is fully paid.</p>
        </div>
      )}

      {/* ─── Payment history ─── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Payment History</CardTitle>
        </CardHeader>
        <CardContent>
          {historyRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No payment transactions recorded yet.
            </p>
          ) : (
            <div className="space-y-3">
              {historyRows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline">{row.typeLabel}</Badge>
                      <span className="text-sm text-muted-foreground">
                        {row.date}
                      </span>
                    </div>
                    {row.comment && (
                      <p className="text-sm">{row.comment}</p>
                    )}
                    {row.remark && (
                      <p className="text-xs text-muted-foreground">
                        Remark: {row.remark}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="font-semibold">
                      {formatRupees(row.amount)}
                    </span>
                    <Link
                      href={row.receiptLinkTarget}
                      target="_blank"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Receipt className="h-3.5 w-3.5" />
                      Receipt
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Extension history ─── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Extension History</CardTitle>
        </CardHeader>
        <CardContent>
          {extensionRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No stay extensions recorded yet.
            </p>
          ) : (
            <div className="space-y-3">
              {extensionRows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="gap-1">
                        <CalendarPlus className="h-3.5 w-3.5" />
                        +{row.additionalNights}{" "}
                        {row.additionalNights === 1 ? "night" : "nights"}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {row.date}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {row.nightsBefore} → {row.nightsAfter} nights total
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="font-semibold">
                      +{formatRupees(row.additionalAmount)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      New total: {formatRupees(row.totalAmountAfter)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Recalculation history ─── */}
      <StayRecalculationHistoryCard recalculations={ledger.recalculations} />
    </div>
  );
}
