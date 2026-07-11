"use client";

// src/shared/components/admin/operations/ClinicWorkloadView.tsx
// Workload view rendered as an extension of the Daily Meal Roster in the admin
// Operations area.
//
// Presents:
//   - "Next-Day Prep Workload": per-Clinic and per-Kitchen veg/non-veg/egg meal
//     counts for tomorrow.
//   - "Workload History (last 30 days)": per-Kitchen day buckets with filters,
//     export, and a detail dialog showing per-clinic breakdown.

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  CalendarClock,
  Eye,
  History,
  Lock,
  UtensilsCrossed,
} from "lucide-react";
import * as XLSX from "xlsx";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Button } from "@/shared/components/ui/button";

import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DateRangeFilter } from "../core/DateRangeFilter";
import { ExportButton } from "../core/ActionButtons";

import {
  getClinicWorkloadView,
  type ClinicWorkloadView as ClinicWorkloadViewData,
} from "@/actions/admin-actions/workloadActions";
import { WORKLOAD_FORBIDDEN_CODE } from "@/lib/clinic/workload-access";

type LoadState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ClinicWorkloadViewData };

/** True when the next-day workload carries no clinics/kitchens or only zeros. */
function isNextDayEmpty(data: ClinicWorkloadViewData): boolean {
  const { clinics, kitchens } = data.nextDay;
  if (clinics.length === 0 && kitchens.length === 0) return true;
  const total = clinics.reduce(
    (sum, c) => sum + c.veg_count + c.non_veg_count + c.egg_count,
    0
  );
  return total === 0;
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow>
      <TableCell
        colSpan={colSpan}
        className="py-12 text-center text-muted-foreground"
      >
        {message}
      </TableCell>
    </TableRow>
  );
}

/** Grouped history row: one entry per kitchen per date. */
interface KitchenHistoryRow {
  bucket: string;
  kitchen_id: string;
  kitchen_name: string;
  veg_count: number;
  non_veg_count: number;
  egg_count: number;
  clinics: {
    clinic_id: string;
    clinic_name: string;
    veg_count: number;
    non_veg_count: number;
    egg_count: number;
  }[];
}

export default function ClinicWorkloadView() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [, startTransition] = useTransition();

  // History filters
  const [kitchenFilter, setKitchenFilter] = useState("all");
  const [historyFromDate, setHistoryFromDate] = useState("");
  const [historyToDate, setHistoryToDate] = useState("");
  const [dateFilterApplied, setDateFilterApplied] = useState(false);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState<KitchenHistoryRow | null>(
    null
  );

  useEffect(() => {
    let active = true;
    startTransition(() => {
      getClinicWorkloadView()
        .then((result) => {
          if (!active) return;
          if (result.success) {
            setState({ status: "ready", data: result.data });
          } else if (result.code === WORKLOAD_FORBIDDEN_CODE) {
            setState({ status: "forbidden" });
          } else {
            setState({ status: "error", message: result.error });
          }
        })
        .catch((err: unknown) => {
          if (!active) return;
          setState({
            status: "error",
            message:
              err instanceof Error
                ? err.message
                : "Failed to load workload data.",
          });
        });
    });
    return () => {
      active = false;
    };
  }, []);

  const totals = useMemo(() => {
    if (state.status !== "ready") return null;
    const c = state.data.nextDay.clinics.reduce(
      (acc, row) => ({
        veg: acc.veg + row.veg_count,
        nonVeg: acc.nonVeg + row.non_veg_count,
        egg: acc.egg + row.egg_count,
      }),
      { veg: 0, nonVeg: 0, egg: 0 }
    );
    const totalProducts = state.data.nextDay.kitchens.reduce((sum, k) => {
      return (
        sum +
        Object.values(k.shop_product_counts ?? {}).reduce((s, q) => s + q, 0)
      );
    }, 0);
    return { ...c, totalProducts };
  }, [state]);

  // Group history by kitchen+date and apply filters
  const { kitchenHistoryRows, uniqueKitchens } = useMemo(() => {
    if (state.status !== "ready")
      return { kitchenHistoryRows: [], uniqueKitchens: [] };

    const history = state.data.history;

    // Build grouped rows: one per (kitchen_id, bucket)
    const groupMap = new Map<string, KitchenHistoryRow>();
    for (const row of history) {
      const key = `${row.kitchen_id}\u0000${row.bucket}`;
      let group = groupMap.get(key);
      if (!group) {
        group = {
          bucket: row.bucket,
          kitchen_id: row.kitchen_id,
          kitchen_name: (row as any).kitchen_name ?? row.kitchen_id,
          veg_count: 0,
          non_veg_count: 0,
          egg_count: 0,
          clinics: [],
        };
        groupMap.set(key, group);
      }
      group.veg_count += row.veg_count;
      group.non_veg_count += row.non_veg_count;
      group.egg_count += row.egg_count;
      group.clinics.push({
        clinic_id: row.clinic_id,
        clinic_name: (row as any).clinic_name ?? row.clinic_id,
        veg_count: row.veg_count,
        non_veg_count: row.non_veg_count,
        egg_count: row.egg_count,
      });
    }

    let rows = [...groupMap.values()].sort((a, b) =>
      b.bucket.localeCompare(a.bucket)
    );

    // Extract unique kitchens for the filter dropdown
    const kitchenMap = new Map<string, string>();
    for (const r of rows) {
      kitchenMap.set(r.kitchen_id, r.kitchen_name);
    }
    const uniqueKitchens = [...kitchenMap.entries()].map(([id, name]) => ({
      id,
      name,
    }));

    // Apply kitchen filter
    if (kitchenFilter !== "all") {
      rows = rows.filter((r) => r.kitchen_id === kitchenFilter);
    }

    // Apply date range filter
    if (dateFilterApplied && historyFromDate && historyToDate) {
      rows = rows.filter(
        (r) => r.bucket >= historyFromDate && r.bucket <= historyToDate
      );
    }

    return { kitchenHistoryRows: rows, uniqueKitchens };
  }, [state, kitchenFilter, dateFilterApplied, historyFromDate, historyToDate]);

  const handleLoadHistoryRange = () => {
    setDateFilterApplied(true);
  };

  const handleExportHistory = () => {
    if (kitchenHistoryRows.length === 0) return;

    const exportData: any[] = [];
    for (const row of kitchenHistoryRows) {
      for (const clinic of row.clinics) {
        exportData.push({
          Date: row.bucket,
          Kitchen: row.kitchen_name,
          Clinic: clinic.clinic_name,
          Veg: clinic.veg_count,
          "Non-Veg": clinic.non_veg_count,
          Egg: clinic.egg_count,
          Total:
            clinic.veg_count + clinic.non_veg_count + clinic.egg_count,
        });
      }
    }

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Workload History");
    XLSX.writeFile(
      workbook,
      `Workload_History_${new Date().toISOString().split("T")[0]}.xlsx`
    );
  };

  if (state.status === "loading") {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-muted-foreground shadow-sm">
        Loading workload data…
      </div>
    );
  }

  if (state.status === "forbidden") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-800 shadow-sm">
        <Lock className="h-5 w-5 shrink-0" />
        <div>
          <p className="font-semibold">Access denied</p>
          <p className="text-sm">
            The workload view is available only to Admin and Master Admin users.
          </p>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800 shadow-sm">
        <p className="font-semibold">Could not load workload data</p>
        <p className="text-sm">{state.message}</p>
      </div>
    );
  }

  const { nextDay } = state.data;
  const nextDayEmpty = isNextDayEmpty(state.data);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* ── Next-Day Prep Workload ──────────────────────────────────────────── */}
      <DataTableCard
        header={
          <SectionHeader
            title={`Next-Day Prep Workload — ${nextDay.target_date}`}
            icon={CalendarClock}
          />
        }
        footer={
          totals ? (
            <p className="text-sm text-muted-foreground">
              Tomorrow&apos;s total meals:{" "}
              <span className="font-semibold text-foreground">
                {totals.veg + totals.nonVeg + totals.egg}
              </span>{" "}
              ({totals.veg} veg · {totals.nonVeg} non-veg · {totals.egg} egg)
              {totals.totalProducts > 0 && (
                <>
                  {" "}
                  · Products:{" "}
                  <span className="font-semibold text-foreground">
                    {totals.totalProducts}
                  </span>
                </>
              )}
            </p>
          ) : undefined
        }
      >
        {nextDayEmpty ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <UtensilsCrossed className="h-6 w-6" />
            <p>No workload data available for the next calendar day.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Per-Clinic */}
            <div>
              <h3 className="px-4 pt-4 text-sm font-semibold text-slate-700">
                Per Clinic
              </h3>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/10">
                    <TableHead>Clinic</TableHead>
                    <TableHead className="text-right">Veg</TableHead>
                    <TableHead className="text-right">Non-Veg</TableHead>
                    <TableHead className="text-right">Egg</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nextDay.clinics.length === 0 ? (
                    <EmptyRow colSpan={5} message="No clinics configured." />
                  ) : (
                    nextDay.clinics.map((row) => (
                      <TableRow
                        key={row.clinic_id}
                        className="hover:bg-muted/30"
                      >
                        <TableCell className="font-medium">
                          {row.clinic_name}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.veg_count}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.non_veg_count}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.egg_count}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {row.veg_count + row.non_veg_count + row.egg_count}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Per-Kitchen */}
            <div>
              <h3 className="px-4 pt-4 text-sm font-semibold text-slate-700">
                Per Kitchen
              </h3>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/10">
                    <TableHead>Kitchen</TableHead>
                    <TableHead className="text-right">Veg</TableHead>
                    <TableHead className="text-right">Non-Veg</TableHead>
                    <TableHead className="text-right">Egg</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nextDay.kitchens.length === 0 ? (
                    <EmptyRow colSpan={5} message="No kitchens configured." />
                  ) : (
                    nextDay.kitchens.map((row) => (
                      <TableRow
                        key={row.kitchen_id}
                        className="hover:bg-muted/30"
                      >
                        <TableCell className="font-medium">
                          {row.kitchen_name}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.veg_count}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.non_veg_count}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.egg_count}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {row.veg_count + row.non_veg_count + row.egg_count}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Shop Products per Kitchen */}
            {nextDay.kitchens.some(
              (k) => Object.keys(k.shop_product_counts ?? {}).length > 0
            ) && (
              <div>
                <h3 className="px-4 pt-4 text-sm font-semibold text-slate-700">
                  Products for Delivery
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/10">
                      <TableHead>Kitchen</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {nextDay.kitchens.flatMap((kitchen) =>
                      Object.entries(kitchen.shop_product_counts ?? {}).map(
                        ([productId, qty]) => (
                          <TableRow
                            key={`${kitchen.kitchen_id}-${productId}`}
                            className="hover:bg-muted/30"
                          >
                            <TableCell className="font-medium">
                              {kitchen.kitchen_name}
                            </TableCell>
                            <TableCell>
                              {nextDay.productNames?.[productId] ?? productId}
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              {qty}
                            </TableCell>
                          </TableRow>
                        )
                      )
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </DataTableCard>

      {/* ── Workload History (last 30 days) ─────────────────────────────────── */}
      <DataTableCard
        header={
          <SectionHeader
            title="Workload History (last 30 days)"
            icon={History}
          />
        }
        controls={
          <div className="flex flex-col xl:flex-row items-start xl:items-center gap-4 w-full">
            {/* Kitchen filter */}
            <Select value={kitchenFilter} onValueChange={setKitchenFilter}>
              <SelectTrigger className="w-[220px] border-slate-200 bg-white">
                <SelectValue placeholder="Filter by Kitchen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Kitchens</SelectItem>
                {uniqueKitchens.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="hidden xl:block w-px h-8 bg-border/60 mx-2" />

            {/* Date range filter */}
            <DateRangeFilter
              fromDate={historyFromDate}
              onFromChange={(v) => {
                setHistoryFromDate(v);
                setDateFilterApplied(false);
              }}
              toDate={historyToDate}
              onToChange={(v) => {
                setHistoryToDate(v);
                setDateFilterApplied(false);
              }}
              onLoad={handleLoadHistoryRange}
            />
          </div>
        }
        actions={
          <ExportButton
            onClick={handleExportHistory}
            disabled={kitchenHistoryRows.length === 0}
          />
        }
        footer={
          <p className="text-sm text-muted-foreground">
            History entries:{" "}
            <span className="font-semibold text-foreground">
              {kitchenHistoryRows.length}
            </span>
          </p>
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/10">
              <TableHead>Date</TableHead>
              <TableHead>Kitchen</TableHead>
              <TableHead className="text-right">Veg</TableHead>
              <TableHead className="text-right">Non-Veg</TableHead>
              <TableHead className="text-right">Egg</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-center">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {kitchenHistoryRows.length === 0 ? (
              <EmptyRow
                colSpan={7}
                message="No workload data available for the selected range."
              />
            ) : (
              kitchenHistoryRows.map((row) => (
                <TableRow
                  key={`${row.kitchen_id}-${row.bucket}`}
                  className="hover:bg-muted/30"
                >
                  <TableCell className="font-medium">{row.bucket}</TableCell>
                  <TableCell>{row.kitchen_name}</TableCell>
                  <TableCell className="text-right">{row.veg_count}</TableCell>
                  <TableCell className="text-right">
                    {row.non_veg_count}
                  </TableCell>
                  <TableCell className="text-right">{row.egg_count}</TableCell>
                  <TableCell className="text-right font-semibold">
                    {row.veg_count + row.non_veg_count + row.egg_count}
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50"
                      onClick={() => {
                        setSelectedRow(row);
                        setDialogOpen(true);
                      }}
                    >
                      <Eye className="h-4 w-4" />
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DataTableCard>

      {/* ── Clinic Detail Dialog ─────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedRow
                ? `${selectedRow.kitchen_name} — ${selectedRow.bucket}`
                : "Clinic Breakdown"}
            </DialogTitle>
          </DialogHeader>
          {selectedRow && (
            <div className="mt-2">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/10">
                    <TableHead>Clinic</TableHead>
                    <TableHead className="text-right">Veg</TableHead>
                    <TableHead className="text-right">Non-Veg</TableHead>
                    <TableHead className="text-right">Egg</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedRow.clinics.map((clinic) => (
                    <TableRow
                      key={clinic.clinic_id}
                      className="hover:bg-muted/30"
                    >
                      <TableCell className="font-medium">
                        {clinic.clinic_name}
                      </TableCell>
                      <TableCell className="text-right">
                        {clinic.veg_count}
                      </TableCell>
                      <TableCell className="text-right">
                        {clinic.non_veg_count}
                      </TableCell>
                      <TableCell className="text-right">
                        {clinic.egg_count}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {clinic.veg_count +
                          clinic.non_veg_count +
                          clinic.egg_count}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Totals row */}
                  <TableRow className="bg-muted/20 font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">
                      {selectedRow.veg_count}
                    </TableCell>
                    <TableCell className="text-right">
                      {selectedRow.non_veg_count}
                    </TableCell>
                    <TableCell className="text-right">
                      {selectedRow.egg_count}
                    </TableCell>
                    <TableCell className="text-right">
                      {selectedRow.veg_count +
                        selectedRow.non_veg_count +
                        selectedRow.egg_count}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
