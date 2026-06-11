"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Users,
  TrendingUp,
  Heart,
  UserCheck,
  Download,
  ChevronDown,
  Search,
} from "lucide-react";
import type {
  CustomerKPIs,
  MasterCustomerRow,
} from "@/actions/master-actions/customerReportActions";
import { getCustomerReportData } from "@/actions/master-actions/customerReportActions";
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

interface CustomersClientProps {
  kpis: CustomerKPIs;
  customers: MasterCustomerRow[];
}

const CUSTOMER_CSV_COLUMNS: CsvColumn<MasterCustomerRow>[] = [
  { header: "Full Name", accessor: (r) => r.fullName },
  { header: "Email", accessor: (r) => r.email },
  { header: "Mobile", accessor: (r) => r.mobile || "" },
  { header: "Dietary Preference", accessor: (r) => r.dietaryPreference || "" },
  { header: "Total Subscriptions", accessor: (r) => r.totalSubscriptions },
  { header: "Status", accessor: (r) => (r.isActive ? "Active" : "Inactive") },
  { header: "Created At", accessor: (r) => r.createdAt?.split("T")[0] || "" },
];

const REPORT_OPTIONS: { label: string; window: DateWindow }[] = [
  { label: "WoW Report (This Week)", window: "wow" },
  { label: "MoM Report (This Month)", window: "mom" },
  { label: "YoY Report (This Year)", window: "yoy" },
];

export default function CustomersClient({ kpis, customers }: CustomersClientProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isExporting, startTransition] = useTransition();

  const filtered = useMemo(() => {
    if (!searchTerm) return customers;
    const lower = searchTerm.toLowerCase();
    return customers.filter(
      (c) =>
        c.fullName.toLowerCase().includes(lower) ||
        c.email.toLowerCase().includes(lower)
    );
  }, [customers, searchTerm]);

  const handleExport = (window: DateWindow, label: string) => {
    startTransition(async () => {
      try {
        const data = await getCustomerReportData(window);
        const csv = generateCsv(data, CUSTOMER_CSV_COLUMNS);
        const filename = `customers_${window}_${new Date().toISOString().split("T")[0]}.csv`;
        downloadCsv(csv, filename);
        toast.success(`${label} downloaded successfully`);
      } catch {
        toast.error("Failed to generate report");
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard
          icon={<Users className="h-4 w-4 text-emerald-600" />}
          label="Total Registered"
          value={kpis.totalRegistered.toLocaleString("en-IN")}
        />
        <KPICard
          icon={<TrendingUp className="h-4 w-4 text-emerald-600" />}
          label="Active vs Churned"
          value={`${kpis.activeChurnRatio}%`}
          subtitle={`${kpis.activeCustomers} active · ${kpis.churnedCustomers} churned`}
        />
        <KPICard
          icon={<Heart className="h-4 w-4 text-red-600" />}
          label="Average LTV"
          value={`₹${kpis.averageLTV.toLocaleString("en-IN")}`}
          subtitle="Per customer"
        />
        <KPICard
          icon={<UserCheck className="h-4 w-4 text-slate-600" />}
          label="Profile Completion"
          value={`${kpis.profileCompletionRate}%`}
          subtitle="Have dietary/DOB data"
        />
      </div>

      {/* Table Card */}
      <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
        {/* Table Header */}
        <div className="p-5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users className="h-4 w-4 text-slate-600" />
            <h3 className="text-sm font-semibold text-slate-800">
              All Customers ({filtered.length})
            </h3>
          </div>
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <Input
                placeholder="Search name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-9 w-64 text-sm bg-white border-slate-200"
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
                  Name
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4">
                  Email
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4">
                  Mobile
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4">
                  Diet Preference
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4 text-center">
                  Subscriptions
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-3 px-4 text-center">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-slate-400">
                    No customers found
                  </TableCell>
                </TableRow>
              ) : (
                filtered.slice(0, 200).map((customer) => (
                  <TableRow key={customer.profileId} className="hover:bg-slate-50/50 transition-colors">
                    <TableCell className="py-2.5 px-4 font-medium text-slate-800 text-sm">
                      {customer.fullName}
                    </TableCell>
                    <TableCell className="py-2.5 px-4 text-slate-600 text-sm">
                      {customer.email}
                    </TableCell>
                    <TableCell className="py-2.5 px-4 text-slate-600 text-sm font-mono">
                      {customer.mobile || "—"}
                    </TableCell>
                    <TableCell className="py-2.5 px-4 text-sm">
                      {customer.dietaryPreference ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-800">
                          {customer.dietaryPreference}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2.5 px-4 text-center text-sm font-semibold text-slate-700">
                      {customer.totalSubscriptions}
                    </TableCell>
                    <TableCell className="py-2.5 px-4 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        customer.isActive
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-red-50 text-red-700"
                      }`}>
                        {customer.isActive ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Footer */}
        {filtered.length > 200 && (
          <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/50 text-xs text-slate-500">
            Showing 200 of {filtered.length} results. Use search to narrow down.
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
