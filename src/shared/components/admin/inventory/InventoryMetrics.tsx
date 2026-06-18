"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Clock,
  IndianRupee,
  Package,
  type LucideIcon,
} from "lucide-react";

import type {
  InventoryCatalogProduct,
  InventoryMetrics as InventoryMetricsData,
} from "@/lib/inventory/product-schema";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/shared/components/ui/card";
import InventoryInsights, {
  type InsightTab,
} from "@/shared/components/admin/inventory/InventoryInsights";

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(amount);
}

function MetricCard({
  icon: Icon,
  label,
  value,
  subtext,
  iconBg,
  iconColor,
  valueClassName,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  subtext?: string;
  iconBg: string;
  iconColor: string;
  valueClassName?: string;
  onClick?: () => void;
}) {
  const isInteractive = Boolean(onClick);

  return (
    <Card
      className={cn(
        "border shadow-sm transition-all",
        isInteractive &&
          "cursor-pointer hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      )}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        isInteractive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <div
            className={`${iconBg} flex h-11 w-11 shrink-0 items-center justify-center rounded-xl`}
          >
            <Icon className={`h-5 w-5 ${iconColor}`} />
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {label}
            </p>
            <p
              className={`text-2xl font-bold tracking-tight text-foreground ${valueClassName ?? ""}`}
            >
              {value}
            </p>
            {subtext ? (
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {subtext}
              </p>
            ) : null}
            {isInteractive ? (
              <p className="mt-1.5 text-xs font-medium text-slate-400">
                Click to view details
              </p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface InventoryMetricsProps {
  data: InventoryMetricsData;
  products: InventoryCatalogProduct[];
}

export default function InventoryMetrics({
  data,
  products,
}: InventoryMetricsProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<InsightTab>("ALL");

  const lowStockCount = data.lowStockAlerts.length;
  const expiringCount = data.expiringLots.length;

  const openTab = (tab: InsightTab) => {
    setActiveTab(tab);
    setOpen(true);
  };

  const lowStockSubtext =
    lowStockCount === 0
      ? "All products above threshold"
      : (() => {
          const topNames = data.lowStockAlerts
            .slice(0, 3)
            .map((alert) => alert.productName);
          const suffix =
            lowStockCount > 3 ? ` +${lowStockCount - 3} more` : "";
          return `${topNames.join(", ")}${suffix}`;
        })();

  const expiringSubtext =
    expiringCount === 0 ? "All clear" : "Within 14 days";

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <MetricCard
          icon={IndianRupee}
          label="Total Warehouse Value"
          value={`₹${formatINR(data.totalWarehouseValue)}`}
          iconBg="bg-emerald-50"
          iconColor="text-emerald-600"
        />
        <MetricCard
          icon={Package}
          label="Total Unique Items"
          value={String(data.totalUniqueItems)}
          iconBg="bg-blue-50"
          iconColor="text-blue-600"
          onClick={() => openTab("ALL")}
        />
        <MetricCard
          icon={AlertTriangle}
          label="Low Stock Alerts"
          value={String(lowStockCount)}
          subtext={lowStockSubtext}
          iconBg="bg-red-50"
          iconColor="text-destructive"
          valueClassName={lowStockCount > 0 ? "text-destructive" : undefined}
          onClick={() => openTab("LOW_STOCK")}
        />
        <MetricCard
          icon={Clock}
          label="Expiring Soon"
          value={String(expiringCount)}
          subtext={expiringSubtext}
          iconBg="bg-amber-50"
          iconColor="text-amber-600"
          valueClassName={expiringCount > 0 ? "text-amber-600" : undefined}
          onClick={() => openTab("EXPIRING")}
        />
      </div>

      <InventoryInsights
        products={products}
        metrics={data}
        open={open}
        onOpenChange={setOpen}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    </>
  );
}
