"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format, isValid } from "date-fns";
import { getAllStaysAction } from "@/actions/stayActions";
import { isAwaitingCheckout } from "@/lib/accommodation/stayLifecycle";
import type {
  StayEntry,
  StayLedgerView,
  StayBalanceSnapshot,
  SaveStayDetailsOutcome,
} from "@/types/accommodation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  Plus,
  Home,
  Calendar,
  Users,
  Clock,
  CalendarPlus,
  Wallet,
  Calculator,
  Banknote,
  CircleDollarSign,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

import { StayExtensionDialog } from "./StayExtensionDialog";
import { NewStayDialog } from "./NewStayDialog";
import { CustomerAddonRequestHistory } from "./CustomerAddonRequestHistory";
import { StayPaymentPanel } from "./StayPaymentPanel";
import { RecordStayPaymentForm } from "./RecordStayPaymentForm";
import { RecordStayRefundDialog } from "./RecordStayRefundDialog";
import { RecalculateStayDialog } from "./RecalculateStayDialog";
import { StayCheckoutActionBar } from "./StayCheckoutActionBar";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStatusBadgeClasses(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "border-emerald-500 text-emerald-600 bg-emerald-50";
    case "PENDING":
      return "border-amber-500 text-amber-600 bg-amber-50";
    case "AWAITING CHECKOUT":
      // Deliberately louder than FINISHED's grey: this stay is waiting on the
      // admin, not filed away.
      return "border-orange-500 text-orange-700 bg-orange-50";
    case "FINISHED":
      return "border-slate-300 text-slate-600 bg-slate-50";
    case "EXPIRED":
      return "border-red-400 text-red-600 bg-red-50";
    default:
      return "border-slate-300 text-slate-600 bg-slate-50";
  }
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return isValid(date) ? format(date, "dd MMM yyyy") : "N/A";
}

function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AccommodationTabProps {
  customerProfileId: string;
}

export function AccommodationTab({ customerProfileId }: AccommodationTabProps) {
  const router = useRouter();

  // ── All stays for this customer (every status) ──
  const [allStays, setAllStays] = useState<StayEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Selected-stay notion for the payment/checkout panel ──
  // A Backdated_Stay is FINISHED at creation yet still needs the payment
  // panel and the Generate Final Invoice action (Req 9.1, 9.2).
  const [selectedStayId, setSelectedStayId] = useState<string | null>(null);
  const [currentLedger, setCurrentLedger] = useState<StayLedgerView | null>(null);
  const [balanceOverride, setBalanceOverride] = useState<StayBalanceSnapshot | undefined>(
    undefined
  );
  const [refreshToken, setRefreshToken] = useState(0);

  // Dialog state
  const [showExtendDialog, setShowExtendDialog] = useState(false);
  const [showNewStayDialog, setShowNewStayDialog] = useState(false);
  const [showRecalculateDialog, setShowRecalculateDialog] = useState(false);
  const [showRefundDialog, setShowRefundDialog] = useState(false);

  const fetchAllStays = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getAllStaysAction(customerProfileId);
      if ("error" in result) {
        setError(result.error);
      } else {
        setAllStays(result.data);
      }
    } catch {
      setError("Failed to load accommodation data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllStays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerProfileId]);

  // Derive the stay that owns the "Current Stay" surface.
  //
  // ACTIVE first, then Awaiting_Checkout, then the earliest PENDING. The middle
  // rung is the one that used to be missing: the daily cron flips a stay to
  // FINISHED the moment its end date passes, which stamps no `checkedOutAt`,
  // settles no money, and generates no invoice. Such a stay still needs the
  // admin to collect the remainder or refund the excess and then press Mark as
  // Checked Out, so it has to keep the full live treatment — dates, payment
  // figures, and actions — instead of vanishing into "No current stay" with its
  // money open. It outranks a PENDING stay because it is the one blocking work.
  // `allStays` is already start_date-descending, so `find` picks the most recent.
  const activeStay = allStays.find((s) => s.status === "ACTIVE") ?? null;
  const awaitingCheckoutStay = allStays.find(isAwaitingCheckout) ?? null;
  const earliestPendingStay =
    allStays
      .filter((s) => s.status === "PENDING")
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null;
  const currentStay = activeStay ?? awaitingCheckoutStay ?? earliestPendingStay;

  // Default the payment-panel selection, in the same order of urgency: the
  // ACTIVE stay, then one awaiting checkout, then the most recent
  // Backdated_Stay still awaiting a final invoice. Keep an existing selection
  // if it still exists.
  useEffect(() => {
    if (selectedStayId && allStays.some((s) => s.id === selectedStayId)) {
      return;
    }
    if (activeStay) {
      setSelectedStayId(activeStay.id);
      return;
    }
    if (awaitingCheckoutStay) {
      setSelectedStayId(awaitingCheckoutStay.id);
      return;
    }
    const backdatedNeedingAttention = allStays.find(
      (s) => s.isBackdated && s.status === "FINISHED" && !s.finalInvoicePaymentId
    );
    setSelectedStayId(backdatedNeedingAttention ? backdatedNeedingAttention.id : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allStays]);

  // Clear the previously loaded ledger when the selection changes so stale
  // data from a different stay never briefly renders.
  useEffect(() => {
    setCurrentLedger(null);
    setBalanceOverride(undefined);
  }, [selectedStayId]);

  const bumpRefresh = () => setRefreshToken((t) => t + 1);

  const handleLedgerChange = (ledger: StayLedgerView) => {
    setCurrentLedger(ledger);
    setBalanceOverride(undefined);
  };

  const handlePaymentSuccess = (balance: StayBalanceSnapshot) => {
    setBalanceOverride(balance);
  };

  // Called from RecordStayPaymentForm's `finally` block on every submission
  // attempt — success or failure — so the ledger is always refetched
  // (Req 5.9). On success this runs after `handlePaymentSuccess` has already
  // set the balance override, so the panel shows the fresh snapshot
  // immediately and then reconciles with a full refetch either way.
  const handlePaymentSettled = () => {
    bumpRefresh();
  };

  // Checkout, final-invoice generation, and refunds each write a `payments`
  // row. Those rows are read by the Billing tab, which is rendered from props
  // fetched during the page's SERVER render — not by this tab. Refetching stays
  // and the ledger only refreshes this subtree, so without a route refresh the
  // Billing tab keeps showing a snapshot taken before the invoice existed, and
  // the admin is told "invoice generated" while Payment History shows nothing.
  // `router.refresh()` re-runs the server render, which is the same convention
  // every other mutation in Customer360Dashboard already follows.
  const handleRefundSuccess = (result: {
    balance: StayBalanceSnapshot;
    refundInvoicePaymentId: string;
  }) => {
    setBalanceOverride(result.balance);
    bumpRefresh();
    router.refresh();
  };

  const handleCheckedOut = () => {
    bumpRefresh();
    fetchAllStays();
    router.refresh();
  };

  const handleInvoiceGenerated = () => {
    bumpRefresh();
    fetchAllStays();
    router.refresh();
  };

  // Save Stay Details never transitions Stay_Status and never generates a
  // Final_Consolidated_Invoice (Req 12.9) — this refetches the ledger and the
  // stay list so nights, end date, total, and both history lists update
  // without a page reload, and it never calls `handleCheckedOut` or anything
  // that implies a checkout refresh.
  const handleStayDetailsSaved = (outcome: SaveStayDetailsOutcome) => {
    bumpRefresh();
    fetchAllStays();
    if (outcome.nextAction === "RECORD_REFUND") {
      setShowRefundDialog(true);
    }
  };

  const handleExtensionSuccess = () => {
    bumpRefresh();
    fetchAllStays();
  };

  // A new stay may arrive with an Advance_Amount already collected, which is one
  // ADVANCE row in the ledger. Refetching the stay list re-points the payment
  // panel at the new stay, and the refresh bump makes sure its ledger is read
  // fresh rather than reused from the previous selection.
  const handleNewStayCreated = () => {
    bumpRefresh();
    fetchAllStays();
    router.refresh();
  };

  if (loading && allStays.length === 0) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton className="h-5 w-5 rounded" />
                  <div className="space-y-1.5 w-full">
                    <Skeleton className="h-3.5 w-20" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  // Is the Current Stay one the cron finished but nobody closed? Drives the
  // card's wording, its badge, and the callout that tells the admin what is
  // left to do.
  const currentStayAwaitingCheckout = !!currentStay && isAwaitingCheckout(currentStay);

  // "Add New Stay" is allowed only when nothing occupies the Current Stay
  // surface. An Awaiting_Checkout stay counts as occupying it: the previous
  // guest's books are still open, and starting a new stay on top of that is how
  // an unsettled balance gets forgotten.
  const canAddNewStay =
    !currentStay ||
    (currentStay.status !== "ACTIVE" &&
      currentStay.status !== "PENDING" &&
      !currentStayAwaitingCheckout);

  const selectedStay = currentLedger?.stay ?? null;
  const visibility = currentLedger?.visibility ?? null;
  const balance = balanceOverride ?? currentLedger?.balance ?? null;

  // The overview card owns the money figures whenever the payment panel is
  // pointed at the very stay it describes. When the panel is aimed elsewhere
  // (a backdated stay still awaiting its final invoice, with no current stay
  // to describe), the panel keeps its own summary cards instead.
  const showFinancialsInOverview =
    !!currentStay && !!selectedStayId && selectedStayId === currentStay.id;

  const paidPercent =
    balance && balance.totalStayAmount > 0
      ? Math.min(
          100,
          Math.max(0, Math.round((balance.totalPaid / balance.totalStayAmount) * 100))
        )
      : 0;

  const canExtendStay = currentStay?.status === "ACTIVE";
  // Recalculate Stay only ever applies to the ACTIVE stay, so it is safe to
  // sit beside Extend Stay in the Current Stay header. It stays available
  // after a first recalculation (Req 12.1, 12.10).
  const canRecalculateStay =
    !!visibility?.showRecalculateStay &&
    !!selectedStay &&
    selectedStay.id === currentStay?.id;

  return (
    <div className="space-y-8">
      {/* ─── Current stay header + primary stay actions ─── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Current Stay</h2>
          <p className="text-sm text-muted-foreground">
            {currentStayAwaitingCheckout
              ? "This stay has ended but has not been checked out yet."
              : "Active or upcoming stay details for this customer."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Extend Stay and Recalculate Stay are the two lifecycle actions on
              a live stay, so they sit side by side in one segmented group. */}
          {(canExtendStay || canRecalculateStay) && (
            <div className="inline-flex items-center rounded-md border bg-background shadow-sm overflow-hidden">
              {canExtendStay && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-none h-9 px-3 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                  onClick={() => setShowExtendDialog(true)}
                >
                  <CalendarPlus className="h-4 w-4 mr-2" />
                  Extend Stay
                </Button>
              )}
              {canExtendStay && canRecalculateStay && (
                <span aria-hidden className="h-5 w-px bg-border" />
              )}
              {canRecalculateStay && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-none h-9 px-3 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                  onClick={() => setShowRecalculateDialog(true)}
                >
                  <Calculator className="h-4 w-4 mr-2" />
                  Recalculate Stay
                </Button>
              )}
            </div>
          )}
          {canAddNewStay && (
            <Button
              variant="default"
              size="sm"
              className="h-9"
              onClick={() => setShowNewStayDialog(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Stay
            </Button>
          )}
        </div>
      </div>

      {currentStay ? (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">
                {currentStayAwaitingCheckout
                  ? "Stay Overview — Awaiting Checkout"
                  : "Active Stay Overview"}
              </CardTitle>
              {/* The raw status would read FINISHED here, which is misleading:
                  the stay is over on the calendar but still open on the books.
                  The badge names the state the admin has to act on. */}
              <Badge
                variant="outline"
                className={getStatusBadgeClasses(
                  currentStayAwaitingCheckout ? "AWAITING CHECKOUT" : currentStay.status
                )}
              >
                {currentStayAwaitingCheckout ? "AWAITING CHECKOUT" : currentStay.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {currentStayAwaitingCheckout && (
              <div className="mb-4 flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
                <div className="text-sm text-orange-900">
                  <p className="font-medium">
                    Ended on {formatDate(currentStay.endDate)} — checkout still
                    pending.
                  </p>
                  <p className="mt-0.5 text-orange-800">
                    Settle the balance first (collect what is owed, or refund the
                    excess), then use Mark as Checked Out below. The checkout will
                    be recorded on {formatDate(currentStay.endDate)}, the stay&apos;s
                    end date.
                  </p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="flex items-start gap-3">
                <Home className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Stay Type</p>
                  <p className="font-semibold">{currentStay.stayType}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Users className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Occupancy</p>
                  <p className="font-semibold">{currentStay.occupancyType}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Start Date</p>
                  <p className="font-semibold">{formatDate(currentStay.startDate)}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">End Date</p>
                  <p className="font-semibold">{formatDate(currentStay.endDate)}</p>
                </div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {currentStay.totalNights} night{currentStay.totalNights !== 1 ? "s" : ""}
                </span>
              </div>
              {currentStay.mealPreference && (
                <Badge variant="secondary">{currentStay.mealPreference}</Badge>
              )}
              {currentStay.paymentHostProfileId && (
                <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">
                  Shared Payment
                </Badge>
              )}
            </div>

            {/* ─── Payment summary for this stay (Total / Paid / Remaining) ─── */}
            {showFinancialsInOverview && (
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Payment Summary
                  </p>
                  {balance &&
                    (balance.isFullyPaid ? (
                      <Badge
                        variant="outline"
                        className="border-emerald-500 bg-emerald-50 text-emerald-700"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        Fully Paid
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-amber-500 bg-amber-50 text-amber-700"
                      >
                        <AlertCircle className="h-3.5 w-3.5 mr-1" />
                        Balance Due
                      </Badge>
                    ))}
                </div>

                {balance ? (
                  <div className="rounded-lg border bg-background/80 p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-0 sm:divide-x sm:divide-border">
                      <div className="flex items-start gap-3 sm:pr-4">
                        <Banknote className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">
                            Total Stay Amount
                          </p>
                          <p className="text-lg font-semibold tabular-nums">
                            {formatRupees(balance.totalStayAmount)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 sm:px-4">
                        <Wallet className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">
                            Total Paid
                          </p>
                          <p className="text-lg font-semibold tabular-nums text-emerald-700">
                            {formatRupees(balance.totalPaid)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 sm:pl-4">
                        <CircleDollarSign
                          className={`h-5 w-5 mt-0.5 shrink-0 ${
                            balance.isFullyPaid ? "text-emerald-600" : "text-amber-600"
                          }`}
                        />
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">
                            Remaining Balance
                          </p>
                          <p
                            className={`text-lg font-semibold tabular-nums ${
                              balance.isFullyPaid ? "text-emerald-700" : "text-amber-700"
                            }`}
                          >
                            {formatRupees(Math.max(0, balance.remainingBalance))}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Paid-vs-total progress */}
                    <div className="mt-4">
                      <div
                        role="progressbar"
                        aria-label="Stay payment collected"
                        aria-valuenow={paidPercent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                      >
                        <div
                          className={`h-full rounded-full transition-all ${
                            balance.isFullyPaid ? "bg-emerald-500" : "bg-amber-500"
                          }`}
                          style={{ width: `${paidPercent}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {paidPercent}% collected
                        {balance.refundDue > 0 && (
                          <span className="text-blue-700 font-medium">
                            {" "}
                            · Refund due {formatRupees(balance.refundDue)}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border bg-background/80 p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="flex items-start gap-3">
                          <Skeleton className="h-5 w-5 rounded" />
                          <div className="space-y-1.5 w-full">
                            <Skeleton className="h-3 w-24" />
                            <Skeleton className="h-5 w-20" />
                          </div>
                        </div>
                      ))}
                    </div>
                    <Skeleton className="mt-4 h-1.5 w-full rounded-full" />
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Home className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground text-center mb-4">No current stay</p>
            <Button variant="default" size="sm" onClick={() => setShowNewStayDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Stay
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Health logs are neither captured nor listed anywhere in the admin
          portal any more. Recording and reviewing readings belongs entirely to
          the Dietitian portal, which reads `v_health_log_timeline` through its
          own scoped path. The `admin_health_logs` / `customer_health_logs`
          tables and that view are all retained — only the admin-side surfaces
          are gone. */}

      {/* ─── Payment & Checkout ─── */}
      {selectedStayId && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-xl font-bold tracking-tight">Payment &amp; Checkout</h2>
              <p className="text-sm text-muted-foreground">
                {selectedStay && selectedStay.id !== currentStay?.id
                  ? `Viewing the stay from ${formatDate(selectedStay.startDate)} to ${formatDate(selectedStay.endDate)}.`
                  : currentStayAwaitingCheckout
                    ? "Settle the balance here, then mark the stay as checked out. Balance is shown in the overview above."
                    : "Payment history and checkout actions for the current stay. Balance is shown in the overview above."}
              </p>
            </div>
            {visibility?.showMarkAsRefunded && (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => setShowRefundDialog(true)}
              >
                <Wallet className="h-4 w-4 mr-2" />
                Mark as refunded
              </Button>
            )}
          </div>

          {/* Record Payment sits directly above Payment History: staff record
              the newest transaction right where they'll immediately see it
              land at the top of the history feed below (Req 5.1-5.7). */}
          {visibility?.showRecordPayment && selectedStay && balance && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Record Payment</CardTitle>
              </CardHeader>
              <CardContent>
                <RecordStayPaymentForm
                  stayId={selectedStayId}
                  remainingBalance={balance.remainingBalance}
                  onSuccess={handlePaymentSuccess}
                  onSettled={handlePaymentSettled}
                />
              </CardContent>
            </Card>
          )}

          <StayPaymentPanel
            stayId={selectedStayId}
            balanceOverride={balanceOverride}
            refreshToken={refreshToken}
            onLedgerChange={handleLedgerChange}
            showSummary={!showFinancialsInOverview}
          />

          {visibility && selectedStay && balance && (
            <StayCheckoutActionBar
              stayId={selectedStayId}
              visibility={visibility}
              remainingBalance={balance.remainingBalance}
              finalInvoiceError={selectedStay.finalInvoiceError}
              endDate={selectedStay.endDate}
              onCheckedOut={handleCheckedOut}
              onInvoiceGenerated={handleInvoiceGenerated}
            />
          )}
        </div>
      )}

      {/* Past stays are NOT listed here. The Customer_360 "Accommodation
          History" tab is the single place that enumerates finished/expired
          stays, so duplicating the list at the bottom of this tab only added
          scroll. This tab stays focused on the current stay and its money. */}

      {/* ─── Add-on service request history (all stays, all statuses) ───
          The Accommodation Customers queue only shows in-house guests, so this
          is where staff can still see what a checked-out guest requested. */}
      <CustomerAddonRequestHistory customerProfileId={customerProfileId} />

      {/* ─── Dialogs ─── */}
      {currentStay?.status === "ACTIVE" && (
        <StayExtensionDialog
          stayId={currentStay.id}
          open={showExtendDialog}
          onOpenChange={setShowExtendDialog}
          onSuccess={handleExtensionSuccess}
        />
      )}

      {selectedStay && (
        <RecalculateStayDialog
          stayId={selectedStay.id}
          startDate={selectedStay.startDate}
          bookedEndDate={selectedStay.endDate}
          currentTotalStayAmount={selectedStay.paymentAmount ?? 0}
          open={showRecalculateDialog}
          onOpenChange={setShowRecalculateDialog}
          onSaved={handleStayDetailsSaved}
        />
      )}

      {selectedStayId && balance && (
        <RecordStayRefundDialog
          stayId={selectedStayId}
          customerProfileId={customerProfileId}
          refundDue={balance.refundDue}
          open={showRefundDialog}
          onOpenChange={setShowRefundDialog}
          onSuccess={handleRefundSuccess}
        />
      )}

      <NewStayDialog
        customerProfileId={customerProfileId}
        open={showNewStayDialog}
        onOpenChange={setShowNewStayDialog}
        onSuccess={handleNewStayCreated}
      />
    </div>
  );
}
