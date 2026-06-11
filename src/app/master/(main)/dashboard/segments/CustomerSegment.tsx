"use client";

import type { CustomerSegmentData } from "@/types/dashboard";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Users, PauseCircle, Activity } from "lucide-react";

interface CustomerSegmentProps {
  data: CustomerSegmentData;
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "#059669",
  PAUSED: "#d97706",
  EXPIRED: "#6b7280",
  CANCELLED: "#dc2626",
  PENDING: "#2563eb",
};

const PIE_COLORS = ["#059669", "#10b981", "#34d399", "#6ee7b7", "#a7f3d0", "#d1fae5"];

export default function CustomerSegment({ data }: CustomerSegmentProps) {
  return (
    <div className="space-y-6">
      {/* Top row: Retention + Subscription Status */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Retention Cohort Chart (2/3 width) */}
        <div className="lg:col-span-2 bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-800">Retention by Cohort</h3>
            <span className="text-xs text-slate-400 ml-auto">Last 6 months</span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.retentionCohorts} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={{ stroke: "#e2e8f0" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#64748b" }}
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
                />
                <Bar dataKey="retained" name="Retained" fill="#059669" radius={[4, 4, 0, 0]} />
                <Bar dataKey="churned" name="Churned" fill="#dc2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Subscription Status Breakdown */}
        <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-4 w-4 text-slate-600" />
            <h3 className="text-sm font-semibold text-slate-800">Status Mix</h3>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.subscriptionStatusBreakdown}
                  dataKey="count"
                  nameKey="status"
                  cx="50%"
                  cy="50%"
                  outerRadius={70}
                  innerRadius={40}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {data.subscriptionStatusBreakdown.map((entry, idx) => (
                    <Cell
                      key={entry.status}
                      fill={STATUS_COLORS[entry.status] || PIE_COLORS[idx % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    borderRadius: "12px",
                    border: "1px solid #e2e8f0",
                    fontSize: "12px",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* Legend */}
          <div className="mt-2 space-y-1.5">
            {data.subscriptionStatusBreakdown.slice(0, 4).map((item) => (
              <div key={item.status} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: STATUS_COLORS[item.status] || "#6b7280" }}
                  />
                  <span className="text-slate-600">{item.status}</span>
                </div>
                <span className="font-semibold text-slate-800">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom row: Meal Preferences + Pause Behavior */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Meal Preferences */}
        <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-4">Meal Category Distribution</h3>
          <div className="space-y-3">
            {data.mealPreferences.slice(0, 6).map((pref) => (
              <div key={pref.category} className="flex items-center gap-3">
                <span className="text-xs text-slate-600 w-28 truncate">{pref.category}</span>
                <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${pref.percentage}%` }}
                  />
                </div>
                <span className="text-xs font-semibold text-slate-700 w-12 text-right">
                  {pref.percentage}%
                </span>
              </div>
            ))}
          </div>
          {data.mealPreferences.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-8">No preference data available</p>
          )}
        </div>

        {/* Pause Behavior Stats */}
        <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <PauseCircle className="h-4 w-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-slate-800">Pause Behavior Analytics</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <PauseStatCard
              label="Credits Used"
              value={data.pauseBehavior.totalPauseCreditsUsed.toLocaleString("en-IN")}
              subtext={`of ${data.pauseBehavior.totalPauseCreditsAvailable.toLocaleString("en-IN")} total`}
            />
            <PauseStatCard
              label="Utilization"
              value={`${data.pauseBehavior.avgPauseUtilization}%`}
              subtext="avg across subs"
            />
            <PauseStatCard
              label="Currently Paused"
              value={data.pauseBehavior.customersCurrentlyPaused.toString()}
              subtext="subscriptions"
              alert={data.pauseBehavior.customersCurrentlyPaused > 10}
            />
            <PauseStatCard
              label="Available Credits"
              value={(data.pauseBehavior.totalPauseCreditsAvailable - data.pauseBehavior.totalPauseCreditsUsed).toLocaleString("en-IN")}
              subtext="remaining"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function PauseStatCard({
  label,
  value,
  subtext,
  alert = false,
}: {
  label: string;
  value: string;
  subtext: string;
  alert?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${
      alert ? "border-red-200 bg-red-50/50" : "border-slate-200 bg-slate-50/50"
    }`}>
      <p className="text-xs text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold mt-1 ${alert ? "text-red-600" : "text-slate-800"}`}>
        {value}
      </p>
      <p className="text-xs text-slate-400 mt-0.5">{subtext}</p>
    </div>
  );
}
