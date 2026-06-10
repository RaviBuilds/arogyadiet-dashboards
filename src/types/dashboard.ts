// ═══════════════════════════════════════════════
// Master Dashboard BI Types
// ═══════════════════════════════════════════════

export type DateWindow = "today" | "wow" | "mom" | "yoy";

// ─── Phase 1: KPI Summary ─────────────────────

export interface KPISummary {
  grossRevenue: number;
  revenueGrowthPercent: number;
  revenueSparkline: number[];
  activeSubscriptions: number;
  pausedSubscriptions: number;
  netActiveRate: number;
  fleetUtilization: number;
  activeRiders: number;
  totalServiceAreas: number;
  unassignedAreas: number;
  fulfillmentAccuracy: number;
  totalDelivered: number;
  totalCancelled: number;
  totalOrders: number;
}

// ─── Phase 2: Customer Segment ─────────────────

export interface CustomerSegmentData {
  retentionCohorts: RetentionCohort[];
  mealPreferences: MealPreferenceBreakdown[];
  pauseBehavior: PauseBehaviorStats;
  subscriptionStatusBreakdown: StatusCount[];
}

export interface RetentionCohort {
  month: string;
  totalCustomers: number;
  retained: number;
  churned: number;
  retentionRate: number;
}

export interface MealPreferenceBreakdown {
  category: string;
  count: number;
  percentage: number;
}

export interface PauseBehaviorStats {
  totalPauseCreditsUsed: number;
  totalPauseCreditsAvailable: number;
  avgPauseUtilization: number;
  customersCurrentlyPaused: number;
}

export interface StatusCount {
  status: string;
  count: number;
}

// ─── Phase 2: Rider/Fleet Segment ──────────────

export interface RiderSegmentData {
  pincodePerformance: PincodePerformance[];
  fleetOverview: FleetOverview;
}

export interface PincodePerformance {
  pincode: string;
  areaName: string;
  assignedRider: string | null;
  deliveryVolume: number;
  capacityStatus: "optimized" | "warning" | "critical" | "unassigned";
}

export interface FleetOverview {
  totalRiders: number;
  activeRiders: number;
  onlineNow: number;
  avgDeliveriesPerRider: number;
  totalDistanceKm: number;
}

// ─── Phase 2: Operations Segment ───────────────

export interface OperationsSegmentData {
  cutoffTimeline: CutoffTimelinePoint[];
  dailyDispatchSummary: DailyDispatchPoint[];
  operationalHealth: OperationalHealth;
}

export interface CutoffTimelinePoint {
  hour: string;
  ordersPlaced: number;
  cumulativeOrders: number;
}

export interface DailyDispatchPoint {
  date: string;
  dispatched: number;
  delivered: number;
  cancelled: number;
}

export interface OperationalHealth {
  todayTotal: number;
  todayDelivered: number;
  todayInTransit: number;
  todayCancelled: number;
  todayPending: number;
  avgDeliveryTime: number | null;
}
