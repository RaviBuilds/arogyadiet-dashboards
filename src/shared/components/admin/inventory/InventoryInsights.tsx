"use client";

import { useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays, format } from "date-fns";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronsUpDown,
  Clock,
  Package,
  PackageOpen,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";

import type {
  InventoryCatalogProduct,
  InventoryMetrics as InventoryMetricsData,
} from "@/lib/inventory/product-schema";
import { cn } from "@/lib/utils";
import { Badge } from "@/shared/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
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

export type InsightTab = "ALL" | "LOW_STOCK" | "EXPIRING";

type SortDir = "asc" | "desc";

interface SortState {
  key: string;
  dir: SortDir;
}

interface InventoryInsightsProps {
  products: InventoryCatalogProduct[];
  metrics: InventoryMetricsData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab: InsightTab;
  onTabChange: (tab: InsightTab) => void;
}

function formatQty(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(value);
}

function compareValues(
  a: string | number,
  b: string | number,
  dir: SortDir,
): number {
  let result: number;
  if (typeof a === "number" && typeof b === "number") {
    result = a - b;
  } else {
    result = String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }
  return dir === "asc" ? result : -result;
}

function SortableHeader({
  label,
  columnKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  columnKey: string;
  sort: SortState | null;
  onSort: (key: string) => void;
  align?: "left" | "right";
}) {
  const isActive = sort?.key === columnKey;
  const Icon = !isActive
    ? ChevronsUpDown
    : sort?.dir === "asc"
      ? ArrowUp
      : ArrowDown;

  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className={cn(
          "group inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide transition-colors hover:text-foreground",
          align === "right" && "flex-row-reverse",
          isActive ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <Icon
          className={cn(
            "size-3.5 shrink-0 transition-opacity",
            isActive
              ? "opacity-100"
              : "opacity-40 group-hover:opacity-70",
          )}
        />
      </button>
    </TableHead>
  );
}

function EmptyState({
  icon: Icon,
  message,
}: {
  icon: LucideIcon;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <Icon className="mb-3 size-10 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export default function InventoryInsights({
  products,
  metrics,
  open,
  onOpenChange,
  activeTab,
  onTabChange,
}: InventoryInsightsProps) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [sort, setSort] = useState<SortState | null>(null);

  // Reset controls whenever the active tab changes for a clean view.
  useEffect(() => {
    setSearch("");
    setCategoryFilter("ALL");
    setTypeFilter("ALL");
    setSort(null);
  }, [activeTab]);

  const query = search.trim().toLowerCase();

  const handleSort = (key: string) => {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  const categories = useMemo(
    () => [...new Set(products.map((product) => product.category))].sort(),
    [products],
  );

  // --- All Items rows ---
  const allRows = useMemo(() => {
    const rows = products.filter((product) => {
      const matchesCategory =
        categoryFilter === "ALL" || product.category === categoryFilter;
      const matchesType = typeFilter === "ALL" || product.type === typeFilter;
      const matchesSearch =
        !query ||
        product.name.toLowerCase().includes(query) ||
        product.category.toLowerCase().includes(query);
      return matchesCategory && matchesType && matchesSearch;
    });

    const accessor: Record<string, (p: InventoryCatalogProduct) => string | number> =
      {
        name: (p) => p.name,
        category: (p) => p.category,
        type: (p) => p.type,
        totalStock: (p) => p.totalStock,
        activeLots: (p) => p.activeLots.length,
      };

    if (sort && accessor[sort.key]) {
      return [...rows].sort((a, b) =>
        compareValues(accessor[sort.key](a), accessor[sort.key](b), sort.dir),
      );
    }
    // Default: category then name
    return [...rows].sort((a, b) => {
      const categoryCompare = a.category.localeCompare(b.category);
      return categoryCompare !== 0
        ? categoryCompare
        : a.name.localeCompare(b.name);
    });
  }, [products, categoryFilter, typeFilter, query, sort]);

  // --- Low stock rows ---
  const lowStockRows = useMemo(() => {
    const rows = metrics.lowStockAlerts
      .filter(
        (alert) => !query || alert.productName.toLowerCase().includes(query),
      )
      .map((alert) => ({
        ...alert,
        shortfall: Math.max(alert.minStockThreshold - alert.totalQuantity, 0),
      }));

    const accessor: Record<string, (r: (typeof rows)[number]) => string | number> =
      {
        productName: (r) => r.productName,
        totalQuantity: (r) => r.totalQuantity,
        minStockThreshold: (r) => r.minStockThreshold,
        shortfall: (r) => r.shortfall,
      };

    if (sort && accessor[sort.key]) {
      return [...rows].sort((a, b) =>
        compareValues(accessor[sort.key](a), accessor[sort.key](b), sort.dir),
      );
    }
    return rows;
  }, [metrics.lowStockAlerts, query, sort]);

  // --- Expiring rows ---
  const expiringRows = useMemo(() => {
    const now = new Date();
    const rows = metrics.expiringLots
      .filter(
        (lot) =>
          !query ||
          lot.productName.toLowerCase().includes(query) ||
          lot.batchNumber.toLowerCase().includes(query),
      )
      .map((lot) => ({
        ...lot,
        daysLeft: differenceInCalendarDays(new Date(lot.expiryDate), now),
        expiryTime: new Date(lot.expiryDate).getTime(),
      }));

    const accessor: Record<string, (r: (typeof rows)[number]) => string | number> =
      {
        productName: (r) => r.productName,
        batchNumber: (r) => r.batchNumber,
        quantityRemaining: (r) => r.quantityRemaining,
        expiryDate: (r) => r.expiryTime,
        daysLeft: (r) => r.daysLeft,
      };

    if (sort && accessor[sort.key]) {
      return [...rows].sort((a, b) =>
        compareValues(accessor[sort.key](a), accessor[sort.key](b), sort.dir),
      );
    }
    return rows;
  }, [metrics.expiringLots, query, sort]);

  const lowStockCount = metrics.lowStockAlerts.length;
  const expiringCount = metrics.expiringLots.length;

  const tabs: {
    id: InsightTab;
    label: string;
    icon: LucideIcon;
    count: number;
    activeClass: string;
    countClass: string;
  }[] = [
    {
      id: "ALL",
      label: "All Items",
      icon: Package,
      count: metrics.totalUniqueItems,
      activeClass: "border-blue-300 bg-blue-50 text-blue-700",
      countClass: "bg-blue-100 text-blue-700",
    },
    {
      id: "LOW_STOCK",
      label: "Low Stock",
      icon: AlertTriangle,
      count: lowStockCount,
      activeClass: "border-red-300 bg-red-50 text-red-700",
      countClass: "bg-red-100 text-red-700",
    },
    {
      id: "EXPIRING",
      label: "Expiring Soon",
      icon: Clock,
      count: expiringCount,
      activeClass: "border-amber-300 bg-amber-50 text-amber-700",
      countClass: "bg-amber-100 text-amber-700",
    },
  ];

  const activeMeta = tabs.find((tab) => tab.id === activeTab);
  const visibleCount =
    activeTab === "ALL"
      ? allRows.length
      : activeTab === "LOW_STOCK"
        ? lowStockRows.length
        : expiringRows.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        showCloseButton
      >
        <DialogHeader className="border-b p-5 pr-12">
          <DialogTitle className="text-base font-bold">
            Inventory Insights
          </DialogTitle>
          <DialogDescription>
            Detailed view of items, low stock, and expiring batches.
          </DialogDescription>
          <div className="mt-3 flex flex-wrap gap-2">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTabChange(tab.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? tab.activeClass
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
                  )}
                >
                  <Icon className="size-4" />
                  {tab.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-xs font-semibold",
                      isActive ? tab.countClass : "bg-slate-100 text-slate-600",
                    )}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </DialogHeader>

        {/* Toolbar: search + filters */}
        <div className="flex flex-col gap-2 border-b bg-muted/30 p-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={
                activeTab === "EXPIRING"
                  ? "Search product or batch..."
                  : "Search product..."
              }
              className="h-9 bg-white pl-9 pr-9"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>

          {activeTab === "ALL" ? (
            <div className="flex gap-2">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-9 w-[150px] bg-white" size="sm">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Categories</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-9 w-[140px] bg-white" size="sm">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Types</SelectItem>
                  <SelectItem value="RAW_MATERIAL">Raw Material</SelectItem>
                  <SelectItem value="FINISHED_GOOD">Finished Good</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {activeTab === "ALL" &&
            (allRows.length === 0 ? (
              <EmptyState
                icon={query || categoryFilter !== "ALL" || typeFilter !== "ALL" ? Search : PackageOpen}
                message={
                  query || categoryFilter !== "ALL" || typeFilter !== "ALL"
                    ? "No items match your filters."
                    : "No products registered yet."
                }
              />
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-white">
                  <TableRow>
                    <SortableHeader
                      label="Product"
                      columnKey="name"
                      sort={sort}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Category"
                      columnKey="category"
                      sort={sort}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Type"
                      columnKey="type"
                      sort={sort}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="In Stock"
                      columnKey="totalStock"
                      sort={sort}
                      onSort={handleSort}
                      align="right"
                    />
                    <SortableHeader
                      label="Active Lots"
                      columnKey="activeLots"
                      sort={sort}
                      onSort={handleSort}
                      align="right"
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allRows.map((product) => {
                    const isLow =
                      product.totalStock <= product.minStockThreshold;
                    return (
                      <TableRow key={product.id}>
                        <TableCell className="font-medium text-foreground">
                          {product.name}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {product.category}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {product.type === "RAW_MATERIAL"
                              ? "Raw Material"
                              : "Finished Good"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={cn(
                              "font-semibold tabular-nums",
                              isLow ? "text-destructive" : "text-foreground",
                            )}
                          >
                            {formatQty(product.totalStock)}
                          </span>{" "}
                          <span className="text-xs text-muted-foreground">
                            {product.baseUom}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {product.activeLots.length}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ))}

          {activeTab === "LOW_STOCK" &&
            (lowStockCount === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                message="All products are above their minimum stock threshold."
              />
            ) : lowStockRows.length === 0 ? (
              <EmptyState icon={Search} message="No items match your search." />
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-white">
                  <TableRow>
                    <SortableHeader
                      label="Product"
                      columnKey="productName"
                      sort={sort}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Current Stock"
                      columnKey="totalQuantity"
                      sort={sort}
                      onSort={handleSort}
                      align="right"
                    />
                    <SortableHeader
                      label="Min Threshold"
                      columnKey="minStockThreshold"
                      sort={sort}
                      onSort={handleSort}
                      align="right"
                    />
                    <SortableHeader
                      label="Shortfall"
                      columnKey="shortfall"
                      sort={sort}
                      onSort={handleSort}
                      align="right"
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lowStockRows.map((alert) => {
                    const isOut = alert.totalQuantity <= 0;
                    return (
                      <TableRow key={alert.productId}>
                        <TableCell className="font-medium text-foreground">
                          <div className="flex items-center gap-2">
                            {alert.productName}
                            {isOut ? (
                              <Badge variant="destructive">Out of stock</Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-destructive">
                          {formatQty(alert.totalQuantity)}{" "}
                          <span className="text-xs font-normal text-muted-foreground">
                            {alert.baseUom}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatQty(alert.minStockThreshold)} {alert.baseUom}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums text-amber-600">
                          {formatQty(alert.shortfall)} {alert.baseUom}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ))}

          {activeTab === "EXPIRING" &&
            (expiringCount === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                message="No batches are expiring within the next 14 days."
              />
            ) : expiringRows.length === 0 ? (
              <EmptyState icon={Search} message="No batches match your search." />
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-white">
                  <TableRow>
                    <SortableHeader
                      label="Product"
                      columnKey="productName"
                      sort={sort}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Batch"
                      columnKey="batchNumber"
                      sort={sort}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Quantity"
                      columnKey="quantityRemaining"
                      sort={sort}
                      onSort={handleSort}
                      align="right"
                    />
                    <SortableHeader
                      label="Expiry Date"
                      columnKey="expiryDate"
                      sort={sort}
                      onSort={handleSort}
                      align="right"
                    />
                    <SortableHeader
                      label="Days Left"
                      columnKey="daysLeft"
                      sort={sort}
                      onSort={handleSort}
                      align="right"
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expiringRows.map((lot) => {
                    const isUrgent = lot.daysLeft <= 3;
                    return (
                      <TableRow key={lot.lotId}>
                        <TableCell className="font-medium text-foreground">
                          {lot.productName}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {lot.batchNumber}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-foreground">
                          {formatQty(lot.quantityRemaining)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {format(new Date(lot.expiryDate), "dd MMM yyyy")}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant={isUrgent ? "destructive" : "outline"}
                            className={cn(!isUrgent && "text-amber-600")}
                          >
                            {lot.daysLeft <= 0
                              ? "Today"
                              : `${lot.daysLeft} day${lot.daysLeft === 1 ? "" : "s"}`}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ))}
        </div>

        {activeMeta ? (
          <div className="flex items-center justify-between border-t bg-muted/40 px-5 py-3 text-xs text-muted-foreground">
            <span>
              Showing <span className="font-semibold">{visibleCount}</span> of{" "}
              {activeMeta.count} {activeMeta.label.toLowerCase()}
            </span>
            {activeTab === "EXPIRING" ? (
              <span>Window: next 14 days</span>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
