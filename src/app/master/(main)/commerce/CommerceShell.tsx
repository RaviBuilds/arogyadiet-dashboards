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
} from "recharts";
import {
  ShoppingBag,
  AlertTriangle,
  Factory,
  Package,
} from "lucide-react";
import {
  getShopRevenueMoM,
  getInventoryAlerts,
  getManufacturingYield,
} from "@/actions/master-actions/biCommerceActions";
import type {
  ShopRevenueMoMPoint,
  InventoryAlert,
  ManufacturingYield,
} from "@/types/bi-dashboard";
import {
  BiDateFilter,
  BiDownloadButton,
  getDefaultBiDateRange,
  type BiDateRange,
} from "@/shared/components/bi";

export default function CommerceShell() {
  const [revenueMoM, setRevenueMoM] = useState<ShopRevenueMoMPoint[]>([]);
  const [alerts, setAlerts] = useState<InventoryAlert[]>([]);
  const [yield_, setYield] = useState<ManufacturingYield | null>(null);
  const [isPending, startTransition] = useTransition();
  const [dateRange, setDateRange] = useState<BiDateRange>(getDefaultBiDateRange());
  const revenueChartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startTransition(async () => {
      const [revenueData, alertData, yieldData] = await Promise.all([
        getShopRevenueMoM(dateRange.from, dateRange.to),
        getInventoryAlerts(dateRange.from, dateRange.to),
        getManufacturingYield(),
      ]);
      setRevenueMoM(revenueData);
      setAlerts(alertData);
      setYield(yieldData);
    });
  }, [dateRange]);

  if (!yield_) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
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

      {/* KPI Row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <CommerceKPICard
          icon={<Factory className="h-4 w-4 text-emerald-600" />}
          label="Manufacturing Yield"
          value={`${yield_.yieldPercent}%`}
          subtitle={`${yield_.totalFinishedProduced} produced / ${yield_.totalRawConsumed} consumed`}
        />
        <CommerceKPICard
          icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
          label="Inventory Alerts"
          value={alerts.length.toString()}
          subtitle="Expiring or below threshold"
          alert={alerts.length > 5}
        />
        <CommerceKPICard
          icon={<ShoppingBag className="h-4 w-4 text-red-600" />}
          label="Shop Revenue (Latest)"
          value={formatCurrency(
            revenueMoM.length > 0 ? revenueMoM[revenueMoM.length - 1].revenue : 0
          )}
        />
      </div>

      {/* Revenue MoM Line Chart */}
      <div ref={revenueChartRef} className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-4 w-4 text-red-600" />
            <h3 className="text-sm font-semibold text-slate-800">
              Shop / Add-on Revenue MoM
            </h3>
          </div>
          <BiDownloadButton
            data={revenueMoM.map((d) => ({ Month: d.month, Revenue: d.revenue }))}
            fileName="shop_revenue_mom"
            chartRef={revenueChartRef}
          />
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Revenue trend — {dateRange.label}
        </p>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={revenueMoM}>
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
                tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}`}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: "12px",
                  border: "1px solid #e2e8f0",
                  fontSize: "12px",
                }}
                formatter={(value) => [`₹${Number(value).toLocaleString("en-IN")}`, "Revenue"]}
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

      {/* Inventory Alerts Table */}
      <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 bg-slate-50/50 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <h3 className="text-sm font-semibold text-slate-800">
            Inventory Alerts
          </h3>
          <span className="text-xs text-slate-400 ml-auto mr-2">
            {alerts.length} items need attention
          </span>
          <BiDownloadButton
            data={alerts.map((a) => ({
              Product: a.productName,
              "Lot Code": a.lotCode,
              "Alert Type": a.alertType,
              "Current Stock": a.currentStock,
              "Expiry / Threshold": a.alertType === "EXPIRING" ? (a.expiryDate || "") : `Min: ${a.minThreshold}`,
            }))}
            fileName="inventory_alerts"
          />
        </div>
        <div className="overflow-auto max-h-[360px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white border-b border-slate-200">
              <tr>
                <th className="text-left py-3 px-5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Product
                </th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Alert Type
                </th>
                <th className="text-right py-3 px-5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Current Stock
                </th>
                <th className="text-right py-3 px-5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Threshold / Expiry
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {alerts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-400">
                    <Package className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                    No inventory alerts — everything looks healthy
                  </td>
                </tr>
              ) : (
                alerts.map((alert) => (
                  <tr key={alert.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-3 px-5 font-medium text-slate-800 text-sm">
                      {alert.productName}
                      {alert.lotCode && (
                        <span className="ml-2 text-xs text-slate-400 font-mono">
                          #{alert.lotCode}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-5">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          alert.alertType === "EXPIRING"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-red-50 text-red-700"
                        }`}
                      >
                        {alert.alertType === "EXPIRING" ? "Expiring Soon" : "Low Stock"}
                      </span>
                    </td>
                    <td className="py-3 px-5 text-right font-semibold text-slate-800">
                      {alert.currentStock}
                    </td>
                    <td className="py-3 px-5 text-right text-xs text-slate-600">
                      {alert.alertType === "EXPIRING"
                        ? alert.expiryDate
                          ? new Date(alert.expiryDate).toLocaleDateString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })
                          : "—"
                        : `Min: ${alert.minThreshold}`}
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

function CommerceKPICard({
  icon,
  label,
  value,
  subtitle,
  alert = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle?: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`backdrop-blur-sm border shadow-sm rounded-2xl p-5 ${
        alert ? "bg-amber-50/95 border-amber-200" : "bg-white/95 border-slate-200"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </span>
      </div>
      <p className={`text-2xl font-bold ${alert ? "text-amber-700" : "text-slate-800"}`}>
        {value}
      </p>
      {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
    </div>
  );
}

function formatCurrency(amount: number): string {
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${amount.toLocaleString("en-IN")}`;
}
