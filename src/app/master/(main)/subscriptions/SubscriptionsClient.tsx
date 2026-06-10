"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  CreditCard,
  PauseCircle,
  DollarSign,
  CalendarClock,
  Download,
  ChevronDown,
  Search,
} from "lucide-react";
import type {
  SubscriptionKPIs,
  MasterSubscriptionRow,
} from "@/actions/master-actions/subscriptionReportActions";
import { getSubscriptionReportData } from "@/actions/master-actions/subscriptionReportActions";
import type { DateWindow } from "@/types/dashboard";
import { generateCsv, downloadCsv, type CsvColumn } from "@/lib/csv/exportCsv";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

interface SubscriptionsClientProps {
  kpis: SubscriptionKPIs;
  subscriptions: MasterSubscriptionRow[];
}

const SUB_CSV_COLUMNS: CsvColumn<MasterSubscriptionRow>[] = [
  { header: "Sub ID", accessor: (r) => r.subscriptionCode },
  { header: "Customer", accessor: (r) => r.customerName },
  { header: "Plan", accessor: (r) => r.planName },
  { header: "Start Date", accessor: (r) => r.startsOn },
  { header: "End Date", accessor: (r) => r.endsOn },
  { header: "Effective End", accessor: (r) => r.effectiveEndOn || "" },
  { header: "Pause Credits (Total)", accessor: (r) => r.pauseCreditsTotal },
  { header: "Pause Credits (Used)", accessor: (r) => r.pauseCreditsUsed },
  { header: "Pause Credits (Remaining)", accessor: (r) => r.pauseCreditsRemaining },
  { header: "Status", accessor: (r) => r.status },
];

const REPORT_OPTIONS: { label: string; window: DateWindow }[] = [
  { label: "WoW Report (This Week)", window: "wow" },
  { label: "MoM Report (This Month)", window: "mom" },
  { label: "YoY Report (This Year)", window: "yoy" },
];

const STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  ACTIVE: { bg: "bg-emerald-50", text: "text-emerald-700" },
  PAUSED: { bg: "bg-amber-50", text: "text-amber-700" },
  COMPLETED: { bg: "bg-slate-100", text: "text-slate-600" },
  EXPIRED: { bg: "bg-slate-100", text: "text-slate-500" },
  CANCELLED: { bg: "bg-red-50", text: "text-red-700" },
  PENDING: { bg: "bg-blue-50", text: "text-blue-700" },
};

export default function SubscriptionsClient({ kpis, subscriptions }: SubscriptionsClientProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [isExporting, startTransition] = useTransition();

  const filtered = useMemo(() => {
    return subscriptions.filter((sub) => {
      if (statusFilter !== "ALL" && sub.status !== statusFilter) return false;
      if (!searchTerm) return true;
      const lower = searchTerm.toLowerCase();
      return (
        sub.customerName.toLowerCase().includes(lower) ||
        sub.subscriptionCode.toLowerCase().includes(lower)
      );
    });
  }, [subscriptions, searchTerm, statusFilter]);

  const handleExport = (window: DateWindow, label: string) => {
    startTransition(async () => {
      try {
        const data = await getSubscriptionReportData(window);
        const csv = generateCsv(data, SUB_CSV_COLUMNS);
        const filename = `subscriptions_${window}_${new Date().toISOString().split("T")[0]}.csv`;
        downloadCsv(csv, filename);
        toast.success(`${label} downloaded successfully`);
      } catch {
        toast.error("Failed to generate report");
      }
    });
  };

  // Unique statuses for filter tabs
  const statusOptions = useMemo(() => {
    const statuses = new Set(subscriptions.map((s) => s.status));
    return ["ALL", ...Array.from(statuses)];
  }, [subscriptions]);

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard
          icon={<CreditCard className="h-4 w-4 text-emerald-600" />}
          label="Active Subscriptions"
          value={kpis.activeSubscriptions.toLocaleString("en-IN")}
        />
        <KPICard
          icon={<PauseCircle className="h-4 w-4 text-amber-600" />}
          label="Pause Credits Used"
          value={kpis.pauseCreditsUsedThisMonth.toLocaleString("en-IN")}
          subtitle="This month"
        />
        <KPICard
          icon={<DollarSign className="h-4 w-4 text-emerald-600" />}
          label="Revenue Locked"
          value={formatCurrency(kpis.revenueLocked)}
          subtitle="Active plan value"
        />
        <KPICard
          icon={<CalendarClock className="h-4 w-4 text-red-600" />}
          label="Upcoming Renewals"
          value={kpis.upcomingRenewals.toLocaleString("en-IN")}
          subtitle="Next 7 days"
        />
      </div>

      {/* Table Card */}
      <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
        {/* Table Header */}
        <div className="p-5 border-b border-slate-200 bg-slate-50/50 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <CreditCard className="h-4 w-4 text-slate-600" />
            <h3 className="text-sm font-semibold text-slate-800">
              All Subscriptions ({filtered.length})
            </h3>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Status Filter Chips */}
            <div className="flex gap-1.5 flex-wrap">
              {statusOptions.map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    statusFilter === status
                      ? "bg-slate-900 text-white shadow-sm"
                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {status === "ALL" ? "All" : status}
                </button>
              ))}
            </div>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <Input
                placeholder="Search customer or sub ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-9 w-56 text-sm bg-white border-slate-200"
              />
            </div>
            {/* Export Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 border-slate-200"
                  disabled={isExporting}
                >
                  {isExporting ? (
                    <div className="h-3.5 w-3.5 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  Download Reports
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {REPORT_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt.window}
                    onClick={() => handleExport(opt.window, opt.label)}
                  >
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Data Table */}
        <div className="overflow-auto max-h-[560px]">
          <Table>
            <TableHeader>
              <TableRow className="bg-white">
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4">
                  Sub ID
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4">
                  Customer
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4">
                  Plan
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4">
                  Start
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4">
                  Eff. End
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4 text-center">
                  Pause Credits
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4 text-center">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-slate-400">
                    No subscriptions found
                  </TableCell>
                </TableRow>
              ) : (
                filtered.slice(0, 200).map((sub) => {
                  const badge = STATUS_BADGE[sub.status] || STATUS_BADGE.EXPIRED;
                  return (
                    <TableRow key={sub.id} className="hover:bg-slate-50/50 transition-colors">
                      <TableCell className="py-2.5 px-4 font-mono text-xs font-semibold text-slate-700">
                        {sub.subscriptionCode}
                      </TableCell>
                      <TableCell className="py-2.5 px-4 text-sm font-medium text-slate-800">
                        {sub.customerName}
                      </TableCell>
                      <TableCell className="py-2.5 px-4 text-sm text-slate-600">
                        {sub.planName}
                      </TableCell>
                      <TableCell className="py-2.5 px-4 text-xs text-slate-600 whitespace-nowrap">
                        {formatDate(sub.startsOn)}
                      </TableCell>
                      <TableCell className="py-2.5 px-4 text-xs text-slate-600 whitespace-nowrap">
                        {sub.effectiveEndOn ? formatDate(sub.effectiveEndOn) : formatDate(sub.endsOn)}
                      </TableCell>
                      <TableCell className="py-2.5 px-4 text-center">
                        <span className="text-xs font-medium text-slate-700">
                          {sub.pauseCreditsRemaining}
                          <span className="text-slate-400">/{sub.pauseCreditsTotal}</span>
                        </span>
                      </TableCell>
                      <TableCell className="py-2.5 px-4 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
                          {sub.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Footer */}
        {filtered.length > 200 && (
          <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/50 text-xs text-slate-500">
            Showing 200 of {filtered.length} results. Use search or filters to narrow down.
          </div>
        )}
      </div>
    </div>
  );
}

function KPICard({
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
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          {label}
        </span>
      </div>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
    </div>
  );
}

function formatCurrency(amount: number): string {
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${amount.toLocaleString("en-IN")}`;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
