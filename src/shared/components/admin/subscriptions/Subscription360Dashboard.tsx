"use client";

import React, { useState, useTransition } from "react";
import { AdminSubmenuBar } from "@/shared/components/admin/core/AdminSubmenuBar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/shared/components/ui/dialog";
import { Label } from "@/shared/components/ui/label";
import { Input } from "@/shared/components/ui/input";
import {
  Select as UISelect,
  SelectContent as UISelectContent,
  SelectItem as UISelectItem,
  SelectTrigger as UISelectTrigger,
  SelectValue as UISelectValue,
} from "@/shared/components/ui/select";
import { format, addDays, parseISO } from "date-fns";
import {
  MapPin,
  CalendarDays,
  Clock,
  Edit,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  OctagonX,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  managePendingSubscription,
  updateActiveSubscriptionDates,
  stopActiveSubscription,
  recalculateSubscriptionTenureAction,
} from "@/actions/admin-actions/adminLifecycleActions";
import { AdminPauseClient } from "@/shared/components/admin/subscriptions/AdminPauseClient";
import { AdminMealPlannerClient } from "@/shared/components/admin/subscriptions/AdminMealPlannerClient";
import { AdminDeliveryRoutingClient } from "@/shared/components/admin/subscriptions/AdminDeliveryRoutingClient";
import { RecalculateTenureDialog } from "@/shared/components/admin/subscriptions/RecalculateTenureDialog";

export function Subscription360Dashboard({
  subscription,
  dailyPrefs,
  allCustomerSubs,
  mealCategories,
  deliveryOrders,
  invoicePayment,
  actions,
}: {
  subscription: any;
  dailyPrefs: any[];
  allCustomerSubs: any[];
  mealCategories: any[];
  deliveryOrders: any[];
  /** meal-subscription-early-closure: the SUBSCRIPTION invoice row (base_amount, tax_amount, delivery_charge, misc_charge, amount_paid), needed by the Recalculate Tenure dialog. */
  invoicePayment?: {
    base_amount: number | string | null;
    tax_amount: number | string | null;
    delivery_charge: number | string | null;
    misc_charge: number | string | null;
    misc_charge_label: string | null;
    amount: number | string | null;
    amount_paid: number | string | null;
  } | null;
  actions?: {
    managePendingSubscription?: typeof managePendingSubscription;
    updateActiveSubscriptionDates?: typeof updateActiveSubscriptionDates;
    stopActiveSubscription?: typeof stopActiveSubscription;
    recalculateSubscriptionTenure?: typeof recalculateSubscriptionTenureAction;
    bulkUpdatePausePreferences?: any;
    bulkUpdateMealPreferences?: any;
    bulkUpdateAddressPreferences?: any;
  };
}) {
  const router = useRouter();

  // Resolve lifecycle actions — default to admin actions, override with franchise-scoped ones when provided.
  const managePendingAction =
    actions?.managePendingSubscription ?? managePendingSubscription;
  const updateActiveAction =
    actions?.updateActiveSubscriptionDates ?? updateActiveSubscriptionDates;
  const recalculateTenureAction =
    actions?.recalculateSubscriptionTenure ?? recalculateSubscriptionTenureAction;
  const [activeTab, setActiveTab] = useState("Subscription Details");
  const tabs = [
    "Subscription Details",
    "Pause Schedule",
    "Meal Planner",
    "Delivery Routing",
    "Lifecycle & History",
  ];

  const plan = subscription?.subscription_plans;
  const addresses = subscription?.customer_profiles?.addresses || [];

  const scheduleDays = dailyPrefs.map((p: any) => p.preference_date);
  const initialPausedDates = dailyPrefs
    .filter((p: any) => p.is_paused)
    .map((p: any) => p.preference_date);

  const pendingSubs = allCustomerSubs.filter((s) => s.status === "PENDING");
  const expiredSubs = allCustomerSubs.filter((s) => s.status === "EXPIRED");
  const stoppedSubs = allCustomerSubs.filter(
    (s) => s.status === "STOPPED" || s.status === "CANCELLED",
  );

  const [isPending, startTransition] = useTransition();

  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [selectedPendingSub, setSelectedPendingSub] = useState<any>(null);
  const [pendingForm, setPendingForm] = useState({
    starts_on: "",
    status: "PENDING",
  });

  const [isEditActiveModalOpen, setIsEditActiveModalOpen] = useState(false);
  const [activeEditForm, setActiveEditForm] = useState({
    starts_on: "",
    pause_credits_total: 0,
  });

  const [isRecalculateModalOpen, setIsRecalculateModalOpen] = useState(false);

  const todayStr = format(new Date(), "yyyy-MM-dd");

  const activeSubscription = allCustomerSubs.find((s) => s.status === "ACTIVE");
  const minPendingStartDateStr = activeSubscription?.effective_end_on
    ? format(
        addDays(parseISO(activeSubscription.effective_end_on), 1),
        "yyyy-MM-dd",
      )
    : format(addDays(new Date(), 1), "yyyy-MM-dd");

  const isStartDateEditable = subscription.starts_on > todayStr;
  const earliestStartDateStr = format(addDays(new Date(), 1), "yyyy-MM-dd");

  const openManageModal = (sub: any) => {
    setSelectedPendingSub(sub);
    setPendingForm({
      starts_on: sub.starts_on || minPendingStartDateStr,
      status: sub.status === "QUEUED" ? "PENDING" : sub.status,
    });
    setIsManageModalOpen(true);
  };

  const handleSavePending = () => {
    if (!selectedPendingSub) return;
    if (new Date(pendingForm.starts_on) < new Date(minPendingStartDateStr)) {
      toast.error(
        `Start date cannot be before ${format(new Date(minPendingStartDateStr), "MMM d, yyyy")} to prevent overlap.`,
      );
      return;
    }

    startTransition(async () => {
      const res = await managePendingAction(
        selectedPendingSub.id,
        pendingForm,
      );
      if (res.success) {
        toast.success("Subscription updated successfully!");
        setIsManageModalOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const openActiveEditModal = () => {
    setActiveEditForm({
      starts_on: subscription.starts_on || "",
      pause_credits_total: subscription.pause_credits_total || 0,
    });
    setIsEditActiveModalOpen(true);
  };

  const handleSaveActiveEdit = () => {
    if (
      isStartDateEditable &&
      activeEditForm.starts_on < earliestStartDateStr
    ) {
      toast.error(
        `Start date cannot be before ${format(new Date(earliestStartDateStr), "MMM d, yyyy")}.`,
      );
      return;
    }

    startTransition(async () => {
      const res = await updateActiveAction(
        subscription.id,
        activeEditForm,
      );
      if (res.success) {
        toast.success("Active subscription details updated!");
        setIsEditActiveModalOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-500">
      <AdminSubmenuBar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <div className="mt-8">
        {activeTab === "Subscription Details" && (
          <div className="space-y-6">
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={openActiveEditModal}
                className="bg-primary/5 text-primary border-primary/20 hover:bg-primary/10"
              >
                <Edit className="h-4 w-4 mr-2" /> Edit Dates & Credits
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="border-2 border-zinc-100 shadow-sm">
                <CardHeader className="bg-zinc-50/50 border-b pb-4">
                  <div className="flex items-start justify-between">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <CalendarDays className="h-5 w-5 text-primary" /> Plan
                      Timeline
                    </CardTitle>
                    <Badge className="bg-green-100 text-green-800 border-green-200">
                      {subscription.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-6 grid gap-6">
                  <div>
                    <h3 className="font-black text-xl text-zinc-900">
                      {plan?.name || "Custom Plan"}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {subscription.total_days} Meals Total
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4 border-t pt-4">
                    <div>
                      <p className="text-xs uppercase font-bold tracking-wider text-muted-foreground mb-1">
                        Start Date
                      </p>
                      <p className="font-semibold text-zinc-900">
                        {subscription.starts_on
                          ? format(
                              new Date(subscription.starts_on),
                              "MMM d, yyyy",
                            )
                          : "N/A"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase font-bold tracking-wider text-muted-foreground mb-1">
                        Effective End Date
                      </p>
                      <p className="font-semibold text-zinc-900 flex items-center gap-1.5">
                        {subscription.effective_end_on
                          ? format(
                              new Date(subscription.effective_end_on),
                              "MMM d, yyyy",
                            )
                          : "N/A"}
                        {subscription.effective_end_on !==
                          subscription.ends_on && (
                          <span
                            className="flex h-2 w-2 rounded-full bg-amber-500"
                            title="End date extended due to pauses"
                          ></span>
                        )}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-2 border-zinc-100 shadow-sm">
                <CardHeader className="bg-zinc-50/50 border-b pb-4">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Clock className="h-5 w-5 text-primary" /> Pause Credits
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6 flex flex-col justify-center h-[calc(100%-65px)]">
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-4xl font-black text-zinc-900">
                      {subscription.pause_credits_used || 0}
                    </span>
                    <span className="text-sm font-bold text-muted-foreground">
                      / {subscription.pause_credits_total || 0} Used
                    </span>
                  </div>
                  <div className="w-full bg-zinc-100 h-2.5 rounded-full overflow-hidden mb-4">
                    <div
                      className="bg-primary h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, ((subscription.pause_credits_used || 0) / (subscription.pause_credits_total || 1)) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {(subscription.pause_credits_total || 0) -
                      (subscription.pause_credits_used || 0)}{" "}
                    credits remaining. Pausing a delivery automatically pushes
                    the effective end date.
                  </p>
                </CardContent>
              </Card>

              <Card className="md:col-span-2 border-2 border-zinc-100 shadow-sm">
                <CardHeader className="bg-zinc-50/50 border-b pb-4 flex flex-row items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <MapPin className="h-5 w-5 text-primary" /> Saved Delivery
                    Addresses
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-6 flex items-start gap-3">
                    <Clock className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                    <p className="text-sm text-blue-800">
                      <strong>Read-Only View:</strong> Addresses are managed
                      globally at the customer level. To add or edit addresses,
                      please visit the{" "}
                      <strong className="underline">
                        Customer 360 Dashboard
                      </strong>
                      .
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {addresses.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic col-span-2">
                        No addresses saved for this customer.
                      </p>
                    ) : (
                      addresses.map((addr: any) => (
                        <div
                          key={addr.id}
                          className="p-4 border rounded-xl bg-white flex gap-3 relative"
                        >
                          <MapPin className="h-5 w-5 text-zinc-400 shrink-0 mt-0.5" />
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-bold text-sm text-zinc-900">
                                {addr.tag}
                              </span>
                              {addr.is_primary && (
                                <span className="bg-green-100 text-green-700 text-[10px] px-2 py-0.5 rounded font-bold">
                                  PRIMARY
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {addr.street_1},{" "}
                              {addr.street_2 && `${addr.street_2}, `}
                              {addr.city}, {addr.pincode}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* PAUSE SCHEDULE TAB */}
        {activeTab === "Pause Schedule" && (
          <AdminPauseClient
            subscriptionId={subscription.id}
            scheduleDays={scheduleDays}
            initialPausedDates={initialPausedDates}
            maxPauses={subscription.pause_credits_total || 0}
            initialPausesUsed={subscription.pause_credits_used || 0}
            pauseAction={actions?.bulkUpdatePausePreferences}
          />
        )}

        {/* MEAL PLANNER TAB */}
        {activeTab === "Meal Planner" && (
          <AdminMealPlannerClient
            subscriptionId={subscription.id}
            dailyPrefs={dailyPrefs}
            mealCategories={mealCategories}
            customerDietaryPreference={subscription.customer_profiles?.dietary_preference}
            deliveryOrders={deliveryOrders}
            mealAction={actions?.bulkUpdateMealPreferences}
          />
        )}

        {/* LIFECYCLE & HISTORY TAB */}
        {activeTab === "Lifecycle & History" && (
          <div className="space-y-8">

            {/* ── ACTIVE SUBSCRIPTION STATUS SECTION ─────────────────────── */}
            {subscription.status === "ACTIVE" && (
              <div>
                <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
                  <ShieldAlert className="h-5 w-5 text-red-500" /> Active Subscription Status
                </h3>
                <Card className="border-2 border-red-100 bg-red-50/20 shadow-sm">
                  <CardContent className="p-6">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge className="bg-green-100 text-green-800 border-green-200">
                            ACTIVE
                          </Badge>
                          <span className="font-bold text-zinc-900">
                            {subscription.subscription_plans?.name || "Custom Plan"}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Running from{" "}
                          <span className="font-medium text-zinc-800">
                            {subscription.starts_on
                              ? format(new Date(subscription.starts_on), "MMM d, yyyy")
                              : "N/A"}
                          </span>{" "}
                          through{" "}
                          <span className="font-medium text-zinc-800">
                            {subscription.effective_end_on
                              ? format(new Date(subscription.effective_end_on), "MMM d, yyyy")
                              : "N/A"}
                          </span>
                        </p>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setIsRecalculateModalOpen(true)}
                        className="shrink-0 gap-2"
                      >
                        <OctagonX className="h-4 w-4" />
                        Recalculate Subscription Tenure
                      </Button>
                    </div>
                    <div className="mt-4 bg-red-100/60 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                      <p className="text-xs text-red-800">
                        <strong>Critical action:</strong> Use this to end the subscription early. Choose a
                        shortened end date and re-price the plan — deliveries continue through the new end
                        date, then the subscription expires automatically and cannot be reactivated.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            <div>
              <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
                <Clock className="h-5 w-5 text-amber-500" /> Pending
                Subscriptions
              </h3>
              {pendingSubs.length === 0 ? (
                <Card className="border-dashed shadow-none">
                  <CardContent className="p-8 text-center text-muted-foreground">
                    No pending subscriptions found.
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {pendingSubs.map((sub) => (
                    <Card
                      key={sub.id}
                      className="border-amber-200 bg-amber-50/30"
                    >
                      <CardContent className="p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div>
                          <Badge className="bg-amber-100 text-amber-800 border-amber-200 mb-2 hover:bg-amber-100">
                            {sub.status}
                          </Badge>
                          <p className="font-bold text-zinc-900">
                            {sub.subscription_plans?.name}
                          </p>
                          <p className="text-sm text-muted-foreground mt-1">
                            Starts:{" "}
                            <span className="font-medium text-zinc-900">
                              {sub.starts_on
                                ? format(new Date(sub.starts_on), "MMM d, yyyy")
                                : "TBD"}
                            </span>
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openManageModal(sub)}
                          className="w-full sm:w-auto bg-white border-amber-300 text-amber-900 hover:bg-amber-50"
                        >
                          Manage
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
                <CheckCircle2 className="h-5 w-5 text-zinc-400" /> Expired
                History
              </h3>
              <Card className="overflow-hidden border shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted/50 border-b text-muted-foreground uppercase text-xs tracking-wider">
                      <tr>
                        <th className="px-6 py-4 font-bold">Plan Name</th>
                        <th className="px-6 py-4 font-bold">Start Date</th>
                        <th className="px-6 py-4 font-bold">End Date</th>
                        <th className="px-6 py-4 font-bold">Credits Used</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {expiredSubs.length === 0 ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-6 py-8 text-center text-muted-foreground"
                          >
                            No expired history.
                          </td>
                        </tr>
                      ) : (
                        expiredSubs.map((sub) => (
                          <tr key={sub.id} className="hover:bg-muted/30">
                            <td className="px-6 py-4 font-bold text-zinc-700">
                              {sub.subscription_plans?.name}
                            </td>
                            <td className="px-6 py-4">
                              {sub.starts_on
                                ? format(new Date(sub.starts_on), "MMM d, yyyy")
                                : "N/A"}
                            </td>
                            <td className="px-6 py-4">
                              {sub.effective_end_on
                                ? format(
                                    new Date(sub.effective_end_on),
                                    "MMM d, yyyy",
                                  )
                                : "N/A"}
                            </td>
                            <td className="px-6 py-4">
                              {sub.pause_credits_used} /{" "}
                              {sub.pause_credits_total}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            <div>
              <h3 className="text-lg font-bold flex items-center gap-2 mb-4 text-red-600">
                <XCircle className="h-5 w-5 text-red-500" /> Stopped / Cancelled
              </h3>
              <Card className="overflow-hidden border-red-100 shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-red-50/50 border-b border-red-100 text-red-800 uppercase text-xs tracking-wider">
                      <tr>
                        <th className="px-6 py-4 font-bold">Plan Name</th>
                        <th className="px-6 py-4 font-bold">Start Date</th>
                        <th className="px-6 py-4 font-bold">End Date</th>
                        <th className="px-6 py-4 font-bold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-red-50">
                      {stoppedSubs.length === 0 ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-6 py-8 text-center text-red-400"
                          >
                            No stopped subscriptions.
                          </td>
                        </tr>
                      ) : (
                        stoppedSubs.map((sub) => (
                          <tr key={sub.id} className="hover:bg-red-50/30">
                            <td className="px-6 py-4 font-bold text-zinc-700">
                              {sub.subscription_plans?.name}
                            </td>
                            <td className="px-6 py-4">
                              {sub.starts_on
                                ? format(new Date(sub.starts_on), "MMM d, yyyy")
                                : "N/A"}
                            </td>
                            <td className="px-6 py-4">
                              {sub.effective_end_on
                                ? format(
                                    new Date(sub.effective_end_on),
                                    "MMM d, yyyy",
                                  )
                                : "N/A"}
                            </td>
                            <td className="px-6 py-4">
                              <Badge variant="destructive">{sub.status}</Badge>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* Delivery Routing Tab */}
        {activeTab === "Delivery Routing" && (
          <AdminDeliveryRoutingClient
            subscriptionId={subscription.id}
            scheduleDays={scheduleDays}
            initialAddressMap={dailyPrefs?.reduce((acc: any, p: any) => {
              if (p.delivery_address_id) {
                acc[p.preference_date] = p.delivery_address_id;
              }
              return acc;
            }, {}) || {}}
            availableAddresses={addresses || []}
            pausedDates={initialPausedDates}
            addressAction={actions?.bulkUpdateAddressPreferences}
          />
        )}
      </div>

      {/* MANAGE PENDING MODAL */}
      <Dialog open={isManageModalOpen} onOpenChange={setIsManageModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Manage Pending Subscription</DialogTitle>
          </DialogHeader>
          <div className="grid gap-6 py-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                To prevent overlap, the new start date must be on or after{" "}
                <strong>
                  {format(new Date(minPendingStartDateStr), "MMM d, yyyy")}
                </strong>
                .
              </p>
            </div>

            <div className="grid gap-2">
              <Label className="font-medium">Scheduled Start Date</Label>
              <Input
                type="date"
                min={minPendingStartDateStr}
                value={pendingForm.starts_on}
                onChange={(e) =>
                  setPendingForm({ ...pendingForm, starts_on: e.target.value })
                }
              />
            </div>

            <div className="grid gap-2">
              <Label className="font-medium">Update Status</Label>
              <UISelect
                value={pendingForm.status}
                onValueChange={(val) =>
                  setPendingForm({ ...pendingForm, status: val })
                }
              >
                <UISelectTrigger>
                  <UISelectValue />
                </UISelectTrigger>
                <UISelectContent>
                  <UISelectItem value="PENDING">
                    Keep Pending
                  </UISelectItem>
                  <UISelectItem value="ACTIVE">Mark as ACTIVE</UISelectItem>
                  <UISelectItem value="STOPPED">
                    Mark as STOPPED (Cancel)
                  </UISelectItem>
                </UISelectContent>
              </UISelect>
            </div>
          </div>
          <DialogFooter className="flex pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => setIsManageModalOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSavePending}
              disabled={isPending}
              className="bg-primary hover:bg-primary/90"
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{" "}
              Save Updates
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RECALCULATE SUBSCRIPTION TENURE MODAL (meal-subscription-early-closure) */}
      {invoicePayment && (
        <RecalculateTenureDialog
          open={isRecalculateModalOpen}
          onOpenChange={setIsRecalculateModalOpen}
          subscriptionId={subscription.id}
          planName={subscription.subscription_plans?.name || "Custom Plan"}
          startsOn={subscription.starts_on}
          currentEffectiveEndOn={
            subscription.effective_end_on ?? subscription.ends_on
          }
          invoice={{
            baseAmount: Number(invoicePayment.base_amount ?? 0),
            taxAmount: Number(invoicePayment.tax_amount ?? 0),
            deliveryCharge: Number(invoicePayment.delivery_charge ?? 0),
            miscCharge: Number(invoicePayment.misc_charge ?? 0),
            miscChargeLabel: invoicePayment.misc_charge_label ?? null,
            totalPayable: Number(invoicePayment.amount ?? 0),
            amountPaid: Number(invoicePayment.amount_paid ?? 0),
          }}
          recalculateAction={recalculateTenureAction}
        />
      )}

      {/* EDIT ACTIVE SUBSCRIPTION MODAL */}
      <Dialog
        open={isEditActiveModalOpen}
        onOpenChange={setIsEditActiveModalOpen}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Active Plan Rules</DialogTitle>
          </DialogHeader>
          <div className="grid gap-6 py-4">
            {!isStartDateEditable ? (
              <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-3 flex items-start gap-3">
                <Clock className="h-5 w-5 text-zinc-400 shrink-0 mt-0.5" />
                <p className="text-sm text-zinc-600">
                  <strong>Start Date is locked.</strong> This subscription has
                  already begun. You can only modify future pause credit limits.
                </p>
              </div>
            ) : (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                <p className="text-sm text-blue-800">
                  You can change the start date to any day on or after{" "}
                  <strong>
                    {format(new Date(earliestStartDateStr), "MMM d, yyyy")}
                  </strong>
                  .
                </p>
              </div>
            )}

            <div className="grid gap-2">
              <Label className="font-medium text-zinc-700">Start Date</Label>
              <Input
                type="date"
                value={activeEditForm.starts_on}
                min={earliestStartDateStr}
                disabled={!isStartDateEditable}
                onChange={(e) =>
                  setActiveEditForm({
                    ...activeEditForm,
                    starts_on: e.target.value,
                  })
                }
                className={
                  !isStartDateEditable
                    ? "bg-zinc-100 text-zinc-500 cursor-not-allowed"
                    : ""
                }
              />
            </div>

            <div className="grid gap-2 border-t pt-4 mt-2">
              <Label className="font-medium text-zinc-700">
                Total Pause Credits Allowed
              </Label>
              <Input
                type="number"
                value={activeEditForm.pause_credits_total}
                onChange={(e) =>
                  setActiveEditForm({
                    ...activeEditForm,
                    pause_credits_total: Number(e.target.value),
                  })
                }
              />
              <p className="text-xs text-muted-foreground mt-1">
                Currently used: {subscription.pause_credits_used || 0}. Used
                credits are calculated automatically from the Pause Schedule
                calendar.
              </p>
            </div>
          </div>
          <DialogFooter className="flex pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => setIsEditActiveModalOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveActiveEdit}
              disabled={isPending}
              className="bg-primary hover:bg-primary/90"
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{" "}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
