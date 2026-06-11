"use client";

import { useState, useEffect, useTransition, useRef } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  IndianRupee,
  Users,
  Truck,
  TrendingUp,
  TrendingDown,
  ChefHat,
} from "lucide-react";
import { getOverviewKPIs, getRevenueGrowthTrend } from "@/actions/master-actions/biOverviewActions";
import type { OverviewKPIs, RevenueGrowthPoint } from "@/types/bi-dashboard";
import {
  BiDateFilter,
  BiDownloadButton,
  getDefaultBiDateRange,
  type BiDateRange,
} from "@/shared/components/bi";

export default function OverviewShell() {
  const [kpis, setKpis] = useState<OverviewKPIs | null>(null);
  const [trendData, setTrendData] = useState<RevenueGrowthPoint[]>([]);
  const [isPending, startTransition] = useTransition();
  const [dateRange, setDateRange] = useState<BiDateRange>(getDefaultBiDateRange());
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startTransition(async () => {
      const [kpiResult, trendResult] = await Promise.all([
        getOverviewKPIs(dateRange.from, dateRange.to),
        getRevenueGrowthTrend(dateRange.from, dateRange.to),
      ]);
      setKpis(kpiResult);
      setTrendData(trendResult);
    });
  }, [dateRange]);

  if (!kpis) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-slate-100 border border-slate-200" />
          ))}
        </div>
        <div className="h-[400px] rounded-2xl bg-slate-100 border border-slate-200" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Date Filter - Right aligned */}
      <div className="flex items-center justify-end gap-3">
        {isPending && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <div className="h-3 w-3 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
            Loading...
          </div>
        )}
        <BiDateFilter value={dateRange} onChange={setDateRange} />
      </div>

      {/* KPI Ribbon */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        <KPICard
          icon={<IndianRupee className="h-4 w-4 text-emerald-600" />}
          label="Revenue"
          value={formatCurrency(kpis.mrr)}
          trend={kpis.mrrGrowthPercent}
          accentColor="emerald"
        />
        <KPICard
          icon={<Users className="h-4 w-4 text-emerald-600" />}
          label="Active Subs"
          value={kpis.activeSubscriptions.toLocaleString("en-IN")}
          subtitle={`${kpis.pausedSubscriptions} paused`}
          accentColor="emerald"
        />
        <KPICard
          icon={<TrendingUp className="h-4 w-4 text-red-600" />}
          label="Active/Paused Ratio"
          value={`${kpis.activeVsPausedRatio}%`}
          subtitle="Active of total"
          accentColor="red"
        />
        <KPICard
          icon={<Truck className="h-4 w-4 text-slate-700" />}
          label="Active Fleet"
          value={kpis.activeFleetSize.toString()}
          subtitle="Riders on duty"
          accentColor="slate"
        />
        <KPICard
          icon={<ChefHat className="h-4 w-4 text-red-600" />}
          label="Kitchen Load"
          value={kpis.todayKitchenLoad.toLocaleString("en-IN")}
          subtitle="Orders to fulfill"
          accentColor="red"
        />
      </div>

      {/* Main Revenue + Subscription Growth Chart */}
      <div ref={chartRef} className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-base font-semibold text-slate-800">
              Revenue & Subscription Growth
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {dateRange.label} — daily revenue and new subscription sign-ups
            </p>
          </div>
          <BiDownloadButton
            data={trendData.map((d) => ({
              Date: d.date,
              Revenue: d.revenue,
              "New Subscriptions": d.subscriptions,
            }))}
            fileName="overview_revenue_growth"
            chartRef={chartRef}
          />
        </div>
        <div className="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData}>
              <defs>
                <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#059669" stopOpacity={0.1} />
                  <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#64748b" }}
                axisLine={{ stroke: "#e2e8f0" }}
                tickLine={false}
                interval={4}
              />
              <YAxis
                yAxisId="revenue"
                tick={{ fontSize: 10, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}`}
              />
              <YAxis
                yAxisId="subs"
                orientation="right"
                tick={{ fontSize: 10, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: "12px",
                  border: "1px solid #e2e8f0",
                  boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
                  fontSize: "12px",
                }}
                formatter={(value, name) => {
                  if (name === "Revenue") return [`₹${Number(value).toLocaleString("en-IN")}`, name];
                  return [value, name];
                }}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: "11px", paddingTop: "12px" }}
              />
              <Line
                yAxisId="revenue"
                type="monotone"
                dataKey="revenue"
                name="Revenue"
                stroke="#059669"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, fill: "#059669" }}
              />
              <Line
                yAxisId="subs"
                type="monotone"
                dataKey="subscriptions"
                name="New Subscriptions"
                stroke="#dc2626"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={false}
                activeDot={{ r: 4, fill: "#dc2626" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ─── KPI Card ──────────────────────────────────

function KPICard({
  icon,
  label,
  value,
  subtitle,
  trend,
  accentColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle?: string;
  trend?: number;
  accentColor: "emerald" | "red" | "slate";
}) {
  const accentMap = {
    emerald: "text-emerald-600",
    red: "text-red-600",
    slate: "text-slate-800",
  };

  return (
    <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-5 flex flex-col justify-between min-h-[110px]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {label}
          </span>
        </div>
        {trend !== undefined && (
          <div
            className={`flex items-center gap-0.5 text-xs font-semibold ${
              trend >= 0 ? "text-emerald-600" : "text-red-600"
            }`}
          >
            {trend >= 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {trend > 0 ? "+" : ""}
            {trend}%
          </div>
        )}
      </div>
      <p className={`text-2xl font-bold mt-2 ${accentMap[accentColor]}`}>{value}</p>
      {subtitle && (
        <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
      )}
    </div>
  );
}

function formatCurrency(amount: number): string {
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${amount.toLocaleString("en-IN")}`;
}
