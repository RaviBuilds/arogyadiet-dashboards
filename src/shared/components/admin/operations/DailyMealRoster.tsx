"use client";

import { useState, useMemo, useTransition } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

import { CalendarDays } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

// Core Components
import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DataSearchFilter } from "../core/DataSearchFilter";
import { DateRangeFilter } from "../core/DateRangeFilter";
import { StatusBadge } from "../core/StatusBadge";
import { ExportButton } from "../core/ActionButtons";

export default function DailyMealRoster({
  initialRosterData = [],
}: {
  initialRosterData?: any[];
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Search State
  const [searchColumn, setSearchColumn] = useState("sub_code");
  const [searchTerm, setSearchTerm] = useState("");

  // Date Range State
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  console.log("VISIBLE ROSTER DATA =>", initialRosterData);

  // Filter Logic
  const filteredData = useMemo(() => {
    let result = initialRosterData;

    if (searchTerm) {
      const lowerTerm = searchTerm.toLowerCase();

      result = result.filter((row) => {
        const subscriptionCode =
          row?.subscriptions?.subscription_code?.toLowerCase() || "";

        const customerName =
          row?.customer_profiles?.users?.full_name?.toLowerCase() || "";

        const pincode =
          row?.addresses?.pincode?.toString()?.toLowerCase() || "";

        if (searchColumn === "sub_code") {
          return subscriptionCode.includes(lowerTerm);
        }

        if (searchColumn === "customer") {
          return customerName.includes(lowerTerm);
        }

        if (searchColumn === "pincode") {
          return pincode.includes(lowerTerm);
        }

        return true;
      });
    }

    return result;
  }, [initialRosterData, searchTerm, searchColumn]);

  const handleLoadRange = () => {
    if (!fromDate || !toDate) {
      toast.error("Please select both From and To dates.");
      return;
    }

    setIsLoading(true);

    startTransition(() => {
      setTimeout(() => {
        setIsLoading(false);
        toast.success("Roster data refreshed.");
      }, 500);
    });
  };

  const handleExportExcel = () => {
    if (filteredData.length === 0) return;

    const exportData = filteredData.map((row) => ({
      "Sub Code": row?.subscriptions?.subscription_code || "N/A",

      Customer: row?.customer_profiles?.users?.full_name || "Unknown",

      "Delivery Date": row?.preference_date
        ? new Date(row.preference_date).toDateString()
        : "N/A",

      "Meal Type": row?.meal_categories?.name || "N/A",

      Pincode: row?.addresses?.pincode || "N/A",

      Status: row?.is_paused ? "PAUSED" : "ACTIVE",
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Daily Meal Roster");

    XLSX.writeFile(
      workbook,
      `Meal_Roster_${new Date().toISOString().split("T")[0]}.xlsx`,
    );
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "N/A";

    const d = new Date(dateStr);

    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <DataTableCard
        header={<SectionHeader title="Daily Meal Roster" icon={CalendarDays} />}
        controls={
          <div className="flex flex-col xl:flex-row items-start xl:items-center gap-4 w-full">
            <DataSearchFilter
              searchColumn={searchColumn}
              onColumnChange={setSearchColumn}
              searchTerm={searchTerm}
              onTermChange={setSearchTerm}
              options={[
                {
                  value: "sub_code",
                  label: "Subscription Code",
                },
                {
                  value: "customer",
                  label: "Customer Name",
                },
                {
                  value: "pincode",
                  label: "Pincode",
                },
              ]}
            />

            <div className="hidden xl:block w-px h-8 bg-border/60 mx-2"></div>

            <DateRangeFilter
              fromDate={fromDate}
              onFromChange={setFromDate}
              toDate={toDate}
              onToChange={setToDate}
              onLoad={handleLoadRange}
              isLoading={isLoading || isPending}
            />
          </div>
        }
        actions={
          <ExportButton
            onClick={handleExportExcel}
            disabled={filteredData.length === 0}
          />
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/10">
              <TableHead>Sub Code</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Delivery Date</TableHead>
              <TableHead>Meal Type</TableHead>
              <TableHead>Pincode</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {filteredData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center py-12 text-muted-foreground"
                >
                  No meals found for the selected range and filters.
                </TableCell>
              </TableRow>
            ) : (
              filteredData.map((row, i) => (
                <TableRow key={row.id || i} className="hover:bg-muted/30">
                  <TableCell className="font-medium">
                    {row?.subscriptions?.subscription_code || "N/A"}
                  </TableCell>

                  <TableCell>
                    {row?.customer_profiles?.users?.full_name || "Unknown"}
                  </TableCell>

                  <TableCell>{formatDate(row?.preference_date)}</TableCell>

                  <TableCell className="font-semibold text-xs tracking-wide text-muted-foreground">
                    {row?.meal_categories?.name || "N/A"}
                  </TableCell>

                  <TableCell>{row?.addresses?.pincode || "N/A"}</TableCell>

                  <TableCell>
                    <StatusBadge
                      status={row?.is_paused ? "PAUSED" : "ACTIVE"}
                    />
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
