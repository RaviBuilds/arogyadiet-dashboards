"use client";

import React, { useEffect, useState } from "react";
import { format, isValid } from "date-fns";
import { getAllStaysAction } from "@/actions/stayActions";
import type {
  StayEntry,
  StayLedgerView,
  StayBalanceSnapshot,
  EarlyCheckoutOutcome,
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
  LogOut,
  Receipt,
} from "lucide-react";
import { AdminHealthLogForm } from "./AdminHealthLogForm";
import { StayExtensionDialog } from "./StayExtensionDialog";
import { NewStayDialog } from "./NewStayDialog";
import { StayPaymentPanel } from "./StayPaymentPanel";
import { RecordStayPaymentForm } from "./RecordStayPaymentForm";
import { RecordStayRefundDialog } from "./RecordStayRefundDialog";
import { EarlyCheckoutDialog } from "./EarlyCheckoutDialog";
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AccommodationTabProps {
  customerProfileId: string;
}

export function AccommodationTab({ customerProfileId }: AccommodationTabProps) {
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
  const [showEarlyCheckoutDialog, setShowEarlyCheckoutDialog] = useState(false);
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

  // Derive the truly-active stay (for the overview card and health logs) the
  // same way getActiveStayAction did: ACTIVE first, else the earliest PENDING.
  const activeStay = allStays.find((s) => s.status === "ACTIVE") ?? null;
  const earliestPendingStay =
    allStays
      .filter((s) => s.status === "PENDING")
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null;
  const currentStay = activeStay ?? earliestPendingStay;

  const stayHistory = allStays.filter(
    (s) => s.status === "FINISHED" || s.status === "EXPIRED"
  );

  // Default the payment-panel selection: prefer the ACTIVE stay, otherwise
  // the most recent Backdated_Stay still awaiting a final invoice. Keep an
  // existing selection (e.g. from a history row click) if it still exists.
  useEffect(() => {
    if (selectedStayId && allStays.some((s) => s.id === selectedStayId)) {
      return;
    }
    if (activeStay) {
      setSelectedStayId(activeStay.id);
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

  const handleRefundSuccess = (balance: StayBalanceSnapshot) => {
    setBalanceOverride(balance);
    bumpRefresh();
    setShowRefundDialog(false);
  };

  const handleCheckedOut = () => {
    bumpRefresh();
    fetchAllStays();
  };

  const handleInvoiceGenerated = () => {
    bumpRefresh();
    fetchAllStays();
  };

  const handleEarlyCheckoutOutcome = (outcome: EarlyCheckoutOutcome) => {
    bumpRefresh();
    fetchAllStays();
    if (outcome.nextStep === "RECORD_REFUND") {
      setShowRefundDialog(true);
    }
  };

  const handleExtensionSuccess = () => {
    bumpRefresh();
    fetchAllStays();
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

  // Determine if "Add New Stay" is allowed (no ACTIVE or PENDING stay)
  const canAddNewStay = !currentStay || (currentStay.status !== "ACTIVE" && currentStay.status !== "PENDING");

  const selectedStay = currentLedger?.stay ?? null;
  const visibility = currentLedger?.visibility ?? null;
  const balance = balanceOverride ?? currentLedger?.balance ?? null;

  return (
    <div className="space-y-8">
      {/* ─── Active Stay Overview ─── */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Current Stay</h2>
            <p className="text-sm text-muted-foreground">
              Active or upcoming stay details for this customer.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {currentStay?.status === "ACTIVE" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowExtendDialog(true)}
              >
                <CalendarPlus className="h-4 w-4 mr-2" />
                Extend Stay
              </Button>
            )}
            {canAddNewStay && (
              <Button
                variant="default"
                size="sm"
                onClick={() => setShowNewStayDialog(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Stay
              </Button>
            )}
          </div>
        </div>
      </div>

      {currentStay ? (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Active Stay Overview</CardTitle>
              <Badge variant="outline" className={getStatusBadgeClasses(currentStay.status)}>
                {currentStay.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
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
            <div className="mt-4 pt-4 border-t flex items-center gap-4">
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

      {/* ─── Health Logs Section (Req 13.5, 13.6) ─── */}
      {currentStay?.status === "ACTIVE" && (
        <AdminHealthLogForm stayId={currentStay.id} />
      )}

      {/* ─── Payment & Checkout ─── */}
      {selectedStayId && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-xl font-bold tracking-tight">Payment &amp; Checkout</h2>
              <p className="text-sm text-muted-foreground">
                {selectedStay && selectedStay.id !== currentStay?.id
                  ? `Viewing the stay from ${formatDate(selectedStay.startDate)} to ${formatDate(selectedStay.endDate)}.`
                  : "Balance, payment history, and checkout actions for the current stay."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {visibility?.showEarlyCheckout && selectedStay && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowEarlyCheckoutDialog(true)}
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Early Checkout
                </Button>
              )}
              {balance && balance.refundDue > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowRefundDialog(true)}
                >
                  <Wallet className="h-4 w-4 mr-2" />
                  Record Refund
                </Button>
              )}
            </div>
          </div>

          <StayPaymentPanel
            stayId={selectedStayId}
            balanceOverride={balanceOverride}
            refreshToken={refreshToken}
            onLedgerChange={handleLedgerChange}
          />

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

          {visibility && selectedStay && balance && (
            <StayCheckoutActionBar
              stayId={selectedStayId}
              visibility={visibility}
              remainingBalance={balance.remainingBalance}
              finalInvoiceError={selectedStay.finalInvoiceError}
              onCheckedOut={handleCheckedOut}
              onInvoiceGenerated={handleInvoiceGenerated}
            />
          )}
        </div>
      )}

      {/* ─── Stay History ─── */}
      <div>
        <h2 className="text-xl font-bold tracking-tight">Stay History</h2>
        <p className="text-sm text-muted-foreground">
          All past stays for this customer.
        </p>
      </div>

      {stayHistory.length > 0 ? (
        <div className="space-y-3">
          {stayHistory.map((stay) => (
            <Card key={stay.id} className={stay.id === selectedStayId ? "border-primary/40" : undefined}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Dates</p>
                      <p className="text-sm font-semibold">
                        {formatDate(stay.startDate)} — {formatDate(stay.endDate)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Nights</p>
                      <p className="text-sm font-semibold">{stay.totalNights}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Type</p>
                      <p className="text-sm font-semibold">{stay.stayType}</p>
                    </div>
                    {stay.isBackdated && (
                      <Badge variant="secondary" className="bg-purple-50 text-purple-700 border-purple-200">
                        Backdated
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={getStatusBadgeClasses(stay.status)}>
                      {stay.status}
                    </Badge>
                    {stay.status === "FINISHED" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedStayId(stay.id)}
                        disabled={stay.id === selectedStayId}
                      >
                        <Receipt className="h-4 w-4 mr-2" />
                        {stay.id === selectedStayId ? "Selected" : "View Payment Details"}
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No past stay records available.</p>
          </CardContent>
        </Card>
      )}

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
        <EarlyCheckoutDialog
          stayId={selectedStay.id}
          bookedTotalNights={selectedStay.totalNights}
          open={showEarlyCheckoutDialog}
          onOpenChange={setShowEarlyCheckoutDialog}
          onOutcome={handleEarlyCheckoutOutcome}
        />
      )}

      {selectedStayId && balance && (
        <RecordStayRefundDialog
          stayId={selectedStayId}
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
        onSuccess={fetchAllStays}
      />
    </div>
  );
}
