"use client";

import { useMemo, useRef, useState } from "react";
import {
  LineChart,
  Line,
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
} from "recharts";
import {
  Store,
  ShoppingBag,
  PackageCheck,
  PackageX,
  EyeOff,
  Tag,
  Search,
  Wallet,
  Sparkles,
  CircleSlash,
} from "lucide-react";
import {
  BiDateFilter,
  BiDownloadButton,
  type BiDateRange,
} from "@/shared/components/bi";
import type {
  ShopProductsAnalytics,
  ShopProductRow,
  ShopProductStatus,
} from "@/types/bi-dashboard";

const CATEGORY_COLORS = [
  "#dc2626",
  "#ea580c",
  "#d97706",
  "#16a34a",
  "#0891b2",
  "#2563eb",
  "#7c3aed",
  "#db2777",
];

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "#16a34a",
  OUT_OF_STOCK: "#f59e0b",
  INACTIVE: "#94a3b8",
};

const STATUS_STYLES: Record<
  ShopProductStatus,
  { label: string; className: string }
> = {
  ACTIVE: { label: "Active", className: "bg-emerald-50 text-emerald-700" },
  OUT_OF_STOCK: { label: "Out of Stock", className: "bg-amber-50 text-amber-700" },
  INACTIVE: { label: "Inactive", className: "bg-slate-100 text-slate-500" },
};

const STATUS_FILTERS = [
  { key: "ALL", label: "All Status" },
  { key: "ACTIVE", label: "Active" },
  { key: "OUT_OF_STOCK", label: "Out of Stock" },
  { key: "INACTIVE", label: "Inactive" },
] as const;

function formatCurrency(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function formatFullCurrency(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

const tooltipStyle = {
  borderRadius: "12px",
  border: "1px solid #e2e8f0",
  fontSize: "12px",
} as const;

interface ShopProductsViewProps {
  analytics: ShopProductsAnalytics | null;
  revenue: { month: string; revenue: number }[];
  dateRange: BiDateRange;
  setDateRange: (r: BiDateRange) => void;
  revenuePending: boolean;
}

export default function ShopProductsView({
  analytics,
  revenue,
  dateRange,
  setDateRange,
  revenuePending,
}: ShopProductsViewProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const revenueRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!analytics) return [];
    const q = search.trim().toLowerCase();
    return analytics.products.filter((p) => {
      if (
        q &&
        !p.name.toLowerCase().includes(q) &&
        !(p.sku?.toLowerCase().includes(q) ?? false)
      )
        return false;
      if (category !== "ALL" && p.category !== category) return false;
      if (statusFilter !== "ALL" && p.status !== statusFilter) return false;
      return true;
    });
  }, [analytics, search, category, statusFilter]);

  if (!analytics) {
    return (
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
    );
  }

  const { kpis } = analytics;
  const discountValue = kpis.inventoryValueAtMrp - kpis.inventoryValue;

  return (
    <div className="space-y-6">
      {/* KPI Ribbon */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          icon={<ShoppingBag className="h-4 w-4" />}
          tone="blue"
          label="Total Shop Products"
          value={kpis.totalProducts.toString()}
          subtitle={`${kpis.totalStockUnits.toLocaleString("en-IN")} units in stock`}
        />
        <Kpi
          icon={<PackageCheck className="h-4 w-4" />}
          tone="emerald"
          label="Active Listings"
          value={kpis.activeProducts.toString()}
          subtitle="Live on Browse Shop"
        />
        <Kpi
          icon={<PackageX className="h-4 w-4" />}
          tone="amber"
          label="Out of Stock"
          value={kpis.outOfStockCount.toString()}
          subtitle="Need restock"
          alert={kpis.outOfStockCount > 0}
        />
        <Kpi
          icon={<EyeOff className="h-4 w-4" />}
          tone="slate"
          label="Inactive / Hidden"
          value={kpis.inactiveCount.toString()}
          subtitle="Not visible to customers"
        />
        <Kpi
          icon={<Wallet className="h-4 w-4" />}
          tone="green"
          label="Inventory Value"
          value={formatCurrency(kpis.inventoryValue)}
          subtitle={`MRP ${formatCurrency(kpis.inventoryValueAtMrp)}`}
        />
        <Kpi
          icon={<Tag className="h-4 w-4" />}
          tone="rose"
          label="On Sale"
          value={kpis.onSaleCount.toString()}
          subtitle={`${formatCurrency(discountValue)} discount exposure`}
        />
        <Kpi
          icon={<Sparkles className="h-4 w-4" />}
          tone="violet"
          label="Featured"
          value={kpis.featuredCount.toString()}
          subtitle="Highlighted products"
        />
        <Kpi
          icon={<Store className="h-4 w-4" />}
          tone="cyan"
          label="Categories"
          value={analytics.categories.length.toString()}
          subtitle="Distinct shop categories"
        />
      </div>

      {/* Shop revenue MoM */}
      <div
        ref={revenueRef}
        className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-4 w-4 text-red-600" />
            <h3 className="text-sm font-semibold text-slate-800">
              Shop / Add-on Revenue
            </h3>
          </div>
          <div className="flex items-center gap-3">
            {revenuePending && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <div className="h-3 w-3 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
                Loading
              </div>
            )}
            <BiDateFilter value={dateRange} onChange={setDateRange} />
            <BiDownloadButton
              data={revenue.map((d) => ({ Month: d.month, "Revenue (₹)": d.revenue }))}
              fileName="shop_revenue_mom"
              chartRef={revenueRef}
            />
          </div>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Revenue from shop orders — {dateRange.label}
        </p>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={revenue}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="month"
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
                formatter={(v) => [formatFullCurrency(Number(v)), "Revenue"]}
                contentStyle={tooltipStyle}
              />
              <Line
                type="monotone"
                dataKey="revenue"
                name="Revenue"
                stroke="#dc2626"
                strokeWidth={2.5}
                dot={{ r: 4, fill: "#dc2626" }}
                activeDot={{ r: 6, fill: "#dc2626" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Status + Category */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div
          ref={statusRef}
          className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-5"
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <PackageCheck className="h-4 w-4 text-emerald-600" />
              <h3 className="text-sm font-semibold text-slate-800">
                Listing Status
              </h3>
            </div>
            <BiDownloadButton
              data={analytics.stockStatus.map((s) => ({
                Status: s.label,
                Count: s.count,
              }))}
              fileName="shop_listing_status"
              chartRef={statusRef}
            />
          </div>
          <div className="h-[260px]">
            {kpis.totalProducts === 0 ? (
              <Empty />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={analytics.stockStatus.filter((s) => s.count > 0)}
                    dataKey="count"
                    nameKey="label"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                  >
                    {analytics.stockStatus
                      .filter((s) => s.count > 0)
                      .map((s) => (
                        <Cell key={s.status} fill={STATUS_COLORS[s.status]} />
                      ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    iconType="circle"
                    wrapperStyle={{ fontSize: 11 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div
          ref={categoryRef}
          className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-5"
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-red-600" />
              <h3 className="text-sm font-semibold text-slate-800">
                Inventory Value by Category
              </h3>
            </div>
            <BiDownloadButton
              data={analytics.categoryValues.map((c) => ({
                Category: c.category,
                Products: c.productCount,
                "Stock Units": c.stockUnits,
                "Value (₹)": Math.round(c.inventoryValue),
              }))}
              fileName="shop_value_by_category"
              chartRef={categoryRef}
            />
          </div>
          <div className="h-[260px]">
            {analytics.categoryValues.length === 0 ? (
              <Empty />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={analytics.categoryValues}
                  layout="vertical"
                  margin={{ left: 10, right: 16 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#e2e8f0"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => formatCurrency(Number(v))}
                  />
                  <YAxis
                    type="category"
                    dataKey="category"
                    tick={{ fontSize: 11, fill: "#475569" }}
                    axisLine={false}
                    tickLine={false}
                    width={100}
                  />
                  <Tooltip
                    formatter={(v) => [formatFullCurrency(Number(v)), "Value"]}
                    contentStyle={tooltipStyle}
                    cursor={{ fill: "#f8fafc" }}
                  />
                  <Bar dataKey="inventoryValue" radius={[0, 4, 4, 0]} barSize={20}>
                    {analytics.categoryValues.map((_, i) => (
                      <Cell
                        key={i}
                        fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Shop products table */}
      <ShopTable
        products={filtered}
        totalCount={analytics.products.length}
        categories={analytics.categories}
        search={search}
        setSearch={setSearch}
        category={category}
        setCategory={setCategory}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
      />

      <p className="text-right text-[11px] text-slate-400">
        Generated{" "}
        {new Date(analytics.generatedAt).toLocaleString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
    </div>
  );
}

const TONE_STYLES: Record<string, { bg: string; icon: string }> = {
  emerald: { bg: "bg-emerald-50", icon: "text-emerald-600" },
  cyan: { bg: "bg-cyan-50", icon: "text-cyan-600" },
  green: { bg: "bg-green-50", icon: "text-green-600" },
  blue: { bg: "bg-blue-50", icon: "text-blue-600" },
  violet: { bg: "bg-violet-50", icon: "text-violet-600" },
  amber: { bg: "bg-amber-50", icon: "text-amber-600" },
  rose: { bg: "bg-rose-50", icon: "text-rose-600" },
  slate: { bg: "bg-slate-100", icon: "text-slate-600" },
};

function Kpi({
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
      className={`rounded-2xl border p-4 shadow-sm transition-all hover:shadow-md ${
        alert ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-white/95"
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

function Empty() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-slate-400">
      <CircleSlash className="h-8 w-8 mb-2 text-slate-300" />
      <p className="text-xs">No shop products yet</p>
    </div>
  );
}

function ShopTable({
  products,
  totalCount,
  categories,
  search,
  setSearch,
  category,
  setCategory,
  statusFilter,
  setStatusFilter,
}: {
  products: ShopProductRow[];
  totalCount: number;
  categories: string[];
  search: string;
  setSearch: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
}) {
  const exportData = products.map((p) => ({
    Product: p.name,
    SKU: p.sku ?? "",
    Category: p.category,
    Stock: p.stockQuantity,
    "MRP (₹)": p.originalPrice,
    "Sale Price (₹)": p.salePrice ?? p.originalPrice,
    "Discount %": p.discountPercent,
    "Inventory Value (₹)": Math.round(p.inventoryValue),
    Featured: p.isFeatured ? "Yes" : "No",
    Status: STATUS_STYLES[p.status].label,
  }));

  return (
    <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-slate-200 bg-slate-50/50">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Store className="h-4 w-4 text-slate-600" />
            <h3 className="text-sm font-semibold text-slate-800">
              Shop Product Catalog
            </h3>
            <span className="text-xs text-slate-400">
              {products.length} of {totalCount} products
            </span>
          </div>
          <BiDownloadButton data={exportData} fileName="shop_product_catalog" />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or SKU…"
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
              <Th>SKU</Th>
              <Th>Category</Th>
              <Th align="right">Stock</Th>
              <Th align="right">MRP</Th>
              <Th align="right">Sale</Th>
              <Th align="right">Disc.</Th>
              <Th align="right">Value</Th>
              <Th align="center">Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {products.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-slate-400">
                  <Store className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                  No products match the current filters
                </td>
              </tr>
            ) : (
              products.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3 px-4 font-medium text-slate-800">
                    <div className="flex items-center gap-1.5">
                      {p.name}
                      {p.isFeatured && (
                        <Sparkles className="h-3 w-3 text-violet-500 shrink-0" />
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-400 text-xs font-mono">
                    {p.sku ?? "—"}
                  </td>
                  <td className="py-3 px-4 text-slate-500 text-xs">{p.category}</td>
                  <td className="py-3 px-4 text-right font-semibold text-slate-800">
                    {p.stockQuantity.toLocaleString("en-IN")}
                  </td>
                  <td className="py-3 px-4 text-right text-slate-500 text-xs">
                    {formatFullCurrency(p.originalPrice)}
                  </td>
                  <td className="py-3 px-4 text-right font-medium text-slate-800">
                    {formatFullCurrency(p.effectivePrice)}
                  </td>
                  <td className="py-3 px-4 text-right text-xs">
                    {p.discountPercent > 0 ? (
                      <span className="text-emerald-600 font-medium">
                        {p.discountPercent}%
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right font-semibold text-slate-800">
                    {formatFullCurrency(p.inventoryValue)}
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
