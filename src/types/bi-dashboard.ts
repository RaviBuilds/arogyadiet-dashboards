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

// ─── Inventory Intelligence (Master BI) ────────

export type InventoryProductType = "RAW_MATERIAL" | "FINISHED_GOOD";

export type InventoryStockStatus =
  | "HEALTHY"
  | "LOW_STOCK"
  | "OUT_OF_STOCK"
  | "EXPIRING"
  | "EXPIRED";

export interface InventoryKPISummary {
  totalWarehouseValue: number;
  rawMaterialValue: number;
  finishedGoodValue: number;
  totalUniqueItems: number;
  activeLots: number;
  totalQuantity: number;
  lowStockCount: number;
  expiringSoonCount: number;
  expiredValue: number;
  manufacturingYieldPercent: number;
}

export interface InventoryCategoryValue {
  category: string;
  value: number;
  quantity: number;
  itemCount: number;
}

export interface InventoryTypeValue {
  type: InventoryProductType;
  label: string;
  value: number;
  quantity: number;
}

export interface ExpiryRiskBucket {
  bucket: string;
  order: number;
  lots: number;
  value: number;
  quantity: number;
}

export interface InventorySourceValue {
  source: string;
  label: string;
  value: number;
  lots: number;
}

export interface TopInventoryProduct {
  productId: string;
  name: string;
  category: string;
  type: InventoryProductType;
  value: number;
  quantity: number;
  baseUom: string;
}

export interface InventoryProductRow {
  productId: string;
  name: string;
  category: string;
  type: InventoryProductType;
  baseUom: string;
  totalQuantity: number;
  totalValue: number;
  avgUnitCost: number;
  activeLots: number;
  minStockThreshold: number;
  nearestExpiry: string | null;
  status: InventoryStockStatus;
}

export interface InventoryLowStockDetail {
  productId: string;
  productName: string;
  category: string;
  totalQuantity: number;
  minStockThreshold: number;
  baseUom: string;
  shortfall: number;
}

export interface InventoryExpiringDetail {
  lotId: string;
  productName: string;
  category: string;
  batchNumber: string;
  quantityRemaining: number;
  value: number;
  expiryDate: string;
  daysToExpiry: number;
}

export interface InventoryAnalyticsSnapshot {
  kpis: InventoryKPISummary;
  categoryValues: InventoryCategoryValue[];
  typeValues: InventoryTypeValue[];
  expiryBuckets: ExpiryRiskBucket[];
  sourceValues: InventorySourceValue[];
  topProducts: TopInventoryProduct[];
  products: InventoryProductRow[];
  lowStock: InventoryLowStockDetail[];
  expiring: InventoryExpiringDetail[];
  categories: string[];
  generatedAt: string;
}

export interface InventoryMovementPoint {
  period: string;
  inboundValue: number;
  outboundValue: number;
  manufacturingValue: number;
  netValue: number;
  cumulativeNetValue: number;
}

// ─── Shop Products (Browse Shop catalog) ───────

export type ShopProductStatus = "ACTIVE" | "OUT_OF_STOCK" | "INACTIVE";

export interface ShopProductRow {
  id: string;
  sku: string | null;
  name: string;
  category: string;
  imageUrl: string | null;
  stockQuantity: number;
  originalPrice: number;
  salePrice: number | null;
  effectivePrice: number;
  discountPercent: number;
  inventoryValue: number;
  potentialRevenue: number;
  isActive: boolean;
  inStock: boolean;
  isFeatured: boolean;
  status: ShopProductStatus;
}

export interface ShopCategoryValue {
  category: string;
  productCount: number;
  inventoryValue: number;
  stockUnits: number;
}

export interface ShopStockStatusSlice {
  status: string;
  label: string;
  count: number;
}

export interface ShopProductsKPIs {
  totalProducts: number;
  activeProducts: number;
  outOfStockCount: number;
  inactiveCount: number;
  inventoryValue: number;
  inventoryValueAtMrp: number;
  onSaleCount: number;
  featuredCount: number;
  totalStockUnits: number;
}

export interface ShopProductsAnalytics {
  kpis: ShopProductsKPIs;
  products: ShopProductRow[];
  categoryValues: ShopCategoryValue[];
  stockStatus: ShopStockStatusSlice[];
  categories: string[];
  generatedAt: string;
}
