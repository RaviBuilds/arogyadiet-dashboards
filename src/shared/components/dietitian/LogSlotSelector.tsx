"use client";

// src/shared/components/dietitian/LogSlotSelector.tsx
// Feature: dietitian-management — the Log_Slot picker for the Log Customer
// workflow.
//
// Replaces the free calendar in the Health_Log form with the fixed,
// cadence-driven schedule of check-ins (`src/lib/dietitian/logSlots.ts`). Each
// slot renders as a selectable chip carrying its schedule number, deadline
// date and status:
//   - logged   — a Dietitian_Log exists for the slot (green, ✓). A lock badge
//                marks a logged slot whose same-day edit window has closed.
//   - due      — past-due and not yet logged (amber). Selectable to record.
//   - upcoming — deadline still in the future (muted, disabled — a future log
//                date is rejected server-side).
//
// Purely presentational: selection and data loading are owned by
// `HealthLogEntryWorkspace`.

import { format } from "date-fns";
import { Check, Clock, Lock, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { parseISODateString } from "@/lib/dates/ist";
import type { LogSlot } from "@/lib/dietitian/logSlots";

export interface LogSlotSelectorProps {
  slots: LogSlot[];
  /** The currently open slot's date, or `null`. */
  selectedDate: string | null;
  /** Called when a selectable slot is chosen. */
  onSelect: (date: string) => void;
  /** True while the newly selected slot's data is being fetched. */
  loading?: boolean;
  disabled?: boolean;
}

function statusMeta(slot: LogSlot): {
  label: string;
  Icon: typeof Check;
  chipClass: string;
  iconClass: string;
} {
  switch (slot.status) {
    case "logged":
      return slot.editable
        ? {
            label: "Logged · editable today",
            Icon: Check,
            chipClass: "border-emerald-300 bg-emerald-50 text-emerald-900",
            iconClass: "text-emerald-600",
          }
        : {
            label: "Logged",
            Icon: Check,
            chipClass: "border-emerald-200 bg-emerald-50/60 text-emerald-800",
            iconClass: "text-emerald-500",
          };
    case "due":
      return {
        label: "Pending",
        Icon: Clock,
        chipClass: "border-amber-300 bg-amber-50 text-amber-900",
        iconClass: "text-amber-600",
      };
    case "upcoming":
      return {
        label: "Upcoming",
        Icon: Lock,
        chipClass: "border-slate-200 bg-slate-50 text-slate-400",
        iconClass: "text-slate-400",
      };
  }
}

export function LogSlotSelector({
  slots,
  selectedDate,
  onSelect,
  loading = false,
  disabled = false,
}: LogSlotSelectorProps) {
  if (slots.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-input p-6 text-center text-sm text-muted-foreground">
        No log slots are scheduled for this customer yet.
      </p>
    );
  }

  const loggedCount = slots.filter((s) => s.status === "logged").length;
  const dueCount = slots.filter((s) => s.status === "due").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-slate-900">Log slots</h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full bg-emerald-500" />
              {loggedCount} logged
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full bg-amber-500" />
              {dueCount} pending
            </span>
          </div>
        </div>
        {loading && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading slot…
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {slots.map((slot) => {
          const meta = statusMeta(slot);
          const isSelected = slot.date === selectedDate;
          const isSelectable = slot.status !== "upcoming" && !disabled;
          const { Icon } = meta;

          return (
            <button
              key={slot.date}
              type="button"
              disabled={!isSelectable}
              aria-pressed={isSelected}
              onClick={() => isSelectable && onSelect(slot.date)}
              className={cn(
                "flex min-w-30 flex-col items-start gap-1 rounded-xl border px-3 py-2 text-left transition-all",
                meta.chipClass,
                isSelectable ? "cursor-pointer hover:shadow-sm" : "cursor-not-allowed",
                isSelected && "ring-2 ring-primary ring-offset-1",
              )}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide opacity-70">
                  Slot {slot.index}
                </span>
                <Icon className={cn("size-4", meta.iconClass)} />
              </div>
              <span className="text-sm font-semibold">
                {format(parseISODateString(slot.date), "dd MMM")}
              </span>
              <span className="text-[11px] font-medium opacity-80">{meta.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
