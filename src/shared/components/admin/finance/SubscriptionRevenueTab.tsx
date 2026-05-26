"use client";

import { useState, useMemo, useTransition } from "react";
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
import { RefreshCw, Loader2, IndianRupee } from "lucide-react";
import * as XLSX from "xlsx";

import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DataSearchFilter } from "../core/DataSearchFilter";
import { StatusBadge } from "../core/StatusBadge";
import { ExportButton } from "../core/ActionButtons";
import { getSubscriptionPayments } from "@/actions/admin-actions/financeActions";

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

export function SubscriptionRevenueTab({
  initialPayments,
}: {
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

  const handleExport = () => {
    if (filtered.length === 0) return;
    const exportData = filtered.map((p) => ({
      "Customer Name": p.customerName,
      "Email": p.customerEmail,
      "Plan": p.planName,
      "Subscription Code": p.subscriptionCode,
      "Method": p.paymentMethod,
      "Amount (INR)": p.amount,
      "Status": p.status,
      "Date": p.createdAt
        ? new Date(p.createdAt).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })
        : "N/A",
    }));
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Subscription Revenue");
    XLSX.writeFile(
      workbook,
      `Subscription_Revenue_${new Date().toISOString().split("T")[0]}.xlsx`,
    );
  };

  return (
    <div className="space-y-4">
      {/* Date + Status + Method Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            From
          </label>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-9 w-[150px] bg-background"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            To
          </label>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-9 w-[150px] bg-background"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Status
          </label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-[130px] bg-background">
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
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Method
          </label>
          <Select value={methodFilter} onValueChange={setMethodFilter}>
            <SelectTrigger className="h-9 w-[130px] bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All</SelectItem>
              <SelectItem value="RAZORPAY">Razorpay</SelectItem>
              <SelectItem value="MANUAL">Manual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={handleFilter}
          disabled={isPending}
          className="h-9 gap-2 shadow-sm font-medium bg-green-600 hover:bg-green-700 text-white"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Apply
        </Button>
      </div>

      {/* Table */}
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
            <p className="text-sm text-muted-foreground">
              Showing{" "}
              <span className="font-semibold text-foreground">
                {filtered.length}
              </span>{" "}
              payments
            </p>
            <p className="text-sm font-semibold text-foreground">
              Total: ₹
              {new Intl.NumberFormat("en-IN", {
                minimumFractionDigits: 2,
              }).format(totalFiltered)}
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
              <TableHead>Method</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-24 text-center text-muted-foreground"
                >
                  No payments found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{p.customerName}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.customerEmail}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{p.planName}</TableCell>
                  <TableCell className="text-sm font-mono text-muted-foreground">
                    {p.subscriptionCode}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={p.paymentMethod} />
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    ₹
                    {new Intl.NumberFormat("en-IN", {
                      minimumFractionDigits: 2,
                    }).format(p.amount)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
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
