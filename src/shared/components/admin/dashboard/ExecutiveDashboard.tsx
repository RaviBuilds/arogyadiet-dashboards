"use client";

import Link from "next/link";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  ClipboardList,
  Package,
  TrendingUp,
  UserPlus,
  Users,
  Warehouse,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { ExecutiveSummary } from "@/services/dashboardMetrics";

const BRAND_COLOR = "#e74c3c";

type ExecutiveDashboardProps = {
  data: ExecutiveSummary;
};

function formatINR(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function TrendBadge({ changePercent }: { changePercent: number }) {
  const isPositive = changePercent >= 0;
  const Icon = isPositive ? ArrowUpRight : ArrowDownRight;

  return (
    <p
      className={cn(
        "mt-2 flex items-center gap-1 text-sm font-medium",
        isPositive ? "text-emerald-600" : "text-rose-600",
      )}
    >
      <Icon className="size-3.5" />
      {isPositive ? "+" : ""}
      {changePercent}% from last month
    </p>
  );
}

function KpiCard({
  title,
  value,
  changePercent,
  icon: Icon,
  iconClassName,
  footnote,
}: {
  title: string;
  value: string;
  changePercent: number;
  icon: React.ComponentType<{ className?: string }>;
  iconClassName: string;
  footnote?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-xl",
            iconClassName,
          )}
        >
          <Icon className="size-5" />
        </div>
      </div>
      <p className="mt-4 text-4xl font-bold tracking-tight text-slate-900">
        {value}
      </p>
      <TrendBadge changePercent={changePercent} />
      {footnote ? (
        <p className="mt-1 text-xs text-slate-500">{footnote}</p>
      ) : null}
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number; name?: string; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-xl border border-slate-200/60 bg-white px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium text-slate-700">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="text-slate-500">
          <span
            className="mr-2 inline-block size-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          {entry.name}:{" "}
          <span className="font-semibold text-slate-900">
            {entry.name === "Revenue"
              ? formatINR(entry.value ?? 0)
              : (entry.value ?? 0).toLocaleString("en-IN")}
          </span>
        </p>
      ))}
    </div>
  );
}

const STATUS_STYLES = {
  warning: "bg-amber-50 text-amber-700 ring-amber-200/60",
  danger: "bg-rose-50 text-rose-700 ring-rose-200/60",
  info: "bg-blue-50 text-blue-700 ring-blue-200/60",
} as const;

const QUICK_ACTIONS = [
  {
    title: "Warehouse System",
    description: "Manage inventory, lots, and stock levels",
    href: "/inventory",
    icon: Warehouse,
    iconClassName: "bg-orange-50 text-orange-600",
  },
  {
    title: "Register Customer",
    description: "Onboard a new customer profile",
    href: "/customers",
    icon: UserPlus,
    iconClassName: "bg-blue-50 text-blue-600",
  },
  {
    title: "Add Subscription",
    description: "Create or queue a meal plan",
    href: "/subscriptions",
    icon: ClipboardList,
    iconClassName: "bg-emerald-50 text-emerald-600",
  },
] as const;

export default function ExecutiveDashboard({ data }: ExecutiveDashboardProps) {
  const { kpis, revenueTrend, customerDistribution, needsAttention } = data;
  const totalDistribution = customerDistribution.reduce(
    (sum, slice) => sum + slice.value,
    0,
  );

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Active Customers"
          value={kpis.activeCustomers.value.toLocaleString("en-IN")}
          changePercent={kpis.activeCustomers.changePercent}
          icon={Users}
          iconClassName="bg-blue-50 text-blue-600"
        />
        <KpiCard
          title="Active Subscriptions"
          value={kpis.activeSubscriptions.value.toLocaleString("en-IN")}
          changePercent={kpis.activeSubscriptions.changePercent}
          icon={TrendingUp}
          iconClassName="bg-emerald-50 text-emerald-600"
        />
        <KpiCard
          title="Today's Pending Ops"
          value={kpis.pendingOperations.value.toLocaleString("en-IN")}
          changePercent={kpis.pendingOperations.changePercent}
          icon={ClipboardList}
          iconClassName="bg-amber-50 text-amber-600"
        />
        <KpiCard
          title="Warehouse Value"
          value={formatINR(kpis.warehouseValue.value)}
          changePercent={kpis.warehouseValue.changePercent}
          icon={Package}
          iconClassName="bg-orange-50 text-orange-600"
          footnote={
            kpis.warehouseValue.lowStockCount > 0
              ? `${kpis.warehouseValue.lowStockCount} low-stock alert${kpis.warehouseValue.lowStockCount === 1 ? "" : "s"}`
              : undefined
          }
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="mb-6">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              Revenue & Subscription Growth
            </h2>
            <p className="text-sm text-slate-500">Last 7 days · mock trend data</p>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={revenueTrend}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={BRAND_COLOR} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={BRAND_COLOR} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                />
                <YAxis
                  yAxisId="left"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                  tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke={BRAND_COLOR}
                  strokeWidth={2.5}
                  fill="url(#revenueFill)"
                  dot={false}
                  activeDot={{ r: 4, fill: BRAND_COLOR }}
                />
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="subscriptions"
                  name="Subscriptions"
                  stroke="#8bc34a"
                  strokeWidth={2}
                  fill="transparent"
                  dot={false}
                  activeDot={{ r: 4, fill: "#8bc34a" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              Customer Distribution
            </h2>
            <p className="text-sm text-slate-500">Active plans by tier</p>
          </div>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={customerDistribution}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={78}
                  paddingAngle={3}
                  stroke="none"
                >
                  {customerDistribution.map((slice) => (
                    <Cell key={slice.name} fill={slice.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => {
                    const numericValue = typeof value === "number" ? value : 0;
                    const label = typeof name === "string" ? name : String(name ?? "");
                    return [
                      `${numericValue} (${totalDistribution > 0 ? Math.round((numericValue / totalDistribution) * 100) : 0}%)`,
                      label,
                    ];
                  }}
                  contentStyle={{
                    borderRadius: "12px",
                    border: "1px solid rgb(226 232 240 / 0.6)",
                    boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 space-y-2">
            {customerDistribution.map((slice) => (
              <div
                key={slice.name}
                className="flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-2 text-slate-600">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: slice.color }}
                  />
                  {slice.name}
                </div>
                <span className="font-medium text-slate-900">{slice.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="mb-4">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              Needs Attention
            </h2>
            <p className="text-sm text-slate-500">
              Expired subscriptions, pending kitchen orders, and stock alerts
            </p>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200/60 bg-slate-50/80 text-left text-slate-500">
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Details</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {needsAttention.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={item.href}
                        className="font-medium text-slate-900 hover:text-primary"
                      >
                        {item.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{item.subtitle}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
                          STATUS_STYLES[item.statusVariant],
                        )}
                      >
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              System Quick Actions
            </h2>
            <p className="text-sm text-slate-500">Jump to high-frequency workflows</p>
          </div>
          <div className="space-y-3">
            {QUICK_ACTIONS.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="group flex items-start gap-3 rounded-xl border border-slate-200/60 p-4 transition-all hover:border-slate-300 hover:bg-slate-50/80 hover:shadow-sm"
              >
                <div
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105",
                    action.iconClassName,
                  )}
                >
                  <action.icon className="size-5" />
                </div>
                <div>
                  <p className="font-medium text-slate-900">{action.title}</p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {action.description}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
