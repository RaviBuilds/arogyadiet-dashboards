// ═══════════════════════════════════════════════
// BI Command Center Types
// ═══════════════════════════════════════════════

// ─── Overview (Command Center) ─────────────────

export interface OverviewKPIs {
  mrr: number;
  mrrGrowthPercent: number;
  activeFleetSize: number;
  activeVsPausedRatio: number;
  activeSubscriptions: number;
  pausedSubscriptions: number;
  todayKitchenLoad: number;
}

export interface RevenueGrowthPoint {
  date: string;
  revenue: number;
  subscriptions: number;
}

// ─── Growth & Subs ─────────────────────────────

export interface DietaryPieSlice {
  name: string;
  value: number;
}

export interface PlanPopularityBar {
  plan: string;
  count: number;
}

export interface PauseCreditRadial {
  allocated: number;
  consumed: number;
  utilizationPercent: number;
}

// ─── Logistics ─────────────────────────────────

export interface PincodeDensityBar {
  pincode: string;
  areaName: string;
  volume: number;
}

export interface WoWDeliveryPoint {
  week: string;
  assigned: number;
  delivered: number;
  successRate: number;
}

export interface LogisticsKPIs {
  avgPayoutPerOrder: number;
  totalRiders: number;
  activeRiders: number;
  totalDistanceKm: number;
}

export interface RiderOption {
  id: string;
  name: string;
  employeeCode: string | null;
  isActive: boolean;
}

export interface RiderDailyPerformancePoint {
  /** ISO date yyyy-MM-dd */
  date: string;
  /** Display label like "01 Jun" */
  label: string;
  assigned: number;
  delivered: number;
  failed: number;
  successRate: number;
}

export interface RiderPerformanceSummary {
  totalAssigned: number;
  totalDelivered: number;
  totalFailed: number;
  avgSuccessRate: number;
  perfectDays: number;
  activeDays: number;
}

// ─── Kitchen Ops ───────────────────────────────

export interface DailyMealCategoryStack {
  date: string;
  [category: string]: string | number;
}

export interface CutoffMetrics {
  lockedBeforeCutoff: number;
  scheduledAfterCutoff: number;
  totalToday: number;
  cutoffCompliancePercent: number;
}

export interface AutomationLogEntry {
  id: string;
  automationType: string;
  status: "SUCCESS" | "FAILURE" | "RUNNING";
  executedAt: string;
  details: string | null;
}

// ─── Commerce & Inventory ──────────────────────

export interface ShopRevenueMoMPoint {
  month: string;
  revenue: number;
}

export interface InventoryAlert {
  id: string;
  productName: string;
  lotCode: string;
  alertType: "EXPIRING" | "LOW_STOCK";
  expiryDate: string | null;
  currentStock: number;
  minThreshold: number | null;
}

export interface ManufacturingYield {
  totalRawConsumed: number;
  totalFinishedProduced: number;
  yieldPercent: number;
}

// ─── Report Engine ─────────────────────────────

export type ReportSegment = "customers" | "subscriptions" | "finance" | "inventory";
export type TimeframeFormat = "custom" | "wow" | "mom" | "yoy";

export interface ReportRequest {
  segment: ReportSegment;
  timeframe: TimeframeFormat;
  startDate?: string;
  endDate?: string;
}

export interface ReportTrendPoint {
  period: string;
  value: number;
  label?: string;
}

export interface ReportResult {
  trendData: ReportTrendPoint[];
  totalRecords: number;
  generatedAt: string;
}
