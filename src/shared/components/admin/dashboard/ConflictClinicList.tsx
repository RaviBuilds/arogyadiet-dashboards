"use client";

// src/shared/components/admin/dashboard/ConflictClinicList.tsx
// Admin dashboard surface for the Conflict_Clinic_List (core-clinic-architecture,
// task 16.4; Requirement 22.7).
//
// Surfaces, for a selected delivery day, every Customer whose delivery-address
// order stamp differs from (or is absent against) their Primary_Address clinic.
// Each entry is a needs-attention row — the Customer is NEVER moved by appearing
// here (Req 22.8); they stay anchored to their Primary_Address clinic. Two
// reasons are shown:
//   - "mismatch"   — the delivery address resolves to a different clinic than
//                    the primary address; the order is served from the delivery
//                    clinic (Req 22.2).
//   - "unresolved" — the delivery address resolved to no clinic; the order
//                    stamp is left null and was not blocked (Req 22.5, 19.8).
//
// Data is read via the ADMIN/MASTER_ADMIN-restricted `getConflictClinicList`
// server action (Req 22.7). The selected day defaults to the next IST calendar
// day via `getISTDateString(1)`.

import { useCallback, useEffect, useState, useTransition } from "react";
import { AlertTriangle, CalendarClock, ShieldAlert } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Badge } from "@/shared/components/ui/badge";
import { Input } from "@/shared/components/ui/input";

import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";

import { getConflictClinicList } from "@/actions/admin-actions/conflictActions";
import type { ConflictClinicEntry } from "@/lib/clinic/conflict";
import { getISTDateString } from "@/lib/dates/ist";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: ConflictClinicEntry[] };

/** Renders the placeholder for an unresolved / unset clinic. */
function clinicLabel(name: string | null, id: string | null): string {
  if (name) return name;
  if (id) return id; // resolved id without a name row (shouldn't normally occur)
  return "Unassigned";
}

export default function ConflictClinicList() {
  // Default the selected delivery day to the next IST calendar day (Req 22.7).
  const [deliveryDate, setDeliveryDate] = useState<string>(() =>
    getISTDateString(1)
  );
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [, startTransition] = useTransition();

  const load = useCallback((date: string) => {
    setState({ status: "loading" });
    startTransition(() => {
      getConflictClinicList(date)
        .then((result) => {
          if (result.success) {
            setState({ status: "ready", entries: result.data });
          } else {
            setState({ status: "error", message: result.error });
          }
        })
        .catch((err: unknown) => {
          setState({
            status: "error",
            message:
              err instanceof Error
                ? err.message
                : "Failed to load the conflict clinic list.",
          });
        });
    });
  }, []);

  useEffect(() => {
    load(deliveryDate);
  }, [deliveryDate, load]);

  const entries = state.status === "ready" ? state.entries : [];

  return (
    <DataTableCard
      header={
        <SectionHeader title="Conflict Clinic List" icon={ShieldAlert} />
      }
      controls={
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-slate-500" />
          <label
            htmlFor="conflict-delivery-date"
            className="text-sm font-medium text-slate-600"
          >
            Delivery day
          </label>
          <Input
            id="conflict-delivery-date"
            type="date"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
            className="w-44"
          />
        </div>
      }
      footer={
        state.status === "ready" ? (
          <p className="text-sm text-muted-foreground">
            Needs-attention entries:{" "}
            <span className="font-semibold text-foreground">
              {entries.length}
            </span>
          </p>
        ) : undefined
      }
    >
      {state.status === "error" ? (
        <div className="flex items-center gap-3 p-6 text-amber-800">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Could not load the conflict clinic list</p>
            <p className="text-sm">{state.message}</p>
          </div>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/10">
              <TableHead>Customer</TableHead>
              <TableHead>Primary Clinic</TableHead>
              <TableHead>Delivery Clinic</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.status === "loading" ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-12 text-center text-muted-foreground"
                >
                  Loading conflict clinic list…
                </TableCell>
              </TableRow>
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <AlertTriangle className="h-6 w-6" />
                    <p>No clinic conflicts for this delivery day.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => (
                <TableRow
                  key={`${entry.customerId}-${entry.deliveryDate}`}
                  className="hover:bg-muted/30"
                >
                  <TableCell className="font-medium">
                    {entry.customerName}
                  </TableCell>
                  <TableCell>
                    {clinicLabel(entry.primaryClinicName, entry.primaryClinicId)}
                  </TableCell>
                  <TableCell>
                    {entry.reason === "unresolved" ? (
                      <span className="text-muted-foreground">Unassigned</span>
                    ) : (
                      clinicLabel(
                        entry.deliveryClinicName,
                        entry.deliveryClinicId
                      )
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        entry.reason === "unresolved" ? "destructive" : "outline"
                      }
                    >
                      {entry.reason === "unresolved" ? "Unresolved" : "Mismatch"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
    </DataTableCard>
  );
}
