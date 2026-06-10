"use client";

import type { KPISummary } from "@/types/dashboard";
import {
  TrendingUp,
  TrendingDown,
  Users,
  Truck,
  CheckCircle2,
} from "lucide-react";

interface KPIRibbonProps {
  data: KPISummary;
}

export default function KPIRibbon({ data }: KPIRibbonProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* Revenue KPI */}
      <KPICard
        title="Gross Revenue"
        value={formatCurrency(data.grossRevenue)}
        subtitle="Period total"
        trend={data.revenueGrowthPercent}
        sparkline={data.revenueSparkline}
        accentColor="emerald"
      />

      {/* Active Subscriptions KPI */}
      <KPICard
        title="Active Subscriptions"
        value={data.activeSubscriptions.toLocaleString("en-IN")}
        subtitle={`${data.pausedSubscriptions} paused · ${data.netActiveRate}% net active`}
        icon={<Users className="h-5 w-5" />}
        accentColor="emerald"
      />

      {/* Fleet Utilization KPI */}
      <KPICard
        title="Fleet Utilization"
        value={`${data.fleetUtilization}%`}
        subtitle={`${data.activeRiders} riders · ${data.unassignedAreas} unassigned areas`}
        icon={<Truck className="h-5 w-5" />}
        accentColor="slate"
      />

      {/* Fulfillment Accuracy KPI */}
      <KPICard
        title="Fulfillment Accuracy"
        value={`${data.fulfillmentAccuracy}%`}
        subtitle={`${data.totalDelivered} delivered · ${data.totalCancelled} failed`}
        icon={<CheckCircle2 className="h-5 w-5" />}
        accentColor={data.fulfillmentAccuracy >= 90 ? "emerald" : "red"}
      />
    </div>
  );
}

// ─── KPI Card Component ────────────────────────

interface KPICardProps {
  title: string;
  value: string;
  subtitle: string;
  trend?: number;
  sparkline?: number[];
  icon?: React.ReactNode;
  accentColor: "emerald" | "red" | "slate";
}

function KPICard({ title, value, subtitle, trend, sparkline, icon, accentColor }: KPICardProps) {
  const accentClasses = {
    emerald: "text-emerald-600",
    red: "text-red-600",
    slate: "text-slate-700",
  };

  return (
    <div className="relative overflow-hidden bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-5 flex flex-col justify-between min-h-[140px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {title}
        </p>
        {icon && (
          <div className={`${accentClasses[accentColor]} opacity-60`}>
            {icon}
          </div>
        )}
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-semibold ${
            trend >= 0 ? "text-emerald-600" : "text-red-600"
          }`}>
            {trend >= 0 ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            {trend > 0 ? "+" : ""}{trend}%
          </div>
        )}
      </div>

      {/* Value */}
      <p className={`text-2xl font-bold tracking-tight mt-2 ${accentClasses[accentColor]}`}>
        {value}
      </p>

      {/* Subtitle & Sparkline */}
      <div className="flex items-end justify-between mt-2">
        <p className="text-xs text-slate-500 leading-relaxed">{subtitle}</p>
        {sparkline && sparkline.length > 0 && (
          <MiniSparkline data={sparkline} color={accentColor} />
        )}
      </div>
    </div>
  );
}

// ─── Mini Sparkline SVG ────────────────────────

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1);
  const width = 60;
  const height = 24;
  const padding = 2;

  const points = data.map((val, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - (val / max) * (height - padding * 2);
    return `${x},${y}`;
  });

  const strokeColor = color === "emerald" ? "#059669" : color === "red" ? "#dc2626" : "#475569";

  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Helpers ───────────────────────────────────

function formatCurrency(amount: number): string {
  if (amount >= 100000) {
    return `₹${(amount / 100000).toFixed(1)}L`;
  }
  if (amount >= 1000) {
    return `₹${(amount / 1000).toFixed(1)}K`;
  }
  return `₹${amount.toLocaleString("en-IN")}`;
}
