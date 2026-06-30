"use client";

// src/shared/components/admin/operations/ClinicWorkloadView.tsx
// Workload view rendered as an extension of the Daily Meal Roster in the admin
// Operations area (core-clinic-architecture, tasks 15.1 & 15.2;
// Requirements 13.1–13.5).
//
// Presents:
//   - "Next-Day Prep Workload": per-Clinic and per-Kitchen veg/non-veg/egg meal
//     counts for tomorrow (Req 13.1).
//   - "Workload History (last 30 days)": per-Clinic/Kitchen day buckets from
//     persisted snapshots (Req 13.2).
// Shows a clear zero-count / "no workload data available" state when empty
// (Req 13.3) and an access-denied message when the action returns `forbidden`
// (Req 13.4, 13.5).

import { useEffect, useMemo, useState, useTransition } from "react";
import { CalendarClock, History, Lock, UtensilsCrossed } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";

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

export default function ClinicWorkloadView() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [, startTransition] = useTransition();

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
              err instanceof Error ? err.message : "Failed to load workload data.",
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
    return c;
  }, [state]);

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

  const { nextDay, history } = state.data;
  const nextDayEmpty = isNextDayEmpty(state.data);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* ── Next-Day Prep Workload (Req 13.1) ───────────────────────────────── */}
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
                      <TableRow key={row.clinic_id} className="hover:bg-muted/30">
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
          </div>
        )}
      </DataTableCard>

      {/* ── Workload History — last 30 days (Req 13.2) ──────────────────────── */}
      <DataTableCard
        header={
          <SectionHeader
            title="Workload History (last 30 days)"
            icon={History}
          />
        }
        footer={
          <p className="text-sm text-muted-foreground">
            History entries:{" "}
            <span className="font-semibold text-foreground">
              {history.length}
            </span>
          </p>
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/10">
              <TableHead>Date</TableHead>
              <TableHead>Clinic</TableHead>
              <TableHead>Kitchen</TableHead>
              <TableHead className="text-right">Veg</TableHead>
              <TableHead className="text-right">Non-Veg</TableHead>
              <TableHead className="text-right">Egg</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.length === 0 ? (
              <EmptyRow
                colSpan={7}
                message="No workload data available for the last 30 days."
              />
            ) : (
              history.map((row) => (
                <TableRow
                  key={`${row.clinic_id}-${row.kitchen_id}-${row.bucket}`}
                  className="hover:bg-muted/30"
                >
                  <TableCell className="font-medium">{row.bucket}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.clinic_id}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.kitchen_id}
                  </TableCell>
                  <TableCell className="text-right">{row.veg_count}</TableCell>
                  <TableCell className="text-right">
                    {row.non_veg_count}
                  </TableCell>
                  <TableCell className="text-right">{row.egg_count}</TableCell>
                  <TableCell className="text-right font-semibold">
                    {row.veg_count + row.non_veg_count + row.egg_count}
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
