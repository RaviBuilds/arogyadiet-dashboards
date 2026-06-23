"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/shared/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Input } from "@/shared/components/ui/input";
import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Users,
  Search,
  Download,
  CheckCircle2,
  Clock,
  XCircle,
  UserX,
  Plus,
} from "lucide-react";
import * as XLSX from "xlsx";
import { FranchiseCreateCustomerModal } from "./FranchiseCreateCustomerModal";
import { GlassCard, StatCard } from "@/shared/components/franchise/ui/GlassCard";

interface CustomerData {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  mobile: string;
  dietary_preference: string;
  primary_pincode: string;
  status: string;
  gender: string;
  dateOfBirth: string;
  age: number | null;
  allergies: string | null;
  hasMedicalHistory: boolean;
  activePlanName: string | null;
  isActive: boolean;
}

interface Props {
  customers: CustomerData[];
  franchiseId: string;
}

export default function FranchiseCustomerDashboard({ customers, franchiseId }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const activeCount = customers.filter((c) => c.status === "Active").length;
  const pendingCount = customers.filter((c) => c.status === "Pending").length;
  const stoppedCount = customers.filter((c) => c.status === "Stopped" || c.status === "Expired").length;
  const noPlanCount = customers.filter((c) => c.status === "No Plan").length;

  const filteredCustomers = useMemo(() => {
    let result = customers;

    if (statusFilter !== "ALL") {
      result = result.filter((c) => c.status === statusFilter);
    }

    if (search) {
      const term = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.fullName.toLowerCase().includes(term) ||
          c.email.toLowerCase().includes(term) ||
          c.mobile.toLowerCase().includes(term) ||
          c.primary_pincode.includes(term)
      );
    }

    return result;
  }, [customers, search, statusFilter]);

  const handleExport = () => {
    if (filteredCustomers.length === 0) return;
    const exportData = filteredCustomers.map((row) => ({
      "Full Name": row.fullName,
      Email: row.email,
      Mobile: row.mobile,
      Gender: row.gender,
      "Date of Birth": row.dateOfBirth,
      "Dietary Preference": row.dietary_preference,
      "Primary Pincode": row.primary_pincode,
      "Active Plan": row.activePlanName ?? "None",
      Status: row.status,
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Customers");
    XLSX.writeFile(wb, `Franchise_Customers_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
        <StatCard icon={CheckCircle2} label="Active" value={activeCount} accent="text-emerald-600" accentBg="bg-emerald-50" />
        <StatCard icon={Clock} label="Pending" value={pendingCount} accent="text-blue-600" accentBg="bg-blue-50" />
        <StatCard icon={XCircle} label="Stopped / Expired" value={stoppedCount} accent="text-rose-600" accentBg="bg-rose-50" />
        <StatCard icon={UserX} label="No Plan" value={noPlanCount} accent="text-amber-600" accentBg="bg-amber-50" />
      </div>

      {/* Customer Table */}
      <GlassCard className="p-0 overflow-hidden">
        <div className="border-b border-slate-100/80 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-inset ring-white/60">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h2 className="text-sm font-semibold tracking-tight text-slate-800">
                  Customer Directory
                </h2>
                <p className="text-xs uppercase tracking-wider text-slate-400">
                  {filteredCustomers.length} records
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-60">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input
                  placeholder="Search name, email, mobile..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 rounded-xl border-slate-200/80 bg-white/60 pl-9 text-sm shadow-sm"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-32 rounded-xl border-slate-200/80 bg-white/60 text-sm shadow-sm">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Status</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Stopped">Stopped</SelectItem>
                  <SelectItem value="Expired">Expired</SelectItem>
                  <SelectItem value="No Plan">No Plan</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-9 rounded-xl" onClick={handleExport} disabled={filteredCustomers.length === 0}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export
              </Button>
              <Button size="sm" className="h-9 rounded-xl shadow-sm" onClick={() => setIsCreateModalOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Create Customer
              </Button>
            </div>
          </div>
        </div>
        <div className="p-6 pt-4">
          {filteredCustomers.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-12">No customers match your criteria.</p>
          ) : (
            <div className="overflow-auto rounded-xl ring-1 ring-slate-100">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/60 hover:bg-slate-50/60">
                    <TableHead className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Customer</TableHead>
                    <TableHead className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Contact</TableHead>
                    <TableHead className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Diet</TableHead>
                    <TableHead className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Pincode</TableHead>
                    <TableHead className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Plan</TableHead>
                    <TableHead className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCustomers.map((customer) => (
                    <TableRow key={customer.id} className="border-slate-100 transition-colors hover:bg-slate-50/40">
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium text-slate-800">{customer.fullName}</p>
                          {customer.age && (
                            <p className="text-[10px] text-slate-400">
                              {customer.gender !== "N/A" ? `${customer.gender}, ` : ""}{customer.age} yrs
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="text-xs text-slate-600">{customer.email}</p>
                          <p className="text-[11px] text-slate-400">{customer.mobile}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="rounded-lg text-[10px]">
                          {customer.dietary_preference}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-slate-600">{customer.primary_pincode}</TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {customer.activePlanName ?? <span className="text-slate-400">—</span>}
                      </TableCell>
                      <TableCell>
                        <CustomerStatusBadge status={customer.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </GlassCard>

      {/* Create Customer Modal */}
      <FranchiseCreateCustomerModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        franchiseId={franchiseId}
      />
    </div>
  );
}

function CustomerStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Pending: "bg-blue-50 text-blue-700 border-blue-200",
    Stopped: "bg-red-50 text-red-700 border-red-200",
    Expired: "bg-slate-100 text-slate-600 border-slate-200",
    "No Plan": "bg-amber-50 text-amber-700 border-amber-200",
  };

  return (
    <Badge variant="outline" className={`text-[10px] ${colors[status] ?? "text-slate-500"}`}>
      {status}
    </Badge>
  );
}
