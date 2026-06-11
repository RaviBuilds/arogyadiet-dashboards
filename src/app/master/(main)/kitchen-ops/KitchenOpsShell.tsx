"use client";

import { useState, useEffect, useTransition, useRef } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  ChefHat,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Zap,
} from "lucide-react";
import {
  getDailyMealCategoryDistribution,
  getCutoffMetrics,
  getAutomationHealthLog,
} from "@/actions/master-actions/biKitchenOpsActions";
import type {
  DailyMealCategoryStack,
  CutoffMetrics,
  AutomationLogEntry,
} from "@/types/bi-dashboard";
import {
  BiDateFilter,
  BiDownloadButton,
  getDefaultBiDateRange,
  type BiDateRange,
} from "@/shared/components/bi";

const CATEGORY_COLORS = [
  "#059669", "#dc2626", "#f59e0b", "#6366f1", "#8b5cf6",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#14b8a6",
];

export default function KitchenOpsShell() {
  const [mealDistribution, setMealDistribution] = useState<DailyMealCategoryStack[]>([]);
  const [cutoffMetrics, setCutoffMetrics] = useState<CutoffMetrics | null>(null);
  const [automationLogs, setAutomationLogs] = useState<AutomationLogEntry[]>([]);
  const [isPending, startTransition] = useTransition();
  const [dateRange, setDateRange] = useState<BiDateRange>(getDefaultBiDateRange());
  const mealChartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startTransition(async () => {
      const [mealData, cutoffData, logData] = await Promise.all([
        getDailyMealCategoryDistribution(dateRange.from, dateRange.to),
        getCutoffMetrics(dateRange.from, dateRange.to),
        getAutomationHealthLog(dateRange.from, dateRange.to),
      ]);
      setMealDistribution(mealData);
      setCutoffMetrics(cutoffData);
      setAutomationLogs(logData);
    });
  }, [dateRange]);

  // Extract unique categories from meal distribution data
  const categories = mealDistribution.length > 0
    ? Object.keys(mealDistribution[0]).filter((k) => k !== "date")
    : [];

  if (!cutoffMetrics) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-slate-100 border border-slate-200" />
          ))}
        </div>
        <div className="h-80 rounded-2xl bg-slate-100 border border-slate-200" />
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

      {/* Cutoff KPIs */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <CutoffKPICard
          icon={<ChefHat className="h-4 w-4 text-red-600" />}
          label="Total Orders"
          value={cutoffMetrics.totalToday.toString()}
        />
        <CutoffKPICard
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
          label="Locked Before 5 PM"
          value={cutoffMetrics.lockedBeforeCutoff.toString()}
        />
        <CutoffKPICard
          icon={<Clock className="h-4 w-4 text-amber-600" />}
          label="Scheduled After 5 PM"
          value={cutoffMetrics.scheduledAfterCutoff.toString()}
        />
        <CutoffKPICard
          icon={<Zap className="h-4 w-4 text-emerald-600" />}
          label="Cutoff Compliance"
          value={`${cutoffMetrics.cutoffCompliancePercent}%`}
          alert={cutoffMetrics.cutoffCompliancePercent < 80}
        />
      </div>

      {/* Stacked Bar: Daily Meal Category Distribution */}
      <div ref={mealChartRef} className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <ChefHat className="h-4 w-4 text-red-600" />
            <h3 className="text-sm font-semibold text-slate-800">
              Daily Meal Category Distribution
            </h3>
          </div>
          <BiDownloadButton
            data={mealDistribution.map((d) => {
              const row: Record<string, string | number> = { Date: d.date as string };
              categories.forEach((cat) => { row[cat] = d[cat] as number; });
              return row;
            })}
            fileName="meal_category_distribution"
            chartRef={mealChartRef}
          />
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Predictive kitchen load breakdown — {dateRange.label}
        </p>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={mealDistribution} barCategoryGap="15%">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#64748b" }}
                axisLine={{ stroke: "#e2e8f0" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
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
                wrapperStyle={{ fontSize: "10px" }}
              />
              {categories.map((cat, idx) => (
                <Bar
                  key={cat}
                  dataKey={cat}
                  name={cat}
                  stackId="meals"
                  fill={CATEGORY_COLORS[idx % CATEGORY_COLORS.length]}
                  radius={idx === categories.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Automation Health Table */}
      <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 bg-slate-50/50 flex items-center gap-2">
          <Zap className="h-4 w-4 text-slate-600" />
          <h3 className="text-sm font-semibold text-slate-800">
            Automation Health Log
          </h3>
          <span className="text-xs text-slate-400 ml-auto mr-2">
            {automationLogs.length} entries
          </span>
          <BiDownloadButton
            data={automationLogs.map((log) => ({
              Type: log.automationType,
              Status: log.status,
              "Executed At": log.executedAt,
              Details: log.details || "",
            }))}
            fileName="automation_health_log"
          />
        </div>
        <div className="overflow-auto max-h-[360px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white border-b border-slate-200">
              <tr>
                <th className="text-left py-3 px-5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Executed At
                </th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Details
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {automationLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-400">
                    No automation logs found
                  </td>
                </tr>
              ) : (
                automationLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-3 px-5 font-mono text-xs font-semibold text-slate-800">
                      {log.automationType}
                    </td>
                    <td className="py-3 px-5">
                      <StatusBadge status={log.status} />
                    </td>
                    <td className="py-3 px-5 text-xs text-slate-600">
                      {formatTimestamp(log.executedAt)}
                    </td>
                    <td className="py-3 px-5 text-xs text-slate-500 max-w-[200px] truncate">
                      {log.details || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CutoffKPICard({
  icon,
  label,
  value,
  alert = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`backdrop-blur-sm border shadow-sm rounded-2xl p-5 ${
        alert
          ? "bg-red-50/95 border-red-200"
          : "bg-white/95 border-slate-200"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </span>
      </div>
      <p className={`text-2xl font-bold ${alert ? "text-red-600" : "text-slate-800"}`}>
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: AutomationLogEntry["status"] }) {
  const config = {
    SUCCESS: { bg: "bg-emerald-50", text: "text-emerald-700", icon: CheckCircle2 },
    FAILURE: { bg: "bg-red-50", text: "text-red-700", icon: XCircle },
    RUNNING: { bg: "bg-amber-50", text: "text-amber-700", icon: AlertTriangle },
  };

  const { bg, text, icon: Icon } = config[status] || config.RUNNING;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${bg} ${text}`}>
      <Icon className="h-3 w-3" />
      {status}
    </span>
  );
}

function formatTimestamp(ts: string): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
