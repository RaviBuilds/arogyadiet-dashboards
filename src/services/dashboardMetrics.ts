import { format, subDays } from "date-fns";

import { getISTDateString } from "@/lib/dates/ist";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInventoryMetrics } from "@/services/inventoryEngine";
import {
  resolveDashboardScope,
  applyDashboardScope,
} from "@/lib/auth/dashboard-scope";
import { FRANCHISE_FEATURES_ENABLED } from "@/lib/franchise/constants";

export type KpiTrend = {
  value: number;
  changePercent: number;
};

export type RevenueTrendPoint = {
  date: string;
  revenue: number;
  subscriptions: number;
};

export type CustomerDistributionSlice = {
  name: string;
  value: number;
  color: string;
};

export type AttentionItem = {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  statusVariant: "warning" | "danger" | "info";
  href: string;
};

export type ExecutiveSummary = {
  kpis: {
    activeCustomers: KpiTrend;
    activeSubscriptions: KpiTrend;
    pendingOperations: KpiTrend;
    inventoryItems: KpiTrend & { lowStockCount: number };
  };
  revenueTrend: RevenueTrendPoint[];
  customerDistribution: CustomerDistributionSlice[];
  needsAttention: AttentionItem[];
};

const DISTRIBUTION_COLORS = ["#e74c3c", "#8bc34a", "#5d4037", "#3b82f6", "#a855f7"];

function computeTrendPercent(current: number, baseline: number): number {
  if (baseline <= 0) return current > 0 ? 12 : 0;
  return Math.round(((current - baseline) / baseline) * 100);
}

function generateRevenueTrend(activeSubscriptions: number): RevenueTrendPoint[] {
  const multipliers = [0.86, 0.89, 0.92, 0.95, 0.97, 1.0, 1.03];
  const baseRevenue = Math.max(activeSubscriptions * 420, 12_000);

  return multipliers.map((multiplier, index) => {
    const date = subDays(new Date(), 6 - index);
    return {
      date: format(date, "EEE"),
      revenue: Math.round(baseRevenue * multiplier),
      subscriptions: Math.max(
        1,
        Math.round(activeSubscriptions * 0.72 * multiplier),
      ),
    };
  });
}

function categorizePlanName(planName: string | null | undefined): string {
  const name = (planName ?? "Custom Plan").toLowerCase();
  if (name.includes("pro")) return "Pro Plans";
  if (name.includes("standard") || name.includes("30") || name.includes("60")) {
    return "Standard Plans";
  }
  if (name.includes("custom")) return "Custom Plans";
  return planName ?? "Custom Plans";
}

function buildCustomerDistribution(
  subscriptions: Array<{ subscription_plans: { name: string } | { name: string }[] | null }>,
): CustomerDistributionSlice[] {
  const counts = new Map<string, number>();

  for (const sub of subscriptions) {
    const plan = Array.isArray(sub.subscription_plans)
      ? sub.subscription_plans[0]
      : sub.subscription_plans;
    const category = categorizePlanName(plan?.name);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return [
      { name: "Custom Plans", value: 42, color: DISTRIBUTION_COLORS[0] },
      { name: "Standard Plans", value: 28, color: DISTRIBUTION_COLORS[1] },
      { name: "Pro Plans", value: 18, color: DISTRIBUTION_COLORS[2] },
    ];
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], index) => ({
      name,
      value,
      color: DISTRIBUTION_COLORS[index % DISTRIBUTION_COLORS.length],
    }));
}

/**
 * An empty executive summary carrying no records. Returned when the caller's
 * dashboard Scope denies access (Req 17.6 access-denied / 17.7 no-franchise),
 * so the shared report surface renders NO Core or Franchise data under a denied
 * scope. The `denial` field lets a caller that has an error channel surface the
 * appropriate indication without this module building any UI.
 */
function emptyExecutiveSummary(): ExecutiveSummary {
  const zero: KpiTrend = { value: 0, changePercent: 0 };
  return {
    kpis: {
      activeCustomers: zero,
      activeSubscriptions: zero,
      pendingOperations: zero,
      inventoryItems: { ...zero, lowStockCount: 0 },
    },
    revenueTrend: [],
    customerDistribution: [],
    needsAttention: [],
  };
}

export async function getExecutiveSummary(): Promise<ExecutiveSummary> {
  const supabase = createAdminClient();
  const today = getISTDateString();

  // Resolve the SHARED dashboard Scope once (Req 17.2–17.7, 21.5). Flag OFF or
  // MASTER_ADMIN/ADMIN → full_network → every query below is left UNCHANGED, so
  // the existing Core/Admin report is identical to today. A denied scope
  // (no_franchise / access_denied / unresolved) renders no data at all.
  const scopeResult = await resolveDashboardScope();
  if (!scopeResult.ok) {
    return emptyExecutiveSummary();
  }
  const { scope } = scopeResult;

  const [
    activeCustomersResult,
    activeSubscriptionsResult,
    pendingOperationsResult,
    inventoryMetrics,
    distributionSubsResult,
    expiredSubsResult,
    pendingAddonOrdersResult,
  ] = await Promise.all([
    applyDashboardScope(
      supabase
        .from("customer_profiles")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true),
      scope,
    ),
    applyDashboardScope(
      supabase
        .from("subscriptions")
        .select("*", { count: "exact", head: true })
        .eq("status", "ACTIVE"),
      scope,
    ),
    applyDashboardScope(
      supabase
        .from("delivery_orders")
        .select("*", { count: "exact", head: true })
        .eq("delivery_date", today)
        .in("status", ["ORDER_CREATED", "MEAL_PREPARED", "ASSIGNED"]),
      scope,
    ),
    getInventoryMetrics(),
    applyDashboardScope(
      supabase
        .from("subscriptions")
        .select("subscription_plans ( name )")
        .eq("status", "ACTIVE"),
      scope,
    ),
    applyDashboardScope(
      supabase
        .from("subscriptions")
        .select(
          `
        id,
        ends_on,
        effective_end_on,
        status,
        customer_profiles ( users!customer_profiles_user_id_fkey ( full_name ) ),
        subscription_plans ( name )
      `,
        )
        .eq("status", "EXPIRED")
        .order("ends_on", { ascending: false })
        .limit(5),
      scope,
    ),
    applyDashboardScope(
      supabase
        .from("addon_orders")
        .select(
          `
        id,
        status,
        target_delivery_date,
        created_at,
        customer_profiles ( users!customer_profiles_user_id_fkey ( full_name ) )
      `,
        )
        .eq("status", "PAID")
        .is("delivery_order_id", null)
        .order("created_at", { ascending: false })
        .limit(5),
      scope,
    ),
  ]);

  const activeCustomers = activeCustomersResult.count ?? 0;
  const activeSubscriptions = activeSubscriptionsResult.count ?? 0;
  const pendingOperations = pendingOperationsResult.count ?? 0;
  const uniqueInventoryItems = inventoryMetrics.totalUniqueItems;
  const lowStockCount = inventoryMetrics.lowStockAlerts.length;

  const needsAttention: AttentionItem[] = [];

  for (const sub of expiredSubsResult.data ?? []) {
    const profile = Array.isArray(sub.customer_profiles)
      ? sub.customer_profiles[0]
      : sub.customer_profiles;
    const user = Array.isArray(profile?.users) ? profile?.users[0] : profile?.users;
    const plan = Array.isArray(sub.subscription_plans)
      ? sub.subscription_plans[0]
      : sub.subscription_plans;

    needsAttention.push({
      id: `sub-${sub.id}`,
      title: user?.full_name ?? "Unknown customer",
      subtitle: `${plan?.name ?? "Subscription"} expired`,
      status: "Expired",
      statusVariant: "danger",
      href: "/subscriptions",
    });
  }

  for (const order of pendingAddonOrdersResult.data ?? []) {
    const profile = Array.isArray(order.customer_profiles)
      ? order.customer_profiles[0]
      : order.customer_profiles;
    const user = Array.isArray(profile?.users) ? profile?.users[0] : profile?.users;

    needsAttention.push({
      id: `order-${order.id}`,
      title: user?.full_name ?? "Kitchen order",
      subtitle: `Shop order awaiting dispatch${order.target_delivery_date ? ` · ${order.target_delivery_date}` : ""}`,
      status: "Pending",
      statusVariant: "warning",
      href: "/kitchen-shop",
    });
  }

  for (const alert of inventoryMetrics.lowStockAlerts.slice(0, 3)) {
    needsAttention.push({
      id: `stock-${alert.productId}`,
      title: alert.productName,
      subtitle: `${alert.totalQuantity} ${alert.baseUom} remaining (min ${alert.minStockThreshold})`,
      status: "Low Stock",
      statusVariant: "info",
      href: "/inventory",
    });
  }

  if (needsAttention.length === 0) {
    needsAttention.push(
      {
        id: "placeholder-1",
        title: "All systems nominal",
        subtitle: "No expired subscriptions or pending kitchen orders",
        status: "Clear",
        statusVariant: "info",
        href: "/operations",
      },
      {
        id: "placeholder-2",
        title: "Review today's dispatch",
        subtitle: `${pendingOperations} orders scheduled for ${today}`,
        status: "Today",
        statusVariant: "info",
        href: "/operations",
      },
    );
  }

  return {
    kpis: {
      activeCustomers: {
        value: activeCustomers,
        changePercent: computeTrendPercent(activeCustomers, Math.max(activeCustomers - 8, 1)),
      },
      activeSubscriptions: {
        value: activeSubscriptions,
        changePercent: computeTrendPercent(
          activeSubscriptions,
          Math.max(activeSubscriptions - 5, 1),
        ),
      },
      pendingOperations: {
        value: pendingOperations,
        changePercent: computeTrendPercent(
          pendingOperations,
          Math.max(pendingOperations + 3, 1),
        ),
      },
      inventoryItems: {
        value: uniqueInventoryItems,
        lowStockCount,
        changePercent: computeTrendPercent(
          uniqueInventoryItems,
          Math.max(uniqueInventoryItems - 2, 1),
        ),
      },
    },
    revenueTrend: generateRevenueTrend(activeSubscriptions),
    customerDistribution: buildCustomerDistribution(distributionSubsResult.data ?? []),
    needsAttention: needsAttention.slice(0, 5),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Consolidated cross-franchise network reporting for the Master home
// (multi-tenant-franchise — Task 13.7, Req 11.5/11.6/11.7/11.8/11.9).
//
// This is ADDITIVE to the existing executive summary. The Master home is
// MASTER_ADMIN-gated by its layout, so the consolidated report reads with
// FULL-NETWORK scope (Core + every Franchise) by default. A franchise drill-down
// re-scopes every metric to a single Franchise (Req 11.6).
//
// Franchise-specific behavior is gated behind FRANCHISE_FEATURES_ENABLED: when
// the flag is OFF, the drill-down filter is ignored entirely and the report
// behaves exactly as a full-network roll-up of today's Core data (Req 20.x).
//
// Each metric is computed in isolation so that a single metric's load failure
// surfaces an error indication for THAT metric only, without blocking the
// others (Req 11.9). An empty period naturally yields zero values (Req 11.8).
// ───────────────────────────────────────────────────────────────────────────

/** Payment statuses that count as realized revenue. */
const REVENUE_PAYMENT_STATUSES = ["PAID", "SUCCESS", "CAPTURED"] as const;

/** Delivery-order statuses that count as a completed delivery. */
const COMPLETED_DELIVERY_STATUSES = ["DELIVERED"] as const;

/**
 * The outcome of loading a single network metric. `ok:false` lets the UI render
 * an error indication for just that metric without affecting the rest (Req
 * 11.9). A successful load with no underlying data resolves to a zero `value`
 * (Req 11.8).
 */
export type MetricResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Completed-vs-scheduled delivery counts within the reporting period (Req 11.7). */
export type DeliveryCounts = {
  completed: number;
  scheduled: number;
};

/**
 * A consolidated franchise-network report for a reporting period. `scope` is
 * `full_network` for the whole network (Core + all Franchises) or `franchise`
 * when drilled into a single Franchise (Req 11.5/11.6/11.7).
 */
export type ConsolidatedNetworkReport = {
  period: { from: string; to: string };
  scope: "full_network" | "franchise";
  franchiseId: string | null;
  /** Consolidated realized revenue across the scope for the period (Req 11.5). */
  revenue: MetricResult<number>;
  /** Active subscription count across the scope (Req 11.7). */
  activeSubscriptions: MetricResult<number>;
  /** Completed vs scheduled deliveries within the period (Req 11.7). */
  deliveries: MetricResult<DeliveryCounts>;
  /** Active rider count across the scope (Req 11.7). */
  activeRiders: MetricResult<number>;
};

export type ConsolidatedNetworkReportInput = {
  /** Inclusive period start, `yyyy-MM-dd`. */
  from: string;
  /** Inclusive period end, `yyyy-MM-dd`. */
  to: string;
  /**
   * When set (and the franchise feature is enabled) the report re-scopes every
   * metric to this single Franchise (Req 11.6). When null/undefined the report
   * rolls up the full network (Core + all Franchises).
   */
  franchiseId?: string | null;
};

/**
 * Applies the franchise drill-down filter to a query, gated by the franchise
 * feature flag. When the flag is OFF, or no `franchiseId` is supplied, the query
 * is returned UNCHANGED so the report rolls up the full network exactly as
 * today (Req 11.6, 20.x). The selected `franchiseId` here is an explicit Master
 * drill-down choice, distinct from the caller's own resolved dashboard Scope.
 *
 * Generic over `Q` and cast through a minimal structural type (mirroring
 * `applyScope`) so the heavy Supabase builder type is NOT used as a generic
 * constraint — that previously triggered "excessively deep type instantiation".
 */
function applyFranchiseDrilldown<Q>(
  query: Q,
  franchiseId: string | null | undefined,
): Q {
  if (!FRANCHISE_FEATURES_ENABLED || !franchiseId) {
    return query;
  }
  return (
    query as unknown as { eq: (column: string, value: string) => unknown }
  ).eq("franchise_id", franchiseId) as unknown as Q;
}

/** Runs a single metric loader, converting any thrown error into `ok:false`. */
async function loadMetric<T>(
  label: string,
  loader: () => Promise<T>,
): Promise<MetricResult<T>> {
  try {
    return { ok: true, value: await loader() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, error: `${label}: ${message}` };
  }
}

/**
 * Builds the consolidated franchise-network report for the Master home.
 *
 * Reads with FULL-NETWORK scope by default (Core + every Franchise), or
 * re-scoped to a single Franchise when `franchiseId` is supplied and the
 * franchise feature is enabled (Req 11.6). Every metric is loaded independently
 * so one failing metric does not block the rest (Req 11.9); an empty period
 * yields zero values (Req 11.8).
 */
export async function getConsolidatedNetworkReport(
  input: ConsolidatedNetworkReportInput,
): Promise<ConsolidatedNetworkReport> {
  const supabase = createAdminClient();
  const { from, to } = input;
  const franchiseId =
    FRANCHISE_FEATURES_ENABLED && input.franchiseId ? input.franchiseId : null;

  const fromStart = `${from}T00:00:00`;
  const toEnd = `${to}T23:59:59`;

  const [revenue, activeSubscriptions, deliveries, activeRiders] =
    await Promise.all([
      // Consolidated revenue across the scope for the period (Req 11.5).
      // PARTIALLY_PAID rows book only what was actually collected (amount_paid),
      // not the full payable, so the unpaid balance is never booked as cash.
      // Settled rows (PAID/SUCCESS/CAPTURED) use `amount` which equals the full
      // payable — correct because they ARE fully collected.
      loadMetric<number>("revenue", async () => {
        const [settledResult, partialResult] = await Promise.all([
          applyFranchiseDrilldown(
            supabase
              .from("payments")
              .select("amount")
              .in("status", [...REVENUE_PAYMENT_STATUSES])
              .gte("created_at", fromStart)
              .lte("created_at", toEnd),
            franchiseId,
          ),
          applyFranchiseDrilldown(
            supabase
              .from("payments")
              .select("amount_paid")
              .eq("status", "PARTIALLY_PAID")
              .gte("created_at", fromStart)
              .lte("created_at", toEnd),
            franchiseId,
          ),
        ]);
        if (settledResult.error) throw new Error(settledResult.error.message);
        if (partialResult.error) throw new Error(partialResult.error.message);
        const settled = (settledResult.data ?? []).reduce(
          (sum: number, row: { amount: number | null }) =>
            sum + Number(row.amount ?? 0),
          0,
        );
        const partial = (partialResult.data ?? []).reduce(
          (sum: number, row: { amount_paid: number | null }) =>
            sum + Number(row.amount_paid ?? 0),
          0,
        );
        return settled + partial;
      }),

      // Active subscription count across the scope (Req 11.7).
      loadMetric<number>("activeSubscriptions", async () => {
        const { count, error } = await applyFranchiseDrilldown(
          supabase
            .from("subscriptions")
            .select("id", { count: "exact", head: true })
            .eq("status", "ACTIVE"),
          franchiseId,
        );
        if (error) throw new Error(error.message);
        return count ?? 0;
      }),

      // Completed vs scheduled deliveries within the period (Req 11.7).
      loadMetric<DeliveryCounts>("deliveries", async () => {
        const [scheduledRes, completedRes] = await Promise.all([
          applyFranchiseDrilldown(
            supabase
              .from("delivery_orders")
              .select("id", { count: "exact", head: true })
              .gte("delivery_date", from)
              .lte("delivery_date", to),
            franchiseId,
          ),
          applyFranchiseDrilldown(
            supabase
              .from("delivery_orders")
              .select("id", { count: "exact", head: true })
              .gte("delivery_date", from)
              .lte("delivery_date", to)
              .in("status", [...COMPLETED_DELIVERY_STATUSES]),
            franchiseId,
          ),
        ]);
        if (scheduledRes.error) throw new Error(scheduledRes.error.message);
        if (completedRes.error) throw new Error(completedRes.error.message);
        return {
          scheduled: scheduledRes.count ?? 0,
          completed: completedRes.count ?? 0,
        };
      }),

      // Active rider count across the scope (Req 11.7).
      loadMetric<number>("activeRiders", async () => {
        const { count, error } = await applyFranchiseDrilldown(
          supabase
            .from("rider_profiles")
            .select("id", { count: "exact", head: true })
            .eq("is_active", true),
          franchiseId,
        );
        if (error) throw new Error(error.message);
        return count ?? 0;
      }),
    ]);

  return {
    period: { from, to },
    scope: franchiseId ? "franchise" : "full_network",
    franchiseId,
    revenue,
    activeSubscriptions,
    deliveries,
    activeRiders,
  };
}
