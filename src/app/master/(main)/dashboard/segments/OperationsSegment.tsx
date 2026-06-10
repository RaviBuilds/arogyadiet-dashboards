"use client";

import type { OperationsSegmentData } from "@/types/dashboard";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";
import { Clock, Package, AlertTriangle } from "lucide-react";

interface OperationsSegmentProps {
  data: OperationsSegmentData;
}

export default function OperationsSegment({ data }: OperationsSegmentProps) {
  const { cutoffTimeline, dailyDispatchSummary, operationalHealth } = data;

  return (
    <div className="space-y-6">
      {/* Operational Health Summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <HealthCard
          label="Today Total"
          value={operationalHealth.todayTotal.toString()}
          color="slate"
        />
        <HealthCard
          label="Delivered"
          value={operationalHealth.todayDelivered.toString()}
          color="emerald"
        />
        <HealthCard
          label="In Transit"
          value={operationalHealth.todayInTransit.toString()}
          color="slate"
        />
        <HealthCard
          label="Pending"
          value={operationalHealth.todayPending.toString()}
          color="slate"
        />
        <HealthCard
          label="Cancelled"
          value={operationalHealth.todayCancelled.toString()}
          color={operationalHealth.todayCancelled > 0 ? "red" : "slate"}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 5 PM Cutoff Timeline */}
        <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="h-4 w-4 text-red-600" />
            <h3 className="text-sm font-semibold text-slate-800">5 PM Cutoff Timeline</h3>
          </div>
          <p className="text-xs text-slate-400 mb-4">
            Order volume build-up relative to the 17:00 operational cutoff
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cutoffTimeline}>
                <defs>
                  <linearGradient id="cutoffGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#059669" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={{ stroke: "#e2e8f0" }}
                  tickLine={false}
                  interval={1}
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
                    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
                    fontSize: "12px",
                  }}
                />
                <ReferenceLine
                  x="17:00"
                  stroke="#dc2626"
                  strokeDasharray="4 4"
                  strokeWidth={2}
                  label={{
                    value: "5 PM Cutoff",
                    position: "top",
                    fill: "#dc2626",
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="cumulativeOrders"
                  name="Cumulative"
                  stroke="#059669"
                  strokeWidth={2}
                  fill="url(#cutoffGradient)"
                />
                <Bar
                  dataKey="ordersPlaced"
                  name="Hourly"
                  fill="#0f172a"
                  fillOpacity={0.15}
                  radius={[2, 2, 0, 0]}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Daily Dispatch Summary (14 days) */}
        <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-1">
            <Package className="h-4 w-4 text-slate-600" />
            <h3 className="text-sm font-semibold text-slate-800">Daily Dispatch Trend</h3>
          </div>
          <p className="text-xs text-slate-400 mb-4">
            Delivery outcomes over the past 14 days
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyDispatchSummary} barCategoryGap="15%">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={{ stroke: "#e2e8f0" }}
                  tickLine={false}
                  interval={1}
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
                    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
                    fontSize: "12px",
                  }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: "11px" }}
                />
                <Bar
                  dataKey="delivered"
                  name="Delivered"
                  fill="#059669"
                  radius={[3, 3, 0, 0]}
                  stackId="stack"
                />
                <Bar
                  dataKey="cancelled"
                  name="Cancelled"
                  fill="#dc2626"
                  radius={[3, 3, 0, 0]}
                  stackId="stack"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

function HealthCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: "emerald" | "red" | "slate";
}) {
  const colorMap = {
    emerald: "text-emerald-600",
    red: "text-red-600",
    slate: "text-slate-800",
  };

  return (
    <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-4 text-center">
      <p className="text-xs text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${colorMap[color]}`}>{value}</p>
    </div>
  );
}
