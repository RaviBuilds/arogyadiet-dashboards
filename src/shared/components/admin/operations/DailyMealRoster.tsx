"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu';
import { Badge } from '@/shared/components/ui/badge';
import { Filter, RefreshCw, Calendar as CalendarIcon, Search, Download, ClipboardList } from "lucide-react";
import { fetchRosterData, revalidateOperationsPage } from '@/actions/admin-actions/operationsActions';
import * as XLSX from "xlsx";

const getMealLabel = (name?: string) => {
  if (!name) return "N/A";
  const upperName = name.toUpperCase();
  if (upperName.includes("CHICKEN") || upperName.includes("NON-VEGETARIAN")) return "CHICKEN";
  if (upperName.includes("EGG")) return "EGG";
  if (upperName.includes("MIXED")) return "MIXED";
  if (upperName.includes("VEGETARIAN") || upperName === "VEG") return "VEG";
  return upperName;
};

export default function DailyMealRoster({ initialData }: { initialData: any[] }) {
  const [data, setData] = useState(initialData);
  const [isLoading, setIsLoading] = useState(false);
  
  const [fromDate, setFromDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [toDate, setToDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 10);
    return d.toISOString().split("T")[0];
  });

  const [searchColumn, setSearchColumn] = useState("subscription_code");
  const [searchTerm, setSearchTerm] = useState("");
  const [mealFilter, setMealFilter] = useState<string[]>([]);
  
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 20;

  const filteredData = useMemo(() => {
    let result = data;
    
    if (searchTerm) {
      const lowerTerm = searchTerm.toLowerCase();
      result = result.filter(row => {
        if (searchColumn === "subscription_code") {
          return row.subscriptions?.subscription_code?.toLowerCase().includes(lowerTerm);
        }
        if (searchColumn === "customer_name") {
          return row.customer_profiles?.users?.full_name?.toLowerCase().includes(lowerTerm);
        }
        if (searchColumn === "pincode") {
          const pincode = row.customer_profiles?.addresses?.[0]?.pincode || row.addresses?.pincode || "";
          return pincode.toLowerCase().includes(lowerTerm);
        }
        return true;
      });
    }

    if (mealFilter.length > 0) {
      result = result.filter(row => {
        const shortCode = getMealLabel(row.meal_categories?.name);
        return mealFilter.includes(shortCode);
      });
    }

    return result;
  }, [data, searchTerm, searchColumn, mealFilter]);

  const paginatedData = filteredData.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const totalPages = Math.ceil(filteredData.length / ITEMS_PER_PAGE);

  const handleLoadRange = async () => {
    setIsLoading(true);
    await revalidateOperationsPage();
    const newData = await fetchRosterData(fromDate, toDate);
    setData(newData);
    setCurrentPage(1);
    setIsLoading(false);
  };

  const handleExportExcel = () => {
    if (filteredData.length === 0) return;

    const exportData = filteredData.map(row => ({
      "Subscription Code": row.subscriptions?.subscription_code || "N/A",
      "Customer Name": row.customer_profiles?.users?.full_name || "Unknown",
      "Delivery Date": new Date(row.preference_date).toLocaleDateString(),
      "Meal Type": getMealLabel(row.meal_categories?.name),
      "Pincode": row.customer_profiles?.addresses?.[0]?.pincode || row.addresses?.pincode || "N/A",
      "Status": row.is_paused ? "Paused" : "Active"
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Meal Roster");
    XLSX.writeFile(workbook, `Daily_Meal_Roster_${fromDate}_to_${toDate}.xlsx`);
  };

  return (
    <Card className="border-border shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* 1. Standardized Header: Title Left, Export Right */}
      <CardHeader className="pb-4 border-b flex flex-row items-center justify-between">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          Daily Meal Roster
        </CardTitle>
        <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={filteredData.length === 0} className="gap-2 text-primary hover:text-primary">
          <Download className="h-4 w-4" /> Export to Excel
        </Button>
      </CardHeader>

      <CardContent className="p-4 md:px-6">
        
        {/* 2. Standardized Filters Row */}
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 mb-5">
          <div className="flex items-center gap-2 w-full xl:w-auto">
            <Select value={searchColumn} onValueChange={setSearchColumn}>
              <SelectTrigger className="w-[180px] bg-background">
                <SelectValue placeholder="Search by..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="subscription_code">Subscription Code</SelectItem>
                <SelectItem value="customer_name">Customer Name</SelectItem>
                <SelectItem value="pincode">Pincode</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative w-full md:w-[250px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={`Search ${searchColumn.replace("_", " ")}...`}
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                className="pl-9 bg-background"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 w-full xl:w-auto flex-wrap">
            <CalendarIcon className="h-5 w-5 text-muted-foreground hidden sm:block" />
            <div className="flex items-center border rounded-md bg-background px-3 py-1.5 shadow-sm focus-within:ring-1 focus-within:ring-primary/50 transition-all">
              <span className="text-xs text-muted-foreground mr-2 font-medium uppercase tracking-wider">From</span>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="bg-transparent text-sm outline-none text-foreground cursor-pointer w-[115px]" />
            </div>
            <span className="text-muted-foreground text-sm font-medium">to</span>
            <div className="flex items-center border rounded-md bg-background px-3 py-1.5 shadow-sm focus-within:ring-1 focus-within:ring-primary/50 transition-all">
              <span className="text-xs text-muted-foreground mr-2 font-medium uppercase tracking-wider">To</span>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="bg-transparent text-sm outline-none text-foreground cursor-pointer w-[115px]" />
            </div>
            <Button variant="secondary" onClick={handleLoadRange} disabled={isLoading} className="gap-2 shadow-sm font-medium">
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              Load Range
            </Button>
          </div>
        </div>

        {/* 3. Standardized Table Wrapper */}
        <div className="rounded-md border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/10">
                <TableHead>Sub Code</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Delivery Date</TableHead>
                <TableHead>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className={`-ml-3 h-8 transition-colors ${mealFilter.length > 0 ? "bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary" : "data-[state=open]:bg-accent"}`}>
                        <span className={mealFilter.length > 0 ? "font-semibold" : ""}>Meal Type</span>
                        {mealFilter.length > 0 && (
                          <Badge variant="default" className="ml-2 h-5 px-1.5 text-[10px] rounded-sm">{mealFilter.length}</Badge>
                        )}
                        <Filter className={`ml-2 h-3.5 w-3.5 ${mealFilter.length > 0 ? "text-primary" : "text-muted-foreground"}`} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {["VEG", "MIXED", "EGG", "CHICKEN"].map((type) => (
                        <DropdownMenuCheckboxItem
                          key={type}
                          checked={mealFilter.includes(type)}
                          onCheckedChange={(checked) => {
                            setMealFilter(prev => checked ? [...prev, type] : prev.filter(t => t !== type));
                            setCurrentPage(1);
                          }}
                        >
                          {type}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableHead>
                <TableHead>Pincode</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedData.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No meal preferences found for this range.</TableCell></TableRow>
              ) : (
                paginatedData.map((row, i) => (
                  <TableRow key={row.id || i} className={row.is_paused ? "bg-primary/5 hover:bg-primary/10 border-l-4 border-l-primary" : "hover:bg-muted/30 border-l-4 border-l-transparent"}>
                    <TableCell className="font-mono font-medium">{row.subscriptions?.subscription_code || "N/A"}</TableCell>
                    <TableCell className="font-medium">{row.customer_profiles?.users?.full_name || "Unknown"}</TableCell>
                    <TableCell>{new Date(row.preference_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</TableCell>
                    <TableCell className="font-semibold text-xs tracking-wide text-muted-foreground">{getMealLabel(row.meal_categories?.name)}</TableCell>
                    <TableCell>{row.customer_profiles?.addresses?.[0]?.pincode || row.addresses?.pincode || "N/A"}</TableCell>
                    <TableCell>
                      {row.is_paused ? (
                        <Badge variant="destructive" className="bg-primary hover:bg-primary/90">Paused</Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-secondary text-secondary-foreground hover:bg-secondary/90">Active</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* 4. Standardized Pagination (No Export Button Here) */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-5 pb-1">
            <p className="text-sm text-muted-foreground">
              Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredData.length)} of {filteredData.length} entries
            </p>
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1 || isLoading}>
                Previous
              </Button>
              <div className="text-sm font-medium px-2">Page {currentPage} of {totalPages}</div>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || isLoading}>
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}