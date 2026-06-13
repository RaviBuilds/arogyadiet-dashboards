"use client";

import { useState, useMemo, useTransition, useRef } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  IndianRupee,
  TrendingUp,
  Clock,
  CreditCard,
  Landmark,
  RefreshCw,
  Loader2,
  CircleSlash,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import * as XLSX from "xlsx";
import { getSubscriptionPayments } from "@/actions/admin-actions/financeActions";
import { DataTableCard } from "@/shared/components/admin/core/DataTableCard";
import { SectionHeader } from "@/shared/components/admin/core/SectionHeader";
import { DataSearchFilter } from "@/shared/components/admin/core/DataSearchFilter";
import { StatusBadge } from "@/shared/components/admin/core/StatusBadge";
import { ExportButton } from "@/shared/components/admin/core/ActionButtons";

// ─── Types ──────────────────────────────────

interface Payment {
  id: string;
  amount: number;
  status: string;
  paymentMethod: string;
  paidAt: string | null;
  createdAt: string;
  customerName: string;
  customerEmail: string;
  subscriptionCode: string;
  planName: string;
}

interface OverviewData {
  totalRevenue: number;
  pendingCollections: number;
  thisMonthRevenue: number;
}

// ─── Helpers ────────────────────────────────

function formatCurrency(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function formatFullCurrency(amount: number): string {
  return `₹${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format(amount)}`;
}

const TONE_STYLES: Record<string, { bg: string; icon: string }> = {
  emerald: { bg: "bg-emerald-50", icon: "text-emerald-600" },
  blue: { bg: "bg-blue-50", icon: "text-blue-600" },
  orange: { bg: "bg-orange-50", icon: "text-orange-600" },
  violet: { bg: "bg-violet-50", icon: "text-violet-600" },
};

const COLLECTION_COLORS: Record<string, string> = {
  Online: "#16a34a",
  Branch: "#2563eb",
};

const STATUS_COLORS: Record<string, string> = {
  Collected: "#16a34a",
  Pending: "#f59e0b",
};

const tooltipStyle = {
  borderRadius: "12px",
  border: "1px solid #e2e8f0",
  fontSize: "12px",
} as const;

// ─── Main Component ─────────────────────────

export function SubscriptionRevenueView({
  overviewData,
  initialPayments,
}: {
  overviewData: OverviewData;
  initialPayments: Payment[];
}) {
  const [payments, setPayments] = useState<Payment[]>(initialPayments);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [methodFilter, setMethodFilter] = useState("ALL");
  const [searchColumn, setSearchColumn] = useState("customerName");
  const [searchTerm, setSearchTerm] = useState("");
  const [isPending, startTransition] = useTransition();

  const channelRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  const handleFilter = () => {
    startTransition(async () => {
      const data = await getSubscriptionPayments({
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        status: statusFilter,
        method: methodFilter,
      });
      setPayments(data);
    });
  };

  const filtered = useMemo(() => {
    if (!searchTerm) return payments;
    const lower = searchTerm.toLowerCase();
    return payments.filter((p) => {
      if (searchColumn === "customerName")
        return p.customerName.toLowerCase().includes(lower);
      if (searchColumn === "subscriptionCode")
        return p.subscriptionCode.toLowerCase().includes(lower);
      if (searchColumn === "planName")
        return p.planName.toLowerCase().includes(lower);
      return true;
    });
  }, [payments, searchTerm, searchColumn]);

  const totalFiltered = filtered.reduce((sum, p) => sum + p.amount, 0);

  // Compute donut data
  const onlineAmount = payments
    .filter((p) => p.paymentMethod === "RAZORPAY" && ["PAID", "SUCCESS", "CAPTURED"].includes(p.status))
    .reduce((sum, p) => sum + p.amount, 0);
  const branchAmount = payments
    .filter((p) => p.paymentMethod === "MANUAL" && ["PAID", "SUCCESS", "CAPTURED"].includes(p.status))
    .reduce((sum, p) => sum + p.amount, 0);

  const collectedAmount = payments
    .filter((p) => ["PAID", "SUCCESS", "CAPTURED"].includes(p.status))
    .reduce((sum, p) => sum + p.amount, 0);
  const pendingAmount = payments
    .filter((p) => p.status === "PENDING")
    .reduce((sum, p) => sum + p.amount, 0);

  const channelData = [
    { name: "Online", value: onlineAmount },
    { name: "Branch", value: branchAmount },
  ].filter((d) => d.value > 0);

  const statusData = [
    { name: "Collected", value: collectedAmount },
    { name: "Pending", value: pendingAmount },
  ].filter((d) => d.value > 0);

  const totalCollected = overviewData.totalRevenue;
  const collectedPct = totalCollected > 0
    ? ((collectedAmount / (collectedAmount + pendingAmount)) * 100).toFixed(0)
    : "0";

  const handleExport = () => {
    if (filtered.length === 0) return;
    const exportData = filtered.map((p) => ({
      "Customer Name": p.customerName,
      Email: p.customerEmail,
      Plan: p.planName,
      "Subscription Code": p.subscriptionCode,
      Method: p.paymentMethod,
      "Amount (INR)": p.amount,
      Status: p.status,
      Date: p.createdAt
        ? new Date(p.createdAt).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })
        : "N/A",
    }));
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Revenue");
    XLSX.writeFile(workbook, `Subscription_Revenue_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* KPI Ribbon */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          icon={<IndianRupee className="h-4 w-4" />}
          tone="emerald"
          label="Total Revenue"
          value={formatCurrency(overviewData.totalRevenue)}
          subtitle={formatFullCurrency(overviewData.totalRevenue)}
        />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          tone="blue"
          label="This Month"
          value={formatCurrency(overviewData.thisMonthRevenue)}
          subtitle={`${totalCollected > 0 ? ((overviewData.thisMonthRevenue / totalCollected) * 100).toFixed(1) : 0}% of total`}
        />
        <KpiCard
          icon={<Clock className="h-4 w-4" />}
          tone="orange"
          label="Pending Collections"
          value={formatCurrency(overviewData.pendingCollections)}
          subtitle="Payment overdue"
          alert={overviewData.pendingCollections > 0}
        />
        <KpiCard
          icon={<CreditCard className="h-4 w-4" />}
          tone="violet"
          label="Collection Rate"
          value={`${collectedPct}%`}
          subtitle="Collected vs total invoiced"
        />
      </div>

      {/* Donut Charts Row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Online vs Branch */}
        <ChartCard
          title="Collection Channel Split"
          subtitle="Online (Razorpay) vs Branch (Cash/UPI)"
          icon={<Landmark className="h-4 w-4 text-blue-600" />}
          chartRef={channelRef}
        >
          {channelData.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={channelData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                >
                  {channelData.map((d) => (
                    <Cell key={d.name} fill={COLLECTION_COLORS[d.name]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => [formatFullCurrency(Number(v)), "Amount"]}
                  contentStyle={tooltipStyle}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  iconType="circle"
                  wrapperStyle={{ fontSize: 11 }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Pending vs Collected */}
        <ChartCard
          title="Payment Status"
          subtitle="Collected vs Pending across all subscriptions"
          icon={<Clock className="h-4 w-4 text-orange-600" />}
          chartRef={statusRef}
        >
          {statusData.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                >
                  {statusData.map((d) => (
                    <Cell key={d.name} fill={STATUS_COLORS[d.name]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => [formatFullCurrency(Number(v)), "Amount"]}
                  contentStyle={tooltipStyle}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  iconType="circle"
                  wrapperStyle={{ fontSize: 11 }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">From</label>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-9 w-[150px] bg-white"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">To</label>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-9 w-[150px] bg-white"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Status</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-[130px] bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All</SelectItem>
              <SelectItem value="PAID">Paid</SelectItem>
              <SelectItem value="SUCCESS">Success</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Channel</label>
          <Select value={methodFilter} onValueChange={setMethodFilter}>
            <SelectTrigger className="h-9 w-[130px] bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All</SelectItem>
              <SelectItem value="RAZORPAY">Online</SelectItem>
              <SelectItem value="MANUAL">Branch</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={handleFilter}
          disabled={isPending}
          className="h-9 gap-2 shadow-sm font-medium bg-slate-900 hover:bg-slate-800 text-white"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Apply
        </Button>
      </div>

      {/* Payments Table */}
      <DataTableCard
        header={<SectionHeader title="Subscription Payments" icon={IndianRupee} />}
        controls={
          <DataSearchFilter
            searchColumn={searchColumn}
            onColumnChange={setSearchColumn}
            searchTerm={searchTerm}
            onTermChange={setSearchTerm}
            options={[
              { value: "customerName", label: "Customer Name" },
              { value: "subscriptionCode", label: "Sub Code" },
              { value: "planName", label: "Plan Name" },
            ]}
          />
        }
        actions={
          <ExportButton
            onClick={handleExport}
            disabled={filtered.length === 0}
            label="Export Excel"
          />
        }
        footer={
          <div className="flex items-center justify-between w-full">
            <p className="text-sm text-slate-500">
              Showing{" "}
              <span className="font-semibold text-slate-900">
                {filtered.length}
              </span>{" "}
              payments
            </p>
            <p className="text-sm font-semibold text-slate-900">
              Total: {formatFullCurrency(totalFiltered)}
            </p>
          </div>
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/10">
              <TableHead>Customer</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Sub Code</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-slate-400">
                  No payments found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{p.customerName}</p>
                      <p className="text-xs text-slate-400">{p.customerEmail}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{p.planName}</TableCell>
                  <TableCell className="text-sm font-mono text-slate-500">
                    {p.subscriptionCode}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={p.paymentMethod === "RAZORPAY" ? "Online" : "Branch"} />
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatFullCurrency(p.amount)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {p.createdAt
                      ? new Date(p.createdAt).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : "N/A"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DataTableCard>
    </div>
  );
}

// ─── KPI Card (matches Inventory Intelligence) ─────────────

function KpiCard({
  icon,
  label,
  value,
  subtitle,
  tone,
  alert = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle?: string;
  tone: keyof typeof TONE_STYLES;
  alert?: boolean;
}) {
  const t = TONE_STYLES[tone];
  return (
    <div
      className={`group rounded-2xl border p-4 shadow-sm transition-all hover:shadow-md ${
        alert
          ? "border-amber-200 bg-amber-50/60"
          : "border-slate-200 bg-white/95"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${t.bg} ${t.icon}`}
        >
          {icon}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 leading-tight">
          {label}
        </span>
      </div>
      <p
        className={`text-xl font-bold tracking-tight ${
          alert ? "text-amber-700" : "text-slate-800"
        }`}
      >
        {value}
      </p>
      {subtitle && (
        <p className="mt-0.5 text-[11px] text-slate-500 truncate">{subtitle}</p>
      )}
    </div>
  );
}

// ─── Chart Card wrapper ────────────────────────

function ChartCard({
  title,
  subtitle,
  icon,
  chartRef,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  chartRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  return (
    <div
      ref={chartRef}
      className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-5"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            {icon}
            <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
        </div>
      </div>
      <div className="h-[260px]">{children}</div>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-slate-400">
      <CircleSlash className="h-8 w-8 mb-2 text-slate-300" />
      <p className="text-xs">No data for this view</p>
    </div>
  );
}
