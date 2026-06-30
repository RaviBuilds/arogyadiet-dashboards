"use client";

import { useState, useEffect, useTransition, useRef, useMemo } from "react";
import {
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Line,
} from "recharts";
import {
  Wallet,
  Boxes,
  Layers,
  Factory,
  AlertTriangle,
  Clock,
  PackageX,
  Sprout,
  Search,
  TrendingUp,
  CircleSlash,
  Warehouse,
  Store,
} from "lucide-react";
import Link from "next/link";
import {
  getInventoryAnalyticsSnapshot,
  getInventoryMovementSeries,
  getShopProductsAnalytics,
  getShopRevenueMoMSeries,
} from "@/actions/master-actions/biInventoryActions";
import type {
  InventoryAnalyticsSnapshot,
  InventoryMovementPoint,
  InventoryProductRow,
  InventoryStockStatus,
  ShopProductsAnalytics,
} from "@/types/bi-dashboard";
import ShopProductsView from "./ShopProductsView";
import {
  BiDateFilter,
  BiDownloadButton,
  getDefaultBiDateRange,
  type BiDateRange,
} from "@/shared/components/bi";

const CATEGORY_COLORS = [
  "#dc2626",
  "#ea580c",
  "#d97706",
  "#16a34a",
  "#0891b2",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#65a30d",
  "#0d9488",
];

const TYPE_COLORS: Record<string, string> = {
  RAW_MATERIAL: "#0891b2",
  FINISHED_GOOD: "#16a34a",
};

const SOURCE_COLORS = ["#16a34a", "#2563eb", "#d97706", "#94a3b8"];

const BUCKET_COLORS: Record<string, string> = {
  Expired: "#dc2626",
  "0–7 days": "#ea580c",
  "8–14 days": "#d97706",
  "15–30 days": "#ca8a04",
  "30+ days": "#16a34a",
};

function formatCurrency(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function formatFullCurrency(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

const STATUS_STYLES: Record<
  InventoryStockStatus,
  { label: string; className: string }
> = {
  HEALTHY: { label: "Healthy", className: "bg-emerald-50 text-emerald-700" },
  LOW_STOCK: { label: "Low Stock", className: "bg-amber-50 text-amber-700" },
  OUT_OF_STOCK: { label: "Out of Stock", className: "bg-red-50 text-red-700" },
  EXPIRING: { label: "Expiring", className: "bg-orange-50 text-orange-700" },
  EXPIRED: { label: "Expired", className: "bg-rose-100 text-rose-700" },
};

const TYPE_FILTERS = [
  { key: "ALL", label: "All Types" },
  { key: "RAW_MATERIAL", label: "Raw Materials" },
  { key: "FINISHED_GOOD", label: "Finished Goods" },
] as const;

const STATUS_FILTERS = [
  { key: "ALL", label: "All Status" },
  { key: "HEALTHY", label: "Healthy" },
  { key: "LOW_STOCK", label: "Low Stock" },
  { key: "OUT_OF_STOCK", label: "Out of Stock" },
  { key: "EXPIRING", label: "Expiring" },
  { key: "EXPIRED", label: "Expired" },
] as const;

export default function InventoryIntelligenceShell() {
  const [tab, setTab] = useState<"warehouse" | "shop">("warehouse");
  const [snapshot, setSnapshot] = useState<InventoryAnalyticsSnapshot | null>(
    null,
  );
  const [movement, setMovement] = useState<InventoryMovementPoint[]>([]);
  const [shopAnalytics, setShopAnalytics] =
    useState<ShopProductsAnalytics | null>(null);
  const [shopRevenue, setShopRevenue] = useState<
    { month: string; revenue: number }[]
  >([]);
  const [dateRange, setDateRange] = useState<BiDateRange>(
    getDefaultBiDateRange(),
  );
  const [isPending, startTransition] = useTransition();
  const [isMovementPending, startMovementTransition] = useTransition();
  const [isShopRevenuePending, startShopRevenueTransition] = useTransition();

  // table filters
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const movementRef = useRef<HTMLDivElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);
  const expiryRef = useRef<HTMLDivElement>(null);
  const topProductsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startTransition(async () => {
      const data = await getInventoryAnalyticsSnapshot();
      setSnapshot(data);
    });
    startShopRevenueTransition(async () => {
      const shop = await getShopProductsAnalytics();
      setShopAnalytics(shop);
    });
  }, []);

  useEffect(() => {
    startMovementTransition(async () => {
      const data = await getInventoryMovementSeries(dateRange.from, dateRange.to);
      setMovement(data);
    });
    startShopRevenueTransition(async () => {
      const rev = await getShopRevenueMoMSeries(dateRange.from, dateRange.to);
      setShopRevenue(rev);
    });
  }, [dateRange]);

  const filteredProducts = useMemo(() => {
    if (!snapshot) return [];
    const q = search.trim().toLowerCase();
    return snapshot.products.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (category !== "ALL" && p.category !== category) return false;
      if (typeFilter !== "ALL" && p.type !== typeFilter) return false;
      if (statusFilter !== "ALL" && p.status !== statusFilter) return false;
      return true;
    });
  }, [snapshot, search, category, typeFilter, statusFilter]);

  const tabBar = (
    <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50/60 p-1 w-fit">
      <TabButton
        active={tab === "warehouse"}
        onClick={() => setTab("warehouse")}
        icon={<Warehouse className="h-3.5 w-3.5" />}
        label="Warehouse"
      />
      <TabButton
        active={tab === "shop"}
        onClick={() => setTab("shop")}
        icon={<Store className="h-3.5 w-3.5" />}
        label="Shop Products"
      />
    </div>
  );

  if (tab === "shop") {
    return (
      <div className="space-y-6">
        {tabBar}
        <ShopProductsView
          analytics={shopAnalytics}
          revenue={shopRevenue}
          dateRange={dateRange}
          setDateRange={setDateRange}
          revenuePending={isShopRevenuePending}
        />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          {tabBar}
          <Link
            href="/inventory/warehouse"
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-slate-800"
          >
            <Warehouse className="h-3.5 w-3.5" />
            Access Warehouse
          </Link>
        </div>
        <div className="space-y-6 animate-pulse">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-24 rounded-2xl bg-slate-100 border border-slate-200"
              />
            ))}
          </div>
          <div className="h-72 rounded-2xl bg-slate-100 border border-slate-200" />
        </div>
      </div>
    );
  }

  const { kpis } = snapshot;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        {tabBar}
        <Link
          href="/inventory/warehouse"
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-slate-800"
        >
          <Warehouse className="h-3.5 w-3.5" />
          Access Warehouse
        </Link>
      </div>
      {/* KPI Ribbon */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          icon={<Wallet className="h-4 w-4" />}
          tone="emerald"
          label="Total Warehouse Value"
          value={formatCurrency(kpis.totalWarehouseValue)}
          subtitle={formatFullCurrency(kpis.totalWarehouseValue)}
        />
        <KpiCard
          icon={<Sprout className="h-4 w-4" />}
          tone="cyan"
          label="Raw Material Value"
          value={formatCurrency(kpis.rawMaterialValue)}
          subtitle={`${pct(kpis.rawMaterialValue, kpis.totalWarehouseValue)} of stock`}
        />
        <KpiCard
          icon={<Layers className="h-4 w-4" />}
          tone="green"
          label="Finished Goods Value"
          value={formatCurrency(kpis.finishedGoodValue)}
          subtitle={`${pct(kpis.finishedGoodValue, kpis.totalWarehouseValue)} of stock`}
        />
        <KpiCard
          icon={<Boxes className="h-4 w-4" />}
          tone="blue"
          label="Unique SKUs"
          value={kpis.totalUniqueItems.toString()}
          subtitle={`${kpis.activeLots} active lots`}
        />
        <KpiCard
          icon={<Factory className="h-4 w-4" />}
          tone="violet"
          label="Manufacturing Yield"
          value={`${kpis.manufacturingYieldPercent}%`}
          subtitle="Finished ÷ raw consumed"
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="amber"
          label="Low Stock Alerts"
          value={kpis.lowStockCount.toString()}
          subtitle="At/below threshold"
          alert={kpis.lowStockCount > 0}
        />
        <KpiCard
          icon={<Clock className="h-4 w-4" />}
          tone="orange"
          label="Expiring Soon"
          value={kpis.expiringSoonCount.toString()}
          subtitle="Within 14 days"
          alert={kpis.expiringSoonCount > 0}
        />
        <KpiCard
          icon={<PackageX className="h-4 w-4" />}
          tone="rose"
          label="Expired Value"
          value={formatCurrency(kpis.expiredValue)}
          subtitle="Active lots past expiry"
          alert={kpis.expiredValue > 0}
        />
      </div>

      {/* Composition row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Value by category donut */}
        <ChartCard
          title="Value by Category"
          subtitle="Active stock valuation"
          icon={<Layers className="h-4 w-4 text-red-600" />}
          chartRef={categoryRef}
          exportData={snapshot.categoryValues.map((c) => ({
            Category: c.category,
            "Value (₹)": Math.round(c.value),
            Quantity: c.quantity,
            Items: c.itemCount,
          }))}
          exportName="inventory_value_by_category"
        >
          {snapshot.categoryValues.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={snapshot.categoryValues}
                  dataKey="value"
                  nameKey="category"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                >
                  {snapshot.categoryValues.map((_, i) => (
                    <Cell
                      key={i}
                      fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => [formatFullCurrency(Number(v)), "Value"]}
                  contentStyle={tooltipStyle}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  iconType="circle"
                  wrapperStyle={{ fontSize: 11 }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Raw vs Finished */}
        <ChartCard
          title="Raw vs Finished"
          subtitle="Stock value split by type"
          icon={<Sprout className="h-4 w-4 text-cyan-600" />}
          exportData={snapshot.typeValues.map((t) => ({
            Type: t.label,
            "Value (₹)": Math.round(t.value),
            Quantity: t.quantity,
          }))}
          exportName="inventory_value_by_type"
        >
          {kpis.totalWarehouseValue === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={snapshot.typeValues}
                  dataKey="value"
                  nameKey="label"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                >
                  {snapshot.typeValues.map((t) => (
                    <Cell key={t.type} fill={TYPE_COLORS[t.type]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => [formatFullCurrency(Number(v)), "Value"]}
                  contentStyle={tooltipStyle}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  iconType="circle"
                  wrapperStyle={{ fontSize: 11 }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Source breakdown */}
        <ChartCard
          title="Sourcing Mix"
          subtitle="Lot value by supply source"
          icon={<TrendingUp className="h-4 w-4 text-emerald-600" />}
          exportData={snapshot.sourceValues.map((s) => ({
            Source: s.label,
            "Value (₹)": Math.round(s.value),
            Lots: s.lots,
          }))}
          exportName="inventory_value_by_source"
        >
          {snapshot.sourceValues.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={snapshot.sourceValues}
                  dataKey="value"
                  nameKey="label"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                >
                  {snapshot.sourceValues.map((_, i) => (
                    <Cell
                      key={i}
                      fill={SOURCE_COLORS[i % SOURCE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => [formatFullCurrency(Number(v)), "Value"]}
                  contentStyle={tooltipStyle}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  iconType="circle"
                  wrapperStyle={{ fontSize: 11 }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Movement trend */}
      <div
        ref={movementRef}
        className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-red-600" />
            <h3 className="text-sm font-semibold text-slate-800">
              Inventory Value Movement
            </h3>
          </div>
          <div className="flex items-center gap-3">
            {isMovementPending && <Spinner />}
            <BiDateFilter value={dateRange} onChange={setDateRange} />
            <BiDownloadButton
              data={movement.map((m) => ({
                Period: m.period,
                "Inbound (₹)": m.inboundValue,
                "Outbound (₹)": m.outboundValue,
                "To Manufacturing (₹)": m.manufacturingValue,
                "Net (₹)": m.netValue,
                "Cumulative Net (₹)": m.cumulativeNetValue,
              }))}
              fileName="inventory_value_movement"
              chartRef={movementRef}
            />
          </div>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Inbound, outbound and manufacturing flow — {dateRange.label}
        </p>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={movement}>
              <defs>
                <linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#dc2626" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="period"
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={{ stroke: "#e2e8f0" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => formatCurrency(Number(v))}
              />
              <Tooltip
                formatter={(v, name) => [formatFullCurrency(Number(v)), String(name)]}
                contentStyle={tooltipStyle}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <Bar
                dataKey="inboundValue"
                name="Inbound"
                fill="#16a34a"
                radius={[3, 3, 0, 0]}
                barSize={14}
              />
              <Bar
                dataKey="outboundValue"
                name="Outbound"
                fill="#f59e0b"
                radius={[3, 3, 0, 0]}
                barSize={14}
              />
              <Bar
                dataKey="manufacturingValue"
                name="To Manufacturing"
                fill="#2563eb"
                radius={[3, 3, 0, 0]}
                barSize={14}
              />
              <Area
                type="monotone"
                dataKey="cumulativeNetValue"
                name="Cumulative Net"
                stroke="#dc2626"
                strokeWidth={2.5}
                fill="url(#netFill)"
              />
              <Line
                type="monotone"
                dataKey="netValue"
                name="Net Movement"
                stroke="#7c3aed"
                strokeWidth={1.5}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Expiry risk + Top products */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Expiry Risk Profile"
          subtitle="Active lot value by remaining shelf life"
          icon={<Clock className="h-4 w-4 text-amber-600" />}
          chartRef={expiryRef}
          height={300}
          exportData={snapshot.expiryBuckets.map((b) => ({
            Window: b.bucket,
            Lots: b.lots,
            "Value (₹)": Math.round(b.value),
            Quantity: b.quantity,
          }))}
          exportName="inventory_expiry_risk"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={snapshot.expiryBuckets}
              layout="vertical"
              margin={{ left: 10, right: 16 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => formatCurrency(Number(v))}
              />
              <YAxis
                type="category"
                dataKey="bucket"
                tick={{ fontSize: 11, fill: "#475569" }}
                axisLine={false}
                tickLine={false}
                width={80}
              />
              <Tooltip
                formatter={(v) => [formatFullCurrency(Number(v)), "Value"]}
                contentStyle={tooltipStyle}
                cursor={{ fill: "#f8fafc" }}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={22}>
                {snapshot.expiryBuckets.map((b) => (
                  <Cell key={b.bucket} fill={BUCKET_COLORS[b.bucket] ?? "#94a3b8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Top Products by Value"
          subtitle="Highest-value stock holdings"
          icon={<Wallet className="h-4 w-4 text-emerald-600" />}
          chartRef={topProductsRef}
          height={300}
          exportData={snapshot.topProducts.map((p) => ({
            Product: p.name,
            Category: p.category,
            Type: p.type,
            "Value (₹)": Math.round(p.value),
            Quantity: p.quantity,
            Unit: p.baseUom,
          }))}
          exportName="inventory_top_products"
        >
          {snapshot.topProducts.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={snapshot.topProducts}
                layout="vertical"
                margin={{ left: 10, right: 16 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatCurrency(Number(v))}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 10, fill: "#475569" }}
                  axisLine={false}
                  tickLine={false}
                  width={110}
                />
                <Tooltip
                  formatter={(v) => [formatFullCurrency(Number(v)), "Value"]}
                  contentStyle={tooltipStyle}
                  cursor={{ fill: "#f8fafc" }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
                  {snapshot.topProducts.map((p, i) => (
                    <Cell
                      key={p.productId}
                      fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Detailed stock table */}
      <StockTable
        products={filteredProducts}
        totalCount={snapshot.products.length}
        categories={snapshot.categories}
        search={search}
        setSearch={setSearch}
        category={category}
        setCategory={setCategory}
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
      />

      {/* Low stock + Expiring tables */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LowStockTable rows={snapshot.lowStock} />
        <ExpiringTable rows={snapshot.expiring} />
      </div>

      <p className="text-right text-[11px] text-slate-400">
        Generated{" "}
        {new Date(snapshot.generatedAt).toLocaleString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
        {isPending && " · refreshing…"}
      </p>
    </div>
  );
}

function pct(part: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

const tooltipStyle = {
  borderRadius: "12px",
  border: "1px solid #e2e8f0",
  fontSize: "12px",
} as const;

function Spinner() {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-400">
      <div className="h-3 w-3 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
      Loading
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-slate-400">
      <CircleSlash className="h-8 w-8 mb-2 text-slate-300" />
      <p className="text-xs">No data for this view</p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-all ${
        active
          ? "bg-slate-900 text-white shadow-sm"
          : "text-slate-600 hover:bg-white hover:text-slate-900"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── KPI Card ──────────────────────────────────

const TONE_STYLES: Record<string, { bg: string; icon: string }> = {
  emerald: { bg: "bg-emerald-50", icon: "text-emerald-600" },
  cyan: { bg: "bg-cyan-50", icon: "text-cyan-600" },
  green: { bg: "bg-green-50", icon: "text-green-600" },
  blue: { bg: "bg-blue-50", icon: "text-blue-600" },
  violet: { bg: "bg-violet-50", icon: "text-violet-600" },
  amber: { bg: "bg-amber-50", icon: "text-amber-600" },
  orange: { bg: "bg-orange-50", icon: "text-orange-600" },
  rose: { bg: "bg-rose-50", icon: "text-rose-600" },
};

function KpiCard({
  icon,
  label,
  value,
  subtitle,
  tone,
  alert = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle?: string;
  tone: keyof typeof TONE_STYLES;
  alert?: boolean;
}) {
  const t = TONE_STYLES[tone];
  return (
    <div
      className={`group rounded-2xl border p-4 shadow-sm transition-all hover:shadow-md ${
        alert
          ? "border-amber-200 bg-amber-50/60"
          : "border-slate-200 bg-white/95"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${t.bg} ${t.icon}`}
        >
          {icon}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 leading-tight">
          {label}
        </span>
      </div>
      <p
        className={`text-xl font-bold tracking-tight ${
          alert ? "text-amber-700" : "text-slate-800"
        }`}
      >
        {value}
      </p>
      {subtitle && (
        <p className="mt-0.5 text-[11px] text-slate-500 truncate">{subtitle}</p>
      )}
    </div>
  );
}

// ─── Chart Card wrapper ────────────────────────

function ChartCard({
  title,
  subtitle,
  icon,
  children,
  chartRef,
  exportData,
  exportName,
  height = 270,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  chartRef?: React.RefObject<HTMLDivElement | null>;
  exportData?: Record<string, string | number>[];
  exportName?: string;
  height?: number;
}) {
  return (
    <div
      ref={chartRef}
      className="flex flex-col bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-5"
    >
      <div className="flex items-start justify-between mb-1">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        </div>
        {exportData && exportName && (
          <BiDownloadButton
            data={exportData}
            fileName={exportName}
            chartRef={chartRef}
          />
        )}
      </div>
      {subtitle && <p className="text-xs text-slate-400 mb-3">{subtitle}</p>}
      <div style={{ height }}>{children}</div>
    </div>
  );
}

// ─── Detailed Stock Table ──────────────────────

function StockTable({
  products,
  totalCount,
  categories,
  search,
  setSearch,
  category,
  setCategory,
  typeFilter,
  setTypeFilter,
  statusFilter,
  setStatusFilter,
}: {
  products: InventoryProductRow[];
  totalCount: number;
  categories: string[];
  search: string;
  setSearch: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  typeFilter: string;
  setTypeFilter: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
}) {
  const exportData = products.map((p) => ({
    Product: p.name,
    Category: p.category,
    Type: p.type === "RAW_MATERIAL" ? "Raw Material" : "Finished Good",
    Stock: `${formatNumber(p.totalQuantity)} ${p.baseUom}`,
    "Active Lots": p.activeLots,
    "Min Threshold": p.minStockThreshold,
    "Avg Unit Cost (₹)": Math.round(p.avgUnitCost),
    "Stock Value (₹)": Math.round(p.totalValue),
    "Nearest Expiry": p.nearestExpiry
      ? new Date(p.nearestExpiry).toLocaleDateString("en-IN")
      : "—",
    Status: STATUS_STYLES[p.status].label,
  }));

  return (
    <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-slate-200 bg-slate-50/50">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-slate-600" />
            <h3 className="text-sm font-semibold text-slate-800">
              Stock Ledger
            </h3>
            <span className="text-xs text-slate-400">
              {products.length} of {totalCount} items
            </span>
          </div>
          <BiDownloadButton data={exportData} fileName="inventory_stock_ledger" />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search product…"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
            />
          </div>
          <Select value={category} onChange={setCategory}>
            <option value="ALL">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select value={typeFilter} onChange={setTypeFilter}>
            {TYPE_FILTERS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
          <Select value={statusFilter} onChange={setStatusFilter}>
            {STATUS_FILTERS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="overflow-auto max-h-[480px]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-white border-b border-slate-200">
            <tr>
              <Th>Product</Th>
              <Th>Category</Th>
              <Th>Type</Th>
              <Th align="right">Stock</Th>
              <Th align="right">Lots</Th>
              <Th align="right">Avg Cost</Th>
              <Th align="right">Value</Th>
              <Th align="right">Nearest Expiry</Th>
              <Th align="center">Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {products.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-slate-400">
                  <Boxes className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                  No items match the current filters
                </td>
              </tr>
            ) : (
              products.map((p) => (
                <tr key={p.productId} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3 px-4 font-medium text-slate-800">{p.name}</td>
                  <td className="py-3 px-4 text-slate-500 text-xs">{p.category}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        p.type === "RAW_MATERIAL"
                          ? "bg-cyan-50 text-cyan-700"
                          : "bg-green-50 text-green-700"
                      }`}
                    >
                      {p.type === "RAW_MATERIAL" ? "Raw" : "Finished"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right font-semibold text-slate-800">
                    {formatNumber(p.totalQuantity)}
                    <span className="text-[10px] text-slate-400 ml-1">{p.baseUom}</span>
                  </td>
                  <td className="py-3 px-4 text-right text-slate-500">{p.activeLots}</td>
                  <td className="py-3 px-4 text-right text-slate-600 text-xs">
                    {formatFullCurrency(p.avgUnitCost)}
                  </td>
                  <td className="py-3 px-4 text-right font-semibold text-slate-800">
                    {formatFullCurrency(p.totalValue)}
                  </td>
                  <td className="py-3 px-4 text-right text-xs text-slate-600">
                    {p.nearestExpiry
                      ? new Date(p.nearestExpiry).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "2-digit",
                        })
                      : "—"}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_STYLES[p.status].className}`}
                    >
                      {STATUS_STYLES[p.status].label}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  const alignClass =
    align === "right"
      ? "text-right"
      : align === "center"
        ? "text-center"
        : "text-left";
  return (
    <th
      className={`py-3 px-4 ${alignClass} text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap`}
    >
      {children}
    </th>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-200 bg-white py-2 px-3 text-xs text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 cursor-pointer"
    >
      {children}
    </select>
  );
}

// ─── Low Stock Table ───────────────────────────

function LowStockTable({
  rows,
}: {
  rows: InventoryAnalyticsSnapshot["lowStock"];
}) {
  return (
    <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-slate-200 bg-slate-50/50 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <h3 className="text-sm font-semibold text-slate-800">Low Stock</h3>
        <span className="text-xs text-slate-400 ml-auto mr-2">
          {rows.length} items
        </span>
        <BiDownloadButton
          data={rows.map((r) => ({
            Product: r.productName,
            Category: r.category,
            Stock: `${formatNumber(r.totalQuantity)} ${r.baseUom}`,
            Threshold: r.minStockThreshold,
            Shortfall: formatNumber(r.shortfall),
          }))}
          fileName="inventory_low_stock"
        />
      </div>
      <div className="overflow-auto max-h-[320px]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white border-b border-slate-200">
            <tr>
              <Th>Product</Th>
              <Th align="right">Stock</Th>
              <Th align="right">Threshold</Th>
              <Th align="right">Shortfall</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-10 text-center text-slate-400 text-xs">
                  All products above threshold
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.productId} className="hover:bg-slate-50/60">
                  <td className="py-2.5 px-4 font-medium text-slate-800">
                    {r.productName}
                    <span className="block text-[10px] text-slate-400">{r.category}</span>
                  </td>
                  <td className="py-2.5 px-4 text-right font-semibold text-amber-700">
                    {formatNumber(r.totalQuantity)} {r.baseUom}
                  </td>
                  <td className="py-2.5 px-4 text-right text-slate-500">
                    {formatNumber(r.minStockThreshold)}
                  </td>
                  <td className="py-2.5 px-4 text-right text-red-600 font-medium">
                    -{formatNumber(r.shortfall)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Expiring Table ────────────────────────────

function ExpiringTable({
  rows,
}: {
  rows: InventoryAnalyticsSnapshot["expiring"];
}) {
  return (
    <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-slate-200 bg-slate-50/50 flex items-center gap-2">
        <Clock className="h-4 w-4 text-orange-600" />
        <h3 className="text-sm font-semibold text-slate-800">Expiring Soon</h3>
        <span className="text-xs text-slate-400 ml-auto mr-2">
          {rows.length} lots
        </span>
        <BiDownloadButton
          data={rows.map((r) => ({
            Product: r.productName,
            "Batch": r.batchNumber,
            Quantity: formatNumber(r.quantityRemaining),
            "Value (₹)": Math.round(r.value),
            Expiry: new Date(r.expiryDate).toLocaleDateString("en-IN"),
            "Days Left": r.daysToExpiry,
          }))}
          fileName="inventory_expiring_lots"
        />
      </div>
      <div className="overflow-auto max-h-[320px]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white border-b border-slate-200">
            <tr>
              <Th>Product / Batch</Th>
              <Th align="right">Qty</Th>
              <Th align="right">Value</Th>
              <Th align="right">Days Left</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-10 text-center text-slate-400 text-xs">
                  Nothing expiring within 14 days
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.lotId} className="hover:bg-slate-50/60">
                  <td className="py-2.5 px-4 font-medium text-slate-800">
                    {r.productName}
                    <span className="block text-[10px] text-slate-400 font-mono">
                      #{r.batchNumber}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right text-slate-700">
                    {formatNumber(r.quantityRemaining)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-medium text-slate-700">
                    {formatFullCurrency(r.value)}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        r.daysToExpiry <= 7
                          ? "bg-red-50 text-red-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {r.daysToExpiry}d
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
