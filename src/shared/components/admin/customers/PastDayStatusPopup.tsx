"use client";

import { useState, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { Label } from "@/shared/components/ui/label";
import { addDaysToISODate, parseISODateString } from "@/lib/dates/ist";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface PastDayStatusEntry {
  date: string; // YYYY-MM-DD
  mealStatus: "Delivered" | "Skipped" | null;
  mealType: "VEG" | "EGG" | "CHICKEN" | null;
  deliveryAddress: "Primary" | "Secondary" | null;
}

interface PastDayStatusPopupProps {
  open: boolean;
  onConfirm: (entries: PastDayStatusEntry[]) => void;
  onCancel: () => void;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Generates an array of YYYY-MM-DD strings from startDate to endDate inclusive. */
function generateDateRange(startDate: string, endDate: string): string[] {
  // Guard against empty or invalid date strings (component may render while hidden)
  if (!startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return [];
  }
  const dates: string[] = [];
  let current = startDate;
  // Safety: max 31 iterations (30 days + 1)
  while (current <= endDate && dates.length <= 31) {
    dates.push(current);
    current = addDaysToISODate(current, 1);
  }
  return dates;
}

/** Formats YYYY-MM-DD to "Mon, Jul 1" style display label. */
function formatDateLabel(dateStr: string): string {
  const date = parseISODateString(dateStr);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Returns true if an entry is fully completed (valid). */
function isEntryComplete(entry: PastDayStatusEntry): boolean {
  if (entry.mealStatus === null) return false;
  if (entry.mealStatus === "Skipped") return true;
  // Delivered requires mealType and deliveryAddress
  return entry.mealType !== null && entry.deliveryAddress !== null;
}

/** Returns true if ALL entries are valid for submission. */
function areAllEntriesValid(entries: PastDayStatusEntry[]): boolean {
  return entries.length > 0 && entries.every(isEntryComplete);
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function PastDayStatusPopup({
  open,
  onConfirm,
  onCancel,
  startDate,
  endDate,
}: PastDayStatusPopupProps) {
  const dates = useMemo(() => generateDateRange(startDate, endDate), [startDate, endDate]);

  const [entries, setEntries] = useState<PastDayStatusEntry[]>(() =>
    dates.map((date) => ({
      date,
      mealStatus: null,
      mealType: null,
      deliveryAddress: null,
    }))
  );

  // Reset entries when dates change (re-open with different range)
  const entriesKey = `${startDate}-${endDate}`;
  const [prevKey, setPrevKey] = useState(entriesKey);
  if (entriesKey !== prevKey) {
    setPrevKey(entriesKey);
    setEntries(
      dates.map((date) => ({
        date,
        mealStatus: null,
        mealType: null,
        deliveryAddress: null,
      }))
    );
  }

  const updateEntry = useCallback(
    (index: number, updates: Partial<PastDayStatusEntry>) => {
      setEntries((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], ...updates };
        return next;
      });
    },
    []
  );

  const handleMealStatusChange = useCallback(
    (index: number, value: "Delivered" | "Skipped") => {
      if (value === "Skipped") {
        // Clear mealType and deliveryAddress when skipped
        updateEntry(index, {
          mealStatus: "Skipped",
          mealType: null,
          deliveryAddress: null,
        });
      } else {
        updateEntry(index, { mealStatus: "Delivered" });
      }
    },
    [updateEntry]
  );

  const handleMealTypeChange = useCallback(
    (index: number, value: "VEG" | "EGG" | "CHICKEN") => {
      updateEntry(index, { mealType: value });
    },
    [updateEntry]
  );

  const handleDeliveryAddressChange = useCallback(
    (index: number, value: "Primary" | "Secondary") => {
      updateEntry(index, { deliveryAddress: value });
    },
    [updateEntry]
  );

  // Find the most recently completed row (last in order) for "Fill" functionality
  const lastCompletedIndex = useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (isEntryComplete(entries[i])) return i;
    }
    return -1;
  }, [entries]);

  const hasUnfilledRows = useMemo(
    () => entries.some((e) => e.mealStatus === null),
    [entries]
  );

  const canFill = lastCompletedIndex >= 0 && hasUnfilledRows;

  const handleFillRemaining = useCallback(() => {
    if (lastCompletedIndex < 0) return;
    const source = entries[lastCompletedIndex];
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.mealStatus !== null) return entry; // Already filled, leave unchanged
        return {
          ...entry,
          mealStatus: source.mealStatus,
          mealType: source.mealType,
          deliveryAddress: source.deliveryAddress,
        };
      })
    );
  }, [entries, lastCompletedIndex]);

  const allValid = useMemo(() => areAllEntriesValid(entries), [entries]);

  const handleConfirm = () => {
    if (allValid) {
      onConfirm(entries);
    }
  };

  const handleCancel = () => {
    onCancel();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleCancel()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Past Day Delivery Status</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Record the delivery status for each past day from{" "}
            <span className="font-medium">{formatDateLabel(startDate)}</span> to{" "}
            <span className="font-medium">{formatDateLabel(endDate)}</span>.
          </p>
        </DialogHeader>

        <ScrollArea className="flex-1 max-h-[50vh] pr-3">
          <div className="space-y-3">
            {entries.map((entry, index) => (
              <DayRow
                key={entry.date}
                entry={entry}
                index={index}
                onMealStatusChange={handleMealStatusChange}
                onMealTypeChange={handleMealTypeChange}
                onDeliveryAddressChange={handleDeliveryAddressChange}
              />
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="!flex-row !justify-between items-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canFill}
            onClick={handleFillRemaining}
          >
            Fill same status for all remaining days
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={handleCancel}>
              Cancel
            </Button>
            <Button type="button" disabled={!allValid} onClick={handleConfirm}>
              Confirm
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Day Row Sub-Component ─────────────────────────────────────────────────────

interface DayRowProps {
  entry: PastDayStatusEntry;
  index: number;
  onMealStatusChange: (index: number, value: "Delivered" | "Skipped") => void;
  onMealTypeChange: (index: number, value: "VEG" | "EGG" | "CHICKEN") => void;
  onDeliveryAddressChange: (index: number, value: "Primary" | "Secondary") => void;
}

function DayRow({
  entry,
  index,
  onMealStatusChange,
  onMealTypeChange,
  onDeliveryAddressChange,
}: DayRowProps) {
  const isSkipped = entry.mealStatus === "Skipped";

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:gap-4">
      {/* Date Label */}
      <div className="min-w-[100px] shrink-0">
        <span className="text-sm font-medium">{formatDateLabel(entry.date)}</span>
      </div>

      {/* Meal Status Radio */}
      <div className="flex items-center gap-3">
        <RadioGroup
          value={entry.mealStatus ?? ""}
          onValueChange={(val) =>
            onMealStatusChange(index, val as "Delivered" | "Skipped")
          }
          className="flex flex-row gap-3"
        >
          <div className="flex items-center gap-1.5">
            <RadioGroupItem value="Delivered" id={`delivered-${index}`} />
            <Label htmlFor={`delivered-${index}`} className="text-xs cursor-pointer">
              Delivered
            </Label>
          </div>
          <div className="flex items-center gap-1.5">
            <RadioGroupItem value="Skipped" id={`skipped-${index}`} />
            <Label htmlFor={`skipped-${index}`} className="text-xs cursor-pointer">
              Skipped
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* Meal Type Select */}
      <Select
        value={entry.mealType ?? ""}
        onValueChange={(val) =>
          onMealTypeChange(index, val as "VEG" | "EGG" | "CHICKEN")
        }
        disabled={isSkipped || entry.mealStatus === null}
      >
        <SelectTrigger className="w-[110px]">
          <SelectValue placeholder="Meal type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="VEG">VEG</SelectItem>
          <SelectItem value="EGG">EGG</SelectItem>
          <SelectItem value="CHICKEN">CHICKEN</SelectItem>
        </SelectContent>
      </Select>

      {/* Delivery Address Select */}
      <Select
        value={entry.deliveryAddress ?? ""}
        onValueChange={(val) =>
          onDeliveryAddressChange(index, val as "Primary" | "Secondary")
        }
        disabled={isSkipped || entry.mealStatus === null}
      >
        <SelectTrigger className="w-[120px]">
          <SelectValue placeholder="Address" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="Primary">Primary</SelectItem>
          <SelectItem value="Secondary">Secondary</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Exported helpers for testing ──────────────────────────────────────────────

export { isEntryComplete, areAllEntriesValid, generateDateRange, formatDateLabel };
export type { PastDayStatusEntry, PastDayStatusPopupProps };
