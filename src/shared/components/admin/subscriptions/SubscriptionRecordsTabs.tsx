"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Eye, MoreHorizontal, Users } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DataSearchFilter } from "../core/DataSearchFilter";
import { StatusBadge } from "../core/StatusBadge";
import { ExportButton, RefreshButton } from "../core/ActionButtons";
import type { ActiveSubscriptionData } from "@/shared/components/admin/customers/CustomerDashboard";

export type SubscriptionRecordsTab =
  | "Active Subscriptions"
  | "Pending Subscriptions"
  | "Expired / Stopped";

interface Props {
  activeTab: SubscriptionRecordsTab;
  activeSubscriptions?: ActiveSubscriptionData[];
  pendingSubscriptions?: ActiveSubscriptionData[];
  stoppedSubscriptions?: ActiveSubscriptionData[];
}

/**
 * Renders the Active / Pending / Expired-Stopped subscription record tables.
 * Moved out of CustomerDashboard so these lists live under the Subscriptions portal.
 */
export function SubscriptionRecordsTabs({
  activeTab,
  activeSubscriptions = [],
  pendingSubscriptions = [],
  stoppedSubscriptions = [],
}: Props) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [searchColumn, setSearchColumn] = useState("customer_name");
  const [searchTerm, setSearchTerm] = useState("");

  const searchOptions = useMemo(
    () => [
      { value: "customer_name", label: "Customer Name" },
      { value: "email", label: "Email ID" },
      { value: "plan_name", label: "Plan Name" },
    ],
    [],
  );

  const filterSubList = (list: ActiveSubscriptionData[]) => {
    if (!searchTerm) return list;
    const lowerTerm = searchTerm.toLowerCase();
    return list.filter((sub) => {
      if (searchColumn === "customer_name")
        return sub.customer_name.toLowerCase().includes(lowerTerm);
      if (searchColumn === "email")
        return sub.email.toLowerCase().includes(lowerTerm);
      if (searchColumn === "plan_name")
        return sub.plan_name.toLowerCase().includes(lowerTerm);
      return true;
    });
  };

  const filteredActiveSubscriptions = useMemo(
    () => filterSubList(activeSubscriptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSubscriptions, searchTerm, searchColumn],
  );

  const filteredPendingSubscriptions = useMemo(
    () => filterSubList(pendingSubscriptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingSubscriptions, searchTerm, searchColumn],
  );

  const filteredStoppedSubscriptions = useMemo(
    () => filterSubList(stoppedSubscriptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stoppedSubscriptions, searchTerm, searchColumn],
  );

  const handleRefresh = () => {
    setIsLoading(true);
    startTransition(() => {
      router.refresh();
      setIsLoading(false);
      toast.success("Data refreshed successfully");
    });
  };

  const handleExportExcel = () => {
    if (activeTab === "Active Subscriptions") {
      if (filteredActiveSubscriptions.length === 0) return;
      const exportData = filteredActiveSubscriptions.map((row) => ({
        "Customer Name": row.customer_name,
        Email: row.email,
        "Plan Name": row.plan_name,
        "Total Days": row.total_days,
        "Starts On": row.starts_on,
        "Ends On": row.ends_on,
        "Pause Credits Total": row.pause_credits_total,
        "Pause Credits Used": row.pause_credits_used,
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Active Subscriptions");
      XLSX.writeFile(
        wb,
        `ActiveSubscriptions_${new Date().toISOString().split("T")[0]}.xlsx`,
      );
    } else if (activeTab === "Pending Subscriptions") {
      if (filteredPendingSubscriptions.length === 0) return;
      const exportData = filteredPendingSubscriptions.map((row) => ({
        "Customer Name": row.customer_name,
        Email: row.email,
        "Plan Name": row.plan_name,
        "Total Days": row.total_days,
        "Scheduled Start": row.starts_on,
        "Pause Credits Total": row.pause_credits_total,
        "Pause Credits Used": row.pause_credits_used,
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Pending Subscriptions");
      XLSX.writeFile(
        wb,
        `PendingSubscriptions_${new Date().toISOString().split("T")[0]}.xlsx`,
      );
    } else if (activeTab === "Expired / Stopped") {
      if (filteredStoppedSubscriptions.length === 0) return;
      const exportData = filteredStoppedSubscriptions.map((row) => ({
        "Customer Name": row.customer_name,
        Email: row.email,
        "Plan Name": row.plan_name,
        "Total Days": row.total_days,
        "Start Date": row.starts_on,
        "End Date": row.ends_on,
        Status: row.status,
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Expired-Stopped");
      XLSX.writeFile(
        wb,
        `ExpiredStopped_${new Date().toISOString().split("T")[0]}.xlsx`,
      );
    }
  };

  if (activeTab === "Active Subscriptions") {
    return (
      <DataTableCard
        header={<SectionHeader title="Active Subscriptions" icon={Users} />}
        controls={
          <div className="flex flex-wrap items-center gap-4">
            <DataSearchFilter
              searchColumn={searchColumn}
              onColumnChange={setSearchColumn}
              searchTerm={searchTerm}
              onTermChange={setSearchTerm}
              options={searchOptions}
            />
          </div>
        }
        actions={
          <>
            <ExportButton
              onClick={handleExportExcel}
              disabled={filteredActiveSubscriptions.length === 0}
            />
            <RefreshButton
              onClick={handleRefresh}
              isLoading={isLoading || isPending}
            />
          </>
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/50 border-b border-slate-200">
              <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">Customer</TableHead>
              <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">Plan</TableHead>
              <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">Dates</TableHead>
              <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">Pause Credits</TableHead>
              <TableHead className="w-[50px] text-xs font-medium text-slate-500 uppercase tracking-wider">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredActiveSubscriptions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center py-12 text-sm text-slate-500"
                >
                  No active subscriptions match your criteria.
                </TableCell>
              </TableRow>
            ) : (
              filteredActiveSubscriptions.map((sub) => (
                <TableRow key={sub.id} className="hover:bg-slate-50 transition-colors duration-200">
                  <TableCell>
                    <div className="font-semibold text-slate-900 tracking-tight">{sub.customer_name}</div>
                    <div className="text-sm text-slate-500 mt-0.5">
                      {sub.email}
                    </div>
                  </TableCell>
                  <TableCell>
                    {sub.plan_name}
                    <div className="text-sm text-slate-500 mt-0.5">
                      Total Days: {sub.total_days}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      Starts: {new Date(sub.starts_on).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </div>
                    <div className="text-sm">
                      Ends: {new Date(sub.ends_on).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      Total: {sub.pause_credits_total}
                    </div>
                    <div className="text-sm">
                      Used: {sub.pause_credits_used}
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0 transition-all duration-200 hover:bg-slate-100">
                          <MoreHorizontal className="h-4 w-4 text-slate-500" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-[180px]">
                        <DropdownMenuItem asChild>
                          <Link
                            href={`/subscriptions/${sub.id}`}
                            className="cursor-pointer font-medium flex items-center"
                          >
                            <Eye className="mr-2 h-4 w-4 text-primary" />
                            View Subscription 360
                          </Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DataTableCard>
    );
  }

  if (activeTab === "Pending Subscriptions") {
    return (
      <DataTableCard
        header={<SectionHeader title="Pending Subscriptions" icon={Users} />}
        controls={
          <div className="flex flex-wrap items-center gap-4">
            <DataSearchFilter
              searchColumn={searchColumn}
              onColumnChange={setSearchColumn}
              searchTerm={searchTerm}
              onTermChange={setSearchTerm}
              options={searchOptions}
            />
          </div>
        }
        actions={
          <>
            <ExportButton
              onClick={handleExportExcel}
              disabled={filteredPendingSubscriptions.length === 0}
            />
            <RefreshButton
              onClick={handleRefresh}
              isLoading={isLoading || isPending}
            />
          </>
        }
      >
        <div className="mx-6 mt-6 mb-2 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800 shadow-sm">
          <span className="mt-0.5 shrink-0">ℹ️</span>
          <span>
            Go to the{" "}
            <strong>Subscription 360 Dashboard</strong> (via the Actions menu
            below) to manage or activate pending subscriptions. Pending
            subscriptions are automatically activated the day before their
            scheduled start date.
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/50 border-b border-slate-200">
              <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">Customer</TableHead>
              <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">Plan</TableHead>
              <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">Scheduled Start Date</TableHead>
              <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">Pause Credits</TableHead>
              <TableHead className="w-[50px] text-xs font-medium text-slate-500 uppercase tracking-wider">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPendingSubscriptions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center py-12 text-sm text-slate-500"
                >
                  No pending subscriptions found.
                </TableCell>
              </TableRow>
            ) : (
              filteredPendingSubscriptions.map((sub) => (
                <TableRow key={sub.id} className="hover:bg-slate-50 transition-colors duration-200">
                  <TableCell>
                    <div className="font-semibold text-slate-900 tracking-tight">{sub.customer_name}</div>
                    <div className="text-sm text-slate-500 mt-0.5">
                      {sub.email}
                    </div>
                  </TableCell>
                  <TableCell>
                    {sub.plan_name}
                    <div className="text-sm text-slate-500 mt-0.5">
                      Total Days: {sub.total_days}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">
                      {new Date(sub.starts_on).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      Total: {sub.pause_credits_total}
                    </div>
                    <div className="text-sm">
                      Used: {sub.pause_credits_used}
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0 transition-all duration-200 hover:bg-slate-100">
                          <MoreHorizontal className="h-4 w-4 text-slate-500" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-[200px]">
                        <DropdownMenuItem asChild>
                          <Link
                            href={`/subscriptions/${sub.id}`}
                            className="cursor-pointer font-medium flex items-center"
                          >
                            <Eye className="mr-2 h-4 w-4 text-primary" />
                            View Subscription 360
                          </Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DataTableCard>
    );
  }

  if (activeTab === "Expired / Stopped") {
    return (
      <DataTableCard
        header={<SectionHeader title="Expired / Stopped Subscriptions" icon={Users} />}
        controls={
          <div className="flex flex-wrap items-center gap-4">
            <DataSearchFilter
              searchColumn={searchColumn}
              onColumnChange={setSearchColumn}
              searchTerm={searchTerm}
              onTermChange={setSearchTerm}
              options={searchOptions}
            />
          </div>
        }
        actions={
          <>
            <ExportButton
              onClick={handleExportExcel}
              disabled={filteredStoppedSubscriptions.length === 0}
            />
            <RefreshButton
              onClick={handleRefresh}
              isLoading={isLoading || isPending}
            />
          </>
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/50 border-b border-slate-200">
              <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">Customer</TableHead>
              <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">Plan</TableHead>
              <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">Start Date</TableHead>
              <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">End Date</TableHead>
              <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">Status</TableHead>
              <TableHead className="w-[50px] text-xs font-medium text-slate-500 uppercase tracking-wider">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredStoppedSubscriptions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center py-12 text-sm text-slate-500"
                >
                  No expired or stopped subscriptions found.
                </TableCell>
              </TableRow>
            ) : (
              filteredStoppedSubscriptions.map((sub) => (
                <TableRow key={sub.id} className="hover:bg-slate-50 transition-colors duration-200">
                  <TableCell>
                    <div className="font-semibold text-slate-900 tracking-tight">{sub.customer_name}</div>
                    <div className="text-sm text-slate-500 mt-0.5">
                      {sub.email}
                    </div>
                  </TableCell>
                  <TableCell>
                    {sub.plan_name}
                    <div className="text-sm text-slate-500 mt-0.5">
                      Total Days: {sub.total_days}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {sub.starts_on
                        ? new Date(sub.starts_on).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                        : "—"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {sub.ends_on
                        ? new Date(sub.ends_on).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                        : "—"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={sub.status} variant="outline" />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0 transition-all duration-200 hover:bg-slate-100">
                          <MoreHorizontal className="h-4 w-4 text-slate-500" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-[200px]">
                        <DropdownMenuItem asChild>
                          <Link
                            href={`/subscriptions/${sub.id}`}
                            className="cursor-pointer font-medium flex items-center"
                          >
                            <Eye className="mr-2 h-4 w-4 text-primary" />
                            View Subscription 360
                          </Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DataTableCard>
    );
  }

  return null;
}
