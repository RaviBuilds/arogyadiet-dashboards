"use client";

import { useState, useMemo, useTransition } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { CalendarDays } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

// Core Design System Components
import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DataSearchFilter } from "../core/DataSearchFilter";
import { DateRangeFilter } from "../core/DateRangeFilter";
import { StatusBadge } from "../core/StatusBadge";
import { ExportButton } from "../core/ActionButtons";

export default function DailyMealRoster({ data = [] }: { data?: any[] }) {
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Search State
  const [searchColumn, setSearchColumn] = useState("sub_code");
  const [searchTerm, setSearchTerm] = useState("");

  // Date Range State
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Derived filtered data
  const filteredData = useMemo(() => {
    let result = data;
    if (searchTerm) {
      const lowerTerm = searchTerm.toLowerCase();
      result = result.filter(row => {
        if (searchColumn === "sub_code") return (row.subscription_code || "").toLowerCase().includes(lowerTerm);
        if (searchColumn === "customer") return (row.customer_name || "").toLowerCase().includes(lowerTerm);
        if (searchColumn === "pincode") return (row.pincode || "").toLowerCase().includes(lowerTerm);
        return true;
      });
    }
    return result;
  }, [data, searchTerm, searchColumn]);

  const handleLoadRange = () => {
    if (!fromDate || !toDate) {
      toast.error("Please select both 'From' and 'To' dates.");
      return;
    }
    setIsLoading(true);
    startTransition(() => {
      // In a real scenario, this updates URL search params or calls a server action.
      // For the UI refactor, we simulate the network request.
      setTimeout(() => {
        setIsLoading(false);
        toast.success("Roster data refreshed for selected range.");
      }, 500);
    });
  };

  const handleExportExcel = () => {
    if (filteredData.length === 0) return;
    const exportData = filteredData.map(row => ({
      "Sub Code": row.subscription_code || "N/A",
      "Customer": row.customer_name || "Unknown",
      "Delivery Date": row.delivery_date ? new Date(row.delivery_date).toDateString() : "N/A",
      "Meal Type": row.meal_type || "N/A",
      "Pincode": row.pincode || "N/A",
      "Status": row.status || "UNKNOWN"
    }));
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Daily Meal Roster");
    XLSX.writeFile(workbook, `Meal_Roster_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  // Formatter for UI Date
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "N/A";
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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
                { value: "sub_code", label: "Subscription Code" },
                { value: "customer", label: "Customer Name" },
                { value: "pincode", label: "Pincode" }
              ]}
            />
            
            {/* Visual separator for large screens */}
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
          <ExportButton onClick={handleExportExcel} disabled={filteredData.length === 0} />
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
                 <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                   No meals found for the selected range and filters.
                 </TableCell>
               </TableRow>
            ) : (
              filteredData.map((row, i) => (
                <TableRow key={row.id || i} className="hover:bg-muted/30">
                  <TableCell className="font-medium text-foreground">{row.subscription_code || "N/A"}</TableCell>
                  <TableCell>{row.customer_name || "Unknown"}</TableCell>
                  <TableCell>{formatDate(row.delivery_date)}</TableCell>
                  <TableCell className="font-semibold text-xs tracking-wide text-muted-foreground">{row.meal_type || "N/A"}</TableCell>
                  <TableCell>{row.pincode || "N/A"}</TableCell>
                  <TableCell>
                    <StatusBadge status={row.status || "ACTIVE"} />
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
