"use client";

import { useState, useEffect, useTransition, useRef, useMemo } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ComposedChart,
  Area,
} from "recharts";
import {
  MapPin,
  IndianRupee,
  Users,
  Route,
  UserCheck,
  CheckCircle2,
  XCircle,
  Target,
  Search,
} from "lucide-react";
import {
  getPincodeDensity,
  getWoWDeliveryTrend,
  getLogisticsKPIs,
  getRidersForLogistics,
  getRiderDailyPerformance,
} from "@/actions/master-actions/biLogisticsActions";
import type {
  PincodeDensityBar,
  WoWDeliveryPoint,
  LogisticsKPIs,
  RiderOption,
  RiderDailyPerformancePoint,
  RiderPerformanceSummary,
} from "@/types/bi-dashboard";
import {
  BiDateFilter,
  BiDownloadButton,
  getDefaultBiDateRange,
  type BiDateRange,
} from "@/shared/components/bi";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

export default function LogisticsShell() {
  const [kpis, setKpis] = useState<LogisticsKPIs | null>(null);
  const [pincodeDensity, setPincodeDensity] = useState<PincodeDensityBar[]>([]);
  const [wowTrend, setWowTrend] = useState<WoWDeliveryPoint[]>([]);
  const [isPending, startTransition] = useTransition();
  const [dateRange, setDateRange] = useState<BiDateRange>(getDefaultBiDateRange());
  const pincodeChartRef = useRef<HTMLDivElement>(null);
  const wowChartRef = useRef<HTMLDivElement>(null);
  const riderPerfChartRef = useRef<HTMLDivElement>(null);

  // Rider performance state
  const [riders, setRiders] = useState<RiderOption[]>([]);
  const [selectedRiderId, setSelectedRiderId] = useState<string>("");
  const [riderSeries, setRiderSeries] = useState<RiderDailyPerformancePoint[]>(
    []
  );
  const [riderSummary, setRiderSummary] = useState<RiderPerformanceSummary | null>(
    null
  );
  const [isRiderLoading, startRiderTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const [kpiData, pincodeData, wowData, riderList] = await Promise.all([
        getLogisticsKPIs(dateRange.from, dateRange.to),
        getPincodeDensity(dateRange.from, dateRange.to),
        getWoWDeliveryTrend(dateRange.from, dateRange.to),
        getRidersForLogistics(),
      ]);
      setKpis(kpiData);
      setPincodeDensity(pincodeData);
      setWowTrend(wowData);
      setRiders(riderList);
      // Auto-select the first active rider on initial load
      setSelectedRiderId((current) => {
        if (current && riderList.some((r) => r.id === current)) return current;
        const firstActive = riderList.find((r) => r.isActive);
        return firstActive?.id || riderList[0]?.id || "";
      });
    });
  }, [dateRange]);

  // Fetch per-rider performance whenever rider or date range changes
  useEffect(() => {
    if (!selectedRiderId) {
      setRiderSeries([]);
      setRiderSummary(null);
      return;
    }
    startRiderTransition(async () => {
      const result = await getRiderDailyPerformance(
        selectedRiderId,
        dateRange.from,
        dateRange.to
      );
      setRiderSeries(result.series);
      setRiderSummary(result.summary);
    });
  }, [selectedRiderId, dateRange]);

  const selectedRider = useMemo(
    () => riders.find((r) => r.id === selectedRiderId) || null,
    [riders, selectedRiderId]
  );

  if (!kpis) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-slate-100 border border-slate-200" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="h-80 rounded-2xl bg-slate-100 border border-slate-200" />
          <div className="h-80 rounded-2xl bg-slate-100 border border-slate-200" />
        </div>
        <div className="h-[480px] rounded-2xl bg-slate-100 border border-slate-200" />
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

      {/* KPI Row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <LogisticsKPICard
          icon={<IndianRupee className="h-4 w-4 text-emerald-600" />}
          label="Avg Payout/Order"
          value={`₹${kpis.avgPayoutPerOrder}`}
        />
        <LogisticsKPICard
          icon={<Users className="h-4 w-4 text-slate-700" />}
          label="Total Fleet"
          value={kpis.totalRiders.toString()}
          subtitle={`${kpis.activeRiders} active`}
        />
        <LogisticsKPICard
          icon={<Route className="h-4 w-4 text-red-600" />}
          label="Distance"
          value={`${kpis.totalDistanceKm.toLocaleString("en-IN")} km`}
        />
        <LogisticsKPICard
          icon={<MapPin className="h-4 w-4 text-emerald-600" />}
          label="Active Pincodes"
          value={pincodeDensity.length.toString()}
          subtitle="With recent orders"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Pincode Density Horizontal Bar */}
        <div ref={pincodeChartRef} className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-red-600" />
              <h3 className="text-sm font-semibold text-slate-800">
                Pincode Delivery Density
              </h3>
            </div>
            <BiDownloadButton
              data={pincodeDensity.map((d) => ({
                Pincode: d.pincode,
                Area: d.areaName,
                Deliveries: d.volume,
              }))}
              fileName="pincode_density"
              chartRef={pincodeChartRef}
            />
          </div>
          <p className="text-xs text-slate-400 mb-4">
            Top pincodes by delivery volume — {dateRange.label}
          </p>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={pincodeDensity.slice(0, 10)}
                layout="vertical"
                barCategoryGap="15%"
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
                />
                <YAxis
                  type="category"
                  dataKey="areaName"
                  tick={{ fontSize: 10, fill: "#334155" }}
                  axisLine={false}
                  tickLine={false}
                  width={100}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: "12px",
                    border: "1px solid #e2e8f0",
                    fontSize: "12px",
                  }}
                  formatter={(value) => [`${Number(value)} deliveries`, "Volume"]}
                />
                <Bar
                  dataKey="volume"
                  name="Deliveries"
                  fill="#dc2626"
                  radius={[0, 6, 6, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* WoW Delivery Success Rate Line Chart */}
        <div ref={wowChartRef} className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Route className="h-4 w-4 text-emerald-600" />
              <h3 className="text-sm font-semibold text-slate-800">
                WoW Delivery Success Rate
              </h3>
            </div>
            <BiDownloadButton
              data={wowTrend.map((d) => ({
                Week: d.week,
                Assigned: d.assigned,
                Delivered: d.delivered,
                "Success Rate %": d.successRate,
              }))}
              fileName="wow_delivery_trend"
              chartRef={wowChartRef}
            />
          </div>
          <p className="text-xs text-slate-400 mb-4">
            Assigned vs Delivered — {dateRange.label}
          </p>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={wowTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="week"
                  tick={{ fontSize: 9, fill: "#64748b" }}
                  axisLine={{ stroke: "#e2e8f0" }}
                  tickLine={false}
                  angle={-30}
                  textAnchor="end"
                  height={50}
                />
                <YAxis
                  yAxisId="count"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="rate"
                  orientation="right"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: "12px",
                    border: "1px solid #e2e8f0",
                    fontSize: "12px",
                  }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: "11px" }}
                />
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="assigned"
                  name="Assigned"
                  stroke="#64748b"
                  strokeWidth={1.5}
                  dot={false}
                />
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="delivered"
                  name="Delivered"
                  stroke="#059669"
                  strokeWidth={2.5}
                  dot={false}
                />
                <Line
                  yAxisId="rate"
                  type="monotone"
                  dataKey="successRate"
                  name="Success %"
                  stroke="#dc2626"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Rider Daily Performance - Full Width */}
      <div
        ref={riderPerfChartRef}
        className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6"
      >
        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-1">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-800">
              Rider Daily Performance
            </h3>
            {selectedRider && (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {selectedRider.employeeCode || "—"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isRiderLoading && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <div className="h-3 w-3 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
                <span className="hidden sm:inline">Loading...</span>
              </div>
            )}
            <RiderSelect
              riders={riders}
              value={selectedRiderId}
              onChange={setSelectedRiderId}
            />
            <BiDownloadButton
              data={riderSeries.map((d) => ({
                Date: d.date,
                Rider: selectedRider?.name || "",
                "Employee Code": selectedRider?.employeeCode || "",
                Assigned: d.assigned,
                Delivered: d.delivered,
                Failed: d.failed,
                "Success Rate %": d.successRate,
              }))}
              fileName={`rider_daily_performance_${
                selectedRider?.employeeCode || selectedRider?.name || "rider"
              }`.replace(/\s+/g, "_")}
              chartRef={riderPerfChartRef}
            />
          </div>
        </div>
        <p className="text-xs text-slate-400 mb-5">
          {selectedRider ? (
            <>
              Day-by-day assigned vs delivered for{" "}
              <span className="font-medium text-slate-600">
                {selectedRider.name}
              </span>{" "}
              — {dateRange.label}
            </>
          ) : (
            <>Select a rider to inspect daily delivery performance</>
          )}
        </p>

        {/* Summary KPI Strip */}
        {riderSummary && selectedRider && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <RiderMiniStat
              icon={<Route className="h-3.5 w-3.5 text-slate-500" />}
              label="Assigned"
              value={riderSummary.totalAssigned.toString()}
              tone="slate"
            />
            <RiderMiniStat
              icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
              label="Delivered"
              value={riderSummary.totalDelivered.toString()}
              tone="emerald"
            />
            <RiderMiniStat
              icon={<XCircle className="h-3.5 w-3.5 text-red-500" />}
              label="Failed"
              value={riderSummary.totalFailed.toString()}
              tone="red"
            />
            <RiderMiniStat
              icon={<Target className="h-3.5 w-3.5 text-amber-600" />}
              label="Success Rate"
              value={`${riderSummary.avgSuccessRate}%`}
              tone="amber"
              highlight
            />
            <RiderMiniStat
              icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />}
              label="100% Days"
              value={`${riderSummary.perfectDays} / ${riderSummary.activeDays}`}
              tone="emerald"
              subtitle="perfect / active"
            />
          </div>
        )}

        {/* Daily Performance Chart */}
        <div className="h-[360px]">
          {!selectedRiderId ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
              <UserCheck className="h-8 w-8 text-slate-300" />
              <p className="text-sm">Select a rider to view daily performance</p>
            </div>
          ) : riderSummary && riderSummary.totalAssigned === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
              <Search className="h-8 w-8 text-slate-300" />
              <p className="text-sm">
                No deliveries assigned in this period
              </p>
              <p className="text-xs text-slate-400">
                Try a different rider or expand the date range.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={riderSeries}
                margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
              >
                <defs>
                  <linearGradient id="riderDeliveredFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#059669" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#059669" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={{ stroke: "#e2e8f0" }}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={12}
                />
                <YAxis
                  yAxisId="count"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  yAxisId="rate"
                  orientation="right"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip content={<RiderTooltip />} cursor={{ stroke: "#cbd5e1", strokeWidth: 1 }} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: "11px", paddingTop: 12 }}
                />
                <Area
                  yAxisId="count"
                  type="monotone"
                  dataKey="delivered"
                  fill="url(#riderDeliveredFill)"
                  stroke="transparent"
                  legendType="none"
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="assigned"
                  name="Assigned"
                  stroke="#475569"
                  strokeWidth={1.5}
                  dot={{ r: 2, strokeWidth: 0, fill: "#475569" }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="delivered"
                  name="Delivered"
                  stroke="#059669"
                  strokeWidth={2.5}
                  dot={{ r: 2.5, strokeWidth: 0, fill: "#059669" }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  yAxisId="rate"
                  type="monotone"
                  dataKey="successRate"
                  name="Success %"
                  stroke="#d97706"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  activeDot={{ r: 5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

function LogisticsKPICard({
  icon,
  label,
  value,
  subtitle,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </span>
      </div>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
    </div>
  );
}

// ───────────────────────────────────────────────
// Rider Daily Performance — sub-components
// ───────────────────────────────────────────────

function RiderSelect({
  riders,
  value,
  onChange,
}: {
  riders: RiderOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const activeRiders = riders.filter((r) => r.isActive);
  const inactiveRiders = riders.filter((r) => !r.isActive);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        size="sm"
        className="h-8 min-w-[200px] max-w-[260px] text-xs"
      >
        <SelectValue placeholder="Select rider" />
      </SelectTrigger>
      <SelectContent className="max-h-[320px]">
        {activeRiders.length > 0 && (
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Active ({activeRiders.length})
          </div>
        )}
        {activeRiders.map((r) => (
          <SelectItem key={r.id} value={r.id} className="text-xs">
            <span className="font-medium">{r.name}</span>
            {r.employeeCode && (
              <span className="ml-2 text-slate-400">{r.employeeCode}</span>
            )}
          </SelectItem>
        ))}
        {inactiveRiders.length > 0 && (
          <div className="px-2 py-1 mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Inactive ({inactiveRiders.length})
          </div>
        )}
        {inactiveRiders.map((r) => (
          <SelectItem key={r.id} value={r.id} className="text-xs text-slate-500">
            <span>{r.name}</span>
            {r.employeeCode && (
              <span className="ml-2 text-slate-400">{r.employeeCode}</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RiderMiniStat({
  icon,
  label,
  value,
  subtitle,
  tone = "slate",
  highlight = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle?: string;
  tone?: "slate" | "emerald" | "red" | "amber";
  highlight?: boolean;
}) {
  const toneRing: Record<string, string> = {
    slate: "ring-slate-200",
    emerald: "ring-emerald-200",
    red: "ring-red-200",
    amber: "ring-amber-200",
  };
  const valueColor: Record<string, string> = {
    slate: "text-slate-800",
    emerald: "text-emerald-700",
    red: "text-red-600",
    amber: "text-amber-700",
  };
  return (
    <div
      className={`rounded-xl bg-white px-4 py-3 ring-1 ${toneRing[tone]} ${
        highlight ? "shadow-sm" : ""
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
      </div>
      <p className={`text-lg font-bold leading-tight ${valueColor[tone]}`}>
        {value}
      </p>
      {subtitle && (
        <p className="text-[10px] text-slate-400 mt-0.5">{subtitle}</p>
      )}
    </div>
  );
}

interface RiderTooltipPayloadItem {
  name?: string;
  value?: number;
  payload?: RiderDailyPerformancePoint;
}

function RiderTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: RiderTooltipPayloadItem[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  const successColor =
    point.successRate === 100
      ? "text-emerald-600"
      : point.successRate >= 80
        ? "text-amber-600"
        : "text-red-600";
  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2.5 shadow-lg backdrop-blur-sm min-w-[160px]">
      <p className="text-[11px] font-semibold text-slate-700 mb-1.5">
        {point.label}
      </p>
      <div className="space-y-1 text-[11px]">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-500">
            <span className="h-2 w-2 rounded-full bg-slate-500" /> Assigned
          </span>
          <span className="font-semibold text-slate-700">{point.assigned}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-500">
            <span className="h-2 w-2 rounded-full bg-emerald-600" /> Delivered
          </span>
          <span className="font-semibold text-emerald-700">
            {point.delivered}
          </span>
        </div>
        {point.failed > 0 && (
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="h-2 w-2 rounded-full bg-red-500" /> Failed
            </span>
            <span className="font-semibold text-red-600">{point.failed}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-1 mt-1">
          <span className="text-slate-500">Success</span>
          <span className={`font-bold ${successColor}`}>
            {point.successRate}%
          </span>
        </div>
      </div>
    </div>
  );
}
