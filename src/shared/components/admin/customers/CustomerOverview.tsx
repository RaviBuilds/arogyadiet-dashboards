"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CirclePause,
  ClipboardList,
  HeartPulse,
  Home,
  Loader2,
  Package,
  Salad,
  ShieldCheck,
  Sparkles,
  Truck,
  UserCheck,
  UserPlus,
  UserRoundX,
  Users,
} from "lucide-react";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

import {
  listOnboardedCustomersAction,
  listCompletedCustomersAction,
} from "@/actions/admin-actions/onboardingActions";
import type { CustomerRow } from "@/repositories/customerOnboardingRepository";
import {
  getBulkKitShippingStatusAction,
  type KitCustomerShippingStatus,
} from "@/actions/admin-actions/kitCustomerShippingActions";
import {
  getBulkAccommodationStayInfoAction,
  type AccommodationCustomerStayInfo,
} from "@/actions/admin-actions/accommodationCustomerActions";
import {
  getAccommodationAddonRequestsAction,
  type AccommodationAddonRequest,
} from "@/actions/admin-actions/accommodationCustomerActions";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CustomerOverviewCustomer {
  id: string;
  fullName: string;
  dietary_preference: string;
  status: string;
  allergies: string | null;
  hasMedicalHistory: boolean;
  activePlanName: string | null;
  customerCategory: string | null;
  isActive: boolean;
  dietitianId?: string | null;
  dietitianName?: string | null;
}

interface CustomerOverviewSubscription {
  id: string;
  customer_name: string;
  plan_name: string;
  total_days: number;
  starts_on: string;
  ends_on: string;
  pause_credits_total: number;
  pause_credits_used: number;
  status: string;
}

interface CustomerOverviewProps {
  customers: CustomerOverviewCustomer[];
  activeSubscriptions: CustomerOverviewSubscription[];
  pendingSubscriptions: CustomerOverviewSubscription[];
  stoppedSubscriptions: CustomerOverviewSubscription[];
  onNavigate: (tab: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatDate = (value?: string | null) => {
  if (!value) return "N/A";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const getPercent = (value: number, total: number) => {
  if (!total) return 0;
  return Math.min(100, Math.round((value / total) * 100));
};

// ─── Main Component ───────────────────────────────────────────────────────────

export function CustomerOverview({
  customers,
  activeSubscriptions,
  pendingSubscriptions,
  stoppedSubscriptions,
  onNavigate,
}: CustomerOverviewProps) {
  const router = useRouter();

  // ── Async data states ─────────────────────────────────────────────────────
  const [onboardingCustomers, setOnboardingCustomers] = useState<CustomerRow[]>([]);
  const [completedOnboarding, setCompletedOnboarding] = useState<CustomerRow[]>([]);
  const [kitShippingStatuses, setKitShippingStatuses] = useState<KitCustomerShippingStatus[]>([]);
  const [stayInfoList, setStayInfoList] = useState<AccommodationCustomerStayInfo[]>([]);
  const [addonRequests, setAddonRequests] = useState<AccommodationAddonRequest[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Derived customer segments ─────────────────────────────────────────────
  const mealCustomers = useMemo(
    () => customers.filter((c) => c.customerCategory !== "KIT" && c.customerCategory !== "ACCOMMODATION" && c.isActive),
    [customers]
  );
  const kitCustomers = useMemo(
    () => customers.filter((c) => c.customerCategory === "KIT" && c.isActive),
    [customers]
  );
  const accommodationCustomers = useMemo(
    () => customers.filter((c) => c.customerCategory === "ACCOMMODATION" && c.isActive),
    [customers]
  );

  // ── Fetch supplementary data on mount ─────────────────────────────────────
  const fetchSideData = useCallback(async () => {
    setLoading(true);
    try {
      const [onboardRes, completedRes] = await Promise.all([
        listOnboardedCustomersAction(),
        listCompletedCustomersAction(),
      ]);
      if (onboardRes.success) setOnboardingCustomers(onboardRes.customers);
      if (completedRes.success) setCompletedOnboarding(completedRes.customers);

      // KIT shipping
      const kitIds = kitCustomers.map((c) => c.id);
      if (kitIds.length > 0) {
        const shipRes = await getBulkKitShippingStatusAction(kitIds);
        if (shipRes.success) setKitShippingStatuses(shipRes.data);
      }

      // Accommodation stay info + addon requests
      const accomIds = accommodationCustomers.map((c) => c.id);
      if (accomIds.length > 0) {
        const [stayRes, addonRes] = await Promise.all([
          getBulkAccommodationStayInfoAction(accomIds),
          getAccommodationAddonRequestsAction(accomIds),
        ]);
        if ("success" in stayRes && stayRes.success) setStayInfoList(stayRes.data);
        if ("success" in addonRes && addonRes.success) setAddonRequests(addonRes.data);
      }
    } catch (err) {
      console.error("Overview fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [kitCustomers, accommodationCustomers]);

  useEffect(() => {
    fetchSideData();
  }, [fetchSideData]);

  // Most recent stay status per accommodation customer, keyed by profile ID.
  const stayStatusById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const info of stayInfoList) map.set(info.customerProfileId, info.stayStatus);
    return map;
  }, [stayInfoList]);

  /**
   * The lifecycle status to report for a customer in the Status Overview.
   *
   * An accommodation customer's real lifecycle lives on their stay entry, not
   * on the subscription row — a confirmed-but-not-started stay is PENDING while
   * its subscription is already ACTIVE. Reading `customer.status` alone would
   * file those customers under "Active Plan" and under-report Pending, so
   * accommodation rows are classified by stay status and every other category
   * keeps its subscription-derived status.
   */
  const effectiveStatus = useCallback(
    (customer: CustomerOverviewCustomer): string => {
      if (customer.customerCategory !== "ACCOMMODATION") return customer.status;

      const stayStatus = stayStatusById.get(customer.id);
      // Stay info still loading — fall back to the subscription status.
      if (stayStatus === undefined) return customer.status;

      switch (stayStatus) {
        case "PENDING":
          return "Pending";
        case "ACTIVE":
          return "Active";
        case "FINISHED":
        case "EXPIRED":
          return "Expired";
        default:
          return "No Plan";
      }
    },
    [stayStatusById],
  );

  // ── Computed metrics ──────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const activeCustomers = customers.filter((c) => c.isActive);
    const totalActive = activeCustomers.length;
    const mealCount = mealCustomers.length;
    const kitCount = kitCustomers.length;
    const accomCount = accommodationCustomers.length;

    // Status breakdown across active customers, using the per-category
    // lifecycle status so accommodation stays are represented accurately.
    const statuses = activeCustomers.map(effectiveStatus);
    const withActivePlan = statuses.filter((s) => s === "Active").length;
    const pendingStatus = statuses.filter((s) => s === "Pending").length;
    const expiredStatus = statuses.filter((s) => s === "Expired" || s === "Stopped").length;
    const noPlan = statuses.filter((s) => s === "No Plan").length;

    // Dietitian assignment
    const noDietitian = activeCustomers.filter((c) => !c.dietitianId).length;

    // Health flags (meal only)
    const medicalHistory = mealCustomers.filter((c) => c.hasMedicalHistory).length;
    const withAllergies = mealCustomers.filter((c) => {
      const a = c.allergies?.trim().toLowerCase();
      return a && a !== "none" && a !== "no allergy";
    }).length;

    // Dietary distribution
    const dietDistribution = activeCustomers.reduce<Record<string, number>>((acc, c) => {
      const key = c.dietary_preference || "N/A";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    // Subscriptions
    const endingSoon = [...activeSubscriptions]
      .filter((s) => s.ends_on)
      .sort((a, b) => new Date(a.ends_on).getTime() - new Date(b.ends_on).getTime())
      .slice(0, 5);

    const pauseCreditsTotal = activeSubscriptions.reduce((s, sub) => s + (sub.pause_credits_total || 0), 0);
    const pauseCreditsUsed = activeSubscriptions.reduce((s, sub) => s + (sub.pause_credits_used || 0), 0);

    return {
      totalActive,
      mealCount,
      kitCount,
      accomCount,
      withActivePlan,
      pendingStatus,
      expiredStatus,
      noPlan,
      noDietitian,
      medicalHistory,
      withAllergies,
      dietDistribution: Object.entries(dietDistribution).sort((a, b) => b[1] - a[1]),
      activeSubsCount: activeSubscriptions.length,
      pendingSubsCount: pendingSubscriptions.length,
      stoppedSubsCount: stoppedSubscriptions.length,
      endingSoon,
      pauseCreditsTotal,
      pauseCreditsUsed,
      pausePercent: getPercent(pauseCreditsUsed, pauseCreditsTotal),
    };
  }, [customers, mealCustomers, kitCustomers, accommodationCustomers, activeSubscriptions, pendingSubscriptions, stoppedSubscriptions, effectiveStatus]);

  // ── KIT shipping metrics ──────────────────────────────────────────────────
  const kitShipMetrics = useMemo(() => {
    const notShipped = kitShippingStatuses.filter((s) => s.status === "Not Shipped").length;
    const shipped = kitShippingStatuses.filter((s) => s.status === "Shipped").length;
    const delivered = kitShippingStatuses.filter((s) => s.status === "Delivered").length;
    return { notShipped, shipped, delivered };
  }, [kitShippingStatuses]);

  // ── Accommodation stay metrics ────────────────────────────────────────────
  const stayMetrics = useMemo(() => {
    const active = stayInfoList.filter((s) => s.stayStatus === "ACTIVE").length;
    const pending = stayInfoList.filter((s) => s.stayStatus === "PENDING").length;
    const finished = stayInfoList.filter((s) => s.stayStatus === "FINISHED").length;
    const noStay = stayInfoList.filter((s) => !s.stayStatus).length;
    return { active, pending, finished, noStay };
  }, [stayInfoList]);

  // ── Addon request metrics ─────────────────────────────────────────────────
  const addonMetrics = useMemo(() => {
    const pendingReqs = addonRequests.filter((r) => r.status === "PENDING").length;
    const confirmedReqs = addonRequests.filter((r) => r.status === "CONFIRMED").length;
    const completedReqs = addonRequests.filter((r) => r.status === "COMPLETED").length;
    return { pendingReqs, confirmedReqs, completedReqs, total: addonRequests.length };
  }, [addonRequests]);

  // ── Onboarding metrics ────────────────────────────────────────────────────
  const onboardMetrics = useMemo(() => {
    const inProgress = onboardingCustomers.length;
    const completed = completedOnboarding.length;
    const total = inProgress + completed;
    const recentOnboarded = onboardingCustomers
      .filter((c) => c.createdAt)
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
      .slice(0, 5);
    return { inProgress, completed, total, recentOnboarded };
  }, [onboardingCustomers, completedOnboarding]);

  // ── Action items that need attention ──────────────────────────────────────
  const actionItems = useMemo(() => {
    const items: { label: string; count: number; tab: string; color: string }[] = [];
    if (onboardMetrics.inProgress > 0) items.push({ label: "Onboarding in progress", count: onboardMetrics.inProgress, tab: "Onboarded", color: "text-amber-700 bg-amber-50 border-amber-200" });
    if (addonMetrics.pendingReqs > 0) items.push({ label: "Add-on requests pending", count: addonMetrics.pendingReqs, tab: "Accommodation Customers", color: "text-amber-700 bg-amber-50 border-amber-200" });
    if (kitShipMetrics.notShipped > 0) items.push({ label: "KIT shipments pending", count: kitShipMetrics.notShipped, tab: "KIT Customer", color: "text-orange-700 bg-orange-50 border-orange-200" });
    if (metrics.noDietitian > 0) items.push({ label: "Customers without dietitian", count: metrics.noDietitian, tab: "Meal Customers", color: "text-rose-700 bg-rose-50 border-rose-200" });
    if (stayMetrics.pending > 0) items.push({ label: "Accommodation stays pending", count: stayMetrics.pending, tab: "Accommodation Customers", color: "text-sky-700 bg-sky-50 border-sky-200" });
    if (metrics.noPlan > 0) items.push({ label: "Customers with no active plan", count: metrics.noPlan, tab: "Meal Customers", color: "text-slate-700 bg-slate-50 border-slate-200" });
    if (metrics.endingSoon.length > 0) items.push({ label: "Subscriptions ending soon", count: metrics.endingSoon.length, tab: "Meal Customers", color: "text-red-700 bg-red-50 border-red-200" });
    return items;
  }, [onboardMetrics, addonMetrics, kitShipMetrics, metrics, stayMetrics]);

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* ─── Executive KPI Cards ────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total Active Customers"
          value={metrics.totalActive}
          helper="Active accounts across all types"
          icon={Users}
          accent="bg-slate-50 text-slate-700 border-slate-200"
        />
        <KpiCard
          title="Meal Customers"
          value={metrics.mealCount}
          helper={`${getPercent(metrics.mealCount, metrics.totalActive)}% of total`}
          icon={Salad}
          accent="bg-emerald-50 text-emerald-700 border-emerald-200"
          onClick={() => onNavigate("Meal Customers")}
        />
        <KpiCard
          title="KIT Customers"
          value={metrics.kitCount}
          helper={`${getPercent(metrics.kitCount, metrics.totalActive)}% of total`}
          icon={Package}
          accent="bg-orange-50 text-orange-700 border-orange-200"
          onClick={() => onNavigate("KIT Customer")}
        />
        <KpiCard
          title="Accommodation"
          value={metrics.accomCount}
          helper={`${getPercent(metrics.accomCount, metrics.totalActive)}% of total`}
          icon={Home}
          accent="bg-sky-50 text-sky-700 border-sky-200"
          onClick={() => onNavigate("Accommodation Customers")}
        />
      </div>

      {/* ─── Secondary KPIs: Subscriptions + Onboarding ─────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Active Subscriptions"
          value={metrics.activeSubsCount}
          helper="Running subscriptions"
          icon={Activity}
          accent="bg-emerald-50 text-emerald-700 border-emerald-200"
        />
        <KpiCard
          title="Pending Subscriptions"
          value={metrics.pendingSubsCount}
          helper="Scheduled (pending)"
          icon={CalendarClock}
          accent="bg-amber-50 text-amber-700 border-amber-200"
        />
        <KpiCard
          title="Expired / Stopped"
          value={metrics.stoppedSubsCount}
          helper="Inactive lifecycle records"
          icon={CirclePause}
          accent="bg-red-50 text-red-700 border-red-200"
        />
        <KpiCard
          title="Onboarding"
          value={onboardMetrics.inProgress}
          helper={`${onboardMetrics.completed} completed`}
          icon={UserPlus}
          accent="bg-violet-50 text-violet-700 border-violet-200"
          onClick={() => onNavigate("Onboarded")}
        />
      </div>

      {/* ─── Front Desk Action Center ───────────────────────────────────────── */}
      <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
        <CardHeader className="border-b border-slate-200 bg-slate-50/50 p-6 pb-4">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Front Desk Action Center
          </CardTitle>
          <CardDescription className="text-sm text-slate-500">
            Items requiring immediate attention across all customer modules.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading action items...</span>
            </div>
          ) : actionItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center">
              <UserCheck className="mx-auto h-8 w-8 text-emerald-400" />
              <p className="mt-2 text-sm font-medium text-slate-700">All clear!</p>
              <p className="text-xs text-slate-500">No items requiring immediate attention.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {actionItems.map((item) => (
                <button
                  key={item.label}
                  onClick={() => onNavigate(item.tab)}
                  className={`flex items-center justify-between rounded-xl border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${item.color}`}
                >
                  <span className="text-sm font-medium">{item.label}</span>
                  <Badge variant="outline" className={`ml-2 shrink-0 rounded-full px-2.5 text-xs font-bold ${item.color}`}>
                    {item.count}
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Customer Distribution + Status ─────────────────────────────────── */}
      <div className="grid gap-6 xl:grid-cols-2">
        {/* Customer Distribution */}
        <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
          <CardHeader className="border-b border-slate-200 bg-slate-50/50 p-6 pb-4">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
              <Users className="h-5 w-5 text-emerald-600" />
              Customer Distribution
            </CardTitle>
            <CardDescription className="text-sm text-slate-500">
              Active customers by type.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 p-6">
            <DistributionRow label="Meal" value={metrics.mealCount} total={metrics.totalActive} barClassName="bg-emerald-500" />
            <DistributionRow label="KIT" value={metrics.kitCount} total={metrics.totalActive} barClassName="bg-orange-500" />
            <DistributionRow label="Accommodation" value={metrics.accomCount} total={metrics.totalActive} barClassName="bg-sky-500" />
          </CardContent>
        </Card>

        {/* Status Overview */}
        <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
          <CardHeader className="border-b border-slate-200 bg-slate-50/50 p-6 pb-4">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
              <Activity className="h-5 w-5 text-emerald-600" />
              Status Overview
            </CardTitle>
            <CardDescription className="text-sm text-slate-500">
              Lifecycle status across all customer types. Accommodation reflects stay status.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 p-6">
            <DistributionRow label="Active Plan" value={metrics.withActivePlan} total={metrics.totalActive} barClassName="bg-emerald-500" />
            <DistributionRow label="Pending" value={metrics.pendingStatus} total={metrics.totalActive} barClassName="bg-amber-500" />
            <DistributionRow label="Expired / Stopped" value={metrics.expiredStatus} total={metrics.totalActive} barClassName="bg-red-500" />
            <DistributionRow label="No Plan" value={metrics.noPlan} total={metrics.totalActive} barClassName="bg-slate-400" />
          </CardContent>
        </Card>
      </div>

      {/* ─── KIT Shipping + Accommodation Stay ──────────────────────────────── */}
      <div className="grid gap-6 xl:grid-cols-2">
        {/* KIT Shipping Snapshot */}
        <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
          <CardHeader className="border-b border-slate-200 bg-slate-50/50 p-6 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
                  <Truck className="h-5 w-5 text-emerald-600" />
                  KIT Shipment Status
                </CardTitle>
                <CardDescription className="text-sm text-slate-500">
                  Shipping progress for KIT customers.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" className="transition-all duration-200" onClick={() => onNavigate("KIT Customer")}>
                View All
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            {loading ? (
              <LoadingPlaceholder />
            ) : kitCustomers.length === 0 ? (
              <EmptyState label="No KIT customers found." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <MiniStat label="Not Shipped" value={kitShipMetrics.notShipped} className="bg-amber-50 text-amber-700 border-amber-200" />
                <MiniStat label="Shipped" value={kitShipMetrics.shipped} className="bg-blue-50 text-blue-700 border-blue-200" />
                <MiniStat label="Delivered" value={kitShipMetrics.delivered} className="bg-emerald-50 text-emerald-700 border-emerald-200" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Accommodation Stay */}
        <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
          <CardHeader className="border-b border-slate-200 bg-slate-50/50 p-6 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
                  <Home className="h-5 w-5 text-emerald-600" />
                  Accommodation Stays
                </CardTitle>
                <CardDescription className="text-sm text-slate-500">
                  Stay status overview for accommodation customers.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" className="transition-all duration-200" onClick={() => onNavigate("Accommodation Customers")}>
                View All
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            {loading ? (
              <LoadingPlaceholder />
            ) : accommodationCustomers.length === 0 ? (
              <EmptyState label="No accommodation customers found." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MiniStat label="Active" value={stayMetrics.active} className="bg-emerald-50 text-emerald-700 border-emerald-200" />
                <MiniStat label="Pending" value={stayMetrics.pending} className="bg-amber-50 text-amber-700 border-amber-200" />
                <MiniStat label="Finished" value={stayMetrics.finished} className="bg-slate-50 text-slate-700 border-slate-200" />
                <MiniStat label="No Stay" value={stayMetrics.noStay} className="bg-red-50 text-red-700 border-red-200" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Add-on Service Requests + Subscription Snapshot ────────────────── */}
      <div className="grid gap-6 xl:grid-cols-2">
        {/* Add-on Requests */}
        <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
          <CardHeader className="border-b border-slate-200 bg-slate-50/50 p-6 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
                  <Sparkles className="h-5 w-5 text-emerald-600" />
                  Add-on Service Requests
                </CardTitle>
                <CardDescription className="text-sm text-slate-500">
                  Wellness services requested by accommodation customers.
                </CardDescription>
              </div>
              {addonMetrics.pendingReqs > 0 && (
                <Badge className="rounded-full border-0 bg-amber-100 px-2.5 text-[11px] font-semibold text-amber-700">
                  {addonMetrics.pendingReqs} pending
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-6">
            {loading ? (
              <LoadingPlaceholder />
            ) : addonMetrics.total === 0 ? (
              <EmptyState label="No add-on service requests yet." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <MiniStat label="Pending" value={addonMetrics.pendingReqs} className="bg-amber-50 text-amber-700 border-amber-200" />
                <MiniStat label="Confirmed" value={addonMetrics.confirmedReqs} className="bg-blue-50 text-blue-700 border-blue-200" />
                <MiniStat label="Completed" value={addonMetrics.completedReqs} className="bg-emerald-50 text-emerald-700 border-emerald-200" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Subscription Snapshot */}
        <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
          <CardHeader className="border-b border-slate-200 bg-slate-50/50 p-6 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
                  <ClipboardList className="h-5 w-5 text-emerald-600" />
                  Subscription Snapshot
                </CardTitle>
                <CardDescription className="text-sm text-slate-500">
                  Pause credit utilization and upcoming endings.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" className="transition-all duration-200" onClick={() => router.push("/subscriptions")}>
                View All
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 p-6">
            {/* Pause credits */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold tracking-tight text-slate-900">Pause Credit Utilization</p>
                  <p className="text-xs text-slate-500">Across active subscriptions</p>
                </div>
                <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">
                  {metrics.pauseCreditsUsed} / {metrics.pauseCreditsTotal}
                </Badge>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-emerald-500 transition-all duration-200" style={{ width: `${metrics.pausePercent}%` }} />
              </div>
            </div>

            {/* Ending soon */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold tracking-tight text-slate-900">Ending Soon</h3>
              {metrics.endingSoon.length === 0 ? (
                <EmptyState label="No subscriptions ending soon." />
              ) : (
                <div className="space-y-2">
                  {metrics.endingSoon.map((sub) => (
                    <div key={sub.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 transition-colors duration-200 hover:bg-slate-50">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{sub.customer_name}</p>
                        <p className="truncate text-xs text-slate-500">{sub.plan_name}</p>
                      </div>
                      <Badge variant="outline" className="shrink-0 bg-red-50 text-red-700 border-red-200 text-[11px]">
                        {formatDate(sub.ends_on)}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Customer Health + Onboarding Activity ──────────────────────────── */}
      <div className="grid gap-6 xl:grid-cols-2">
        {/* Customer Health */}
        <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
          <CardHeader className="border-b border-slate-200 bg-slate-50/50 p-6 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
                  <HeartPulse className="h-5 w-5 text-emerald-600" />
                  Customer Health
                </CardTitle>
                <CardDescription className="text-sm text-slate-500">
                  Medical flags, dietary mix, and health profiles.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" className="transition-all duration-200" onClick={() => onNavigate("Meal Customers")}>
                View Directory
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 p-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <InsightPill label="Medical History" value={metrics.medicalHistory} icon={ShieldCheck} className="bg-blue-50 text-blue-700 border-blue-100" />
              <InsightPill label="Allergy Notes" value={metrics.withAllergies} icon={AlertTriangle} className="bg-red-50 text-red-700 border-red-100" />
              <InsightPill label="No Dietitian" value={metrics.noDietitian} icon={UserRoundX} className="bg-amber-50 text-amber-700 border-amber-100" />
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold tracking-tight text-slate-900">Dietary Distribution</h3>
              {metrics.dietDistribution.length === 0 ? (
                <EmptyState label="No dietary data available." />
              ) : (
                metrics.dietDistribution.slice(0, 4).map(([label, value]) => (
                  <DistributionRow key={label} label={label} value={value} total={metrics.totalActive} barClassName="bg-primary" />
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Onboarding Activity */}
        <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
          <CardHeader className="border-b border-slate-200 bg-slate-50/50 p-6 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
                  <UserPlus className="h-5 w-5 text-emerald-600" />
                  Onboarding Activity
                </CardTitle>
                <CardDescription className="text-sm text-slate-500">
                  Recent onboarding progress and completion.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" className="transition-all duration-200" onClick={() => onNavigate("Onboarded")}>
                View All
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            {loading ? (
              <LoadingPlaceholder />
            ) : (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <MiniStat label="In Progress" value={onboardMetrics.inProgress} className="bg-amber-50 text-amber-700 border-amber-200" />
                  <MiniStat label="Completed" value={onboardMetrics.completed} className="bg-emerald-50 text-emerald-700 border-emerald-200" />
                  <MiniStat label="Total" value={onboardMetrics.total} className="bg-slate-50 text-slate-700 border-slate-200" />
                </div>

                {/* Recent onboarding */}
                {onboardMetrics.recentOnboarded.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold tracking-tight text-slate-900">Recent Onboarding</h3>
                    <div className="space-y-2">
                      {onboardMetrics.recentOnboarded.map((c) => (
                        <div key={c.profileId} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 transition-colors duration-200 hover:bg-slate-50">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">{c.fullName || "Unnamed"}</p>
                            <p className="truncate text-xs text-slate-500">
                              {c.customerCategory || "—"} • {c.mobile || "No mobile"}
                            </p>
                          </div>
                          <Badge variant="outline" className="shrink-0 bg-slate-50 text-slate-600 border-slate-200 text-[11px]">
                            {formatDate(c.createdAt)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Quick Insights ─────────────────────────────────────────────────── */}
      {!loading && (
        <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
          <CardHeader className="border-b border-slate-200 bg-slate-50/50 p-6 pb-4">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
              <Sparkles className="h-5 w-5 text-emerald-600" />
              Quick Insights
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {onboardMetrics.inProgress > 0 && (
                <InsightChip text={`${onboardMetrics.inProgress} onboarding customer${onboardMetrics.inProgress > 1 ? "s" : ""} waiting.`} />
              )}
              {addonMetrics.pendingReqs > 0 && (
                <InsightChip text={`${addonMetrics.pendingReqs} add-on request${addonMetrics.pendingReqs > 1 ? "s" : ""} pending.`} />
              )}
              {kitShipMetrics.notShipped > 0 && (
                <InsightChip text={`${kitShipMetrics.notShipped} KIT shipment${kitShipMetrics.notShipped > 1 ? "s" : ""} remaining.`} />
              )}
              {metrics.noDietitian > 0 && (
                <InsightChip text={`${metrics.noDietitian} customer${metrics.noDietitian > 1 ? "s" : ""} without assigned dietitian.`} />
              )}
              {metrics.endingSoon.length > 0 && (
                <InsightChip text={`${metrics.endingSoon.length} subscription${metrics.endingSoon.length > 1 ? "s" : ""} ending soon.`} />
              )}
              {stayMetrics.pending > 0 && (
                <InsightChip text={`${stayMetrics.pending} accommodation stay${stayMetrics.pending > 1 ? "s" : ""} pending confirmation.`} />
              )}
              {metrics.noPlan > 0 && (
                <InsightChip text={`${metrics.noPlan} customer${metrics.noPlan > 1 ? "s" : ""} with no active plan.`} />
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  helper,
  icon: Icon,
  accent,
  onClick,
}: {
  title: string;
  value: number;
  helper: string;
  icon: typeof Users;
  accent: string;
  onClick?: () => void;
}) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Card className="border border-slate-200 bg-white shadow-sm rounded-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-slate-300">
      <Wrapper className="w-full text-left" onClick={onClick}>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-slate-500">{title}</p>
              <div className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
              <p className="mt-1 text-xs text-slate-500">{helper}</p>
            </div>
            <div className={`rounded-xl border p-2.5 ${accent}`}>
              <Icon className="h-4 w-4" />
            </div>
          </div>
        </CardContent>
      </Wrapper>
    </Card>
  );
}

function MiniStat({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className={`rounded-xl border p-4 text-center transition-all duration-200 ${className}`}>
      <div className="text-xl font-semibold tracking-tight">{value}</div>
      <div className="mt-0.5 text-xs font-medium">{label}</div>
    </div>
  );
}

function InsightPill({
  label,
  value,
  icon: Icon,
  className,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  className: string;
}) {
  return (
    <div className={`rounded-xl border p-4 transition-all duration-200 ${className}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function InsightChip({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
      {text}
    </div>
  );
}

function DistributionRow({
  label,
  value,
  total,
  barClassName,
}: {
  label: string;
  value: number;
  total: number;
  barClassName: string;
}) {
  const percent = getPercent(value, total);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="truncate font-medium text-slate-900">{label}</span>
        <span className="shrink-0 text-xs font-medium text-slate-500">
          {value} ({percent}%)
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all ${barClassName}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center text-sm text-slate-500">
      {label}
    </div>
  );
}

function LoadingPlaceholder() {
  return (
    <div className="flex items-center justify-center py-6 gap-2 text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">Loading...</span>
    </div>
  );
}
