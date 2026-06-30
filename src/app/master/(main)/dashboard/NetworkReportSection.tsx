"use client";

// src/app/master/(main)/dashboard/NetworkReportSection.tsx
// Consolidated cross-franchise reporting section for the Master home
// (multi-tenant-franchise — Task 13.7, Req 11.5–11.9).
//
// ADDITIVE: this section mounts BELOW the existing Command Center overview and
// does not alter it. It shows consolidated revenue + network operations health
// for a selectable reporting period (defaulting to the current calendar month),
// with a single-Franchise drill-down. Each metric renders independently so one
// failing metric shows an inline error without blocking the others (Req 11.9);
// an empty period naturally shows zero values (Req 11.8).

import { useEffect, useState, useTransition } from "react";
import {
  IndianRupee,
  Users,
  Truck,
  PackageCheck,
  AlertTriangle,
  Network,
} from "lucide-react";
import {
  loadConsolidatedNetworkReport,
  listNetworkFranchises,
  type NetworkFranchiseOption,
} from "@/actions/master-actions/networkReportActions";
import type {
  ConsolidatedNetworkReport,
  MetricResult,
} from "@/services/dashboardMetrics";
import {
  BiDateFilter,
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

const ALL_FRANCHISES = "__all__";

export default function NetworkReportSection() {
  const [report, setReport] = useState<ConsolidatedNetworkReport | null>(null);
  const [franchises, setFranchises] = useState<NetworkFranchiseOption[]>([]);
  const [dateRange, setDateRange] = useState<BiDateRange>(getDefaultBiDateRange());
  const [selectedFranchise, setSelectedFranchise] = useState<string>(ALL_FRANCHISES);
  const [isPending, startTransition] = useTransition();

  // Load the franchise drill-down options once. Empty when the franchise
  // feature is off, in which case the drill-down control stays hidden.
  useEffect(() => {
    listNetworkFranchises().then(setFranchises).catch(() => setFranchises([]));
  }, []);

  // (Re)load the consolidated report whenever the period or drill-down changes.
  useEffect(() => {
    const franchiseId =
      selectedFranchise === ALL_FRANCHISES ? null : selectedFranchise;
    startTransition(async () => {
      const result = await loadConsolidatedNetworkReport(
        dateRange.from,
        dateRange.to,
        franchiseId,
      );
      setReport(result);
    });
  }, [dateRange, selectedFranchise]);

  return (
    <section className="space-y-4">
      {/* Section header + controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-slate-700" />
          <div>
            <h2 className="text-base font-semibold text-slate-800">
              Franchise Network Report
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Consolidated revenue and operations health across Core
              {selectedFranchise === ALL_FRANCHISES
                ? " and all franchises"
                : " — drilled into one franchise"}{" "}
              · {dateRange.label}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isPending && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <div className="h-3 w-3 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
              Loading...
            </div>
          )}
          {franchises.length > 0 && (
            <Select value={selectedFranchise} onValueChange={setSelectedFranchise}>
              <SelectTrigger className="h-9 w-[200px] text-xs">
                <SelectValue placeholder="All franchises" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FRANCHISES}>Full network (Core + all)</SelectItem>
                {franchises.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <BiDateFilter value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      {/* Metric cards */}
      {!report ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-28 rounded-2xl bg-slate-100 border border-slate-200"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            icon={<IndianRupee className="h-4 w-4 text-emerald-600" />}
            label="Consolidated Revenue"
            metric={report.revenue}
            render={(v) => formatCurrency(v)}
            accentColor="emerald"
          />
          <MetricCard
            icon={<Users className="h-4 w-4 text-emerald-600" />}
            label="Active Subscriptions"
            metric={report.activeSubscriptions}
            render={(v) => v.toLocaleString("en-IN")}
            accentColor="emerald"
          />
          <MetricCard
            icon={<PackageCheck className="h-4 w-4 text-slate-700" />}
            label="Deliveries (Done / Scheduled)"
            metric={report.deliveries}
            render={(v) =>
              `${v.completed.toLocaleString("en-IN")} / ${v.scheduled.toLocaleString("en-IN")}`
            }
            accentColor="slate"
          />
          <MetricCard
            icon={<Truck className="h-4 w-4 text-slate-700" />}
            label="Active Riders"
            metric={report.activeRiders}
            render={(v) => v.toLocaleString("en-IN")}
            accentColor="slate"
          />
        </div>
      )}
    </section>
  );
}

// ─── Metric Card (per-metric error isolation, Req 11.9) ─────────────────────

function MetricCard<T>({
  icon,
  label,
  metric,
  render,
  accentColor,
}: {
  icon: React.ReactNode;
  label: string;
  metric: MetricResult<T>;
  render: (value: T) => string;
  accentColor: "emerald" | "slate";
}) {
  const accentMap = {
    emerald: "text-emerald-600",
    slate: "text-slate-800",
  };

  return (
    <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-5 flex flex-col justify-between min-h-[110px]">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </span>
      </div>
      {metric.ok ? (
        <p className={`text-2xl font-bold mt-2 ${accentMap[accentColor]}`}>
          {render(metric.value)}
        </p>
      ) : (
        <div className="mt-2 flex items-center gap-1.5 text-amber-600">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="text-xs font-medium">Failed to load</span>
        </div>
      )}
    </div>
  );
}

function formatCurrency(amount: number): string {
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${amount.toLocaleString("en-IN")}`;
}
