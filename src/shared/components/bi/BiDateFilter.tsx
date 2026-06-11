"use client";

import { useState } from "react";
import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subWeeks,
  subMonths,
  startOfYear,
  format,
} from "date-fns";
import { CalendarIcon, ChevronDown } from "lucide-react";
import { type DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";

export interface BiDateRange {
  from: string; // yyyy-MM-dd
  to: string; // yyyy-MM-dd
  label: string;
}

type PresetKey =
  | "current_week"
  | "last_week"
  | "current_month"
  | "last_month"
  | "last_3_months"
  | "last_6_months"
  | "current_year"
  | "custom";

interface PresetOption {
  key: PresetKey;
  label: string;
  getRange: () => { from: Date; to: Date };
}

const PRESETS: PresetOption[] = [
  {
    key: "current_week",
    label: "Current Week",
    getRange: () => ({
      from: startOfWeek(new Date(), { weekStartsOn: 1 }),
      to: new Date(),
    }),
  },
  {
    key: "last_week",
    label: "Last Week",
    getRange: () => {
      const lastWeekStart = startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 });
      return {
        from: lastWeekStart,
        to: endOfWeek(lastWeekStart, { weekStartsOn: 1 }),
      };
    },
  },
  {
    key: "current_month",
    label: "Current Month",
    getRange: () => ({
      from: startOfMonth(new Date()),
      to: new Date(),
    }),
  },
  {
    key: "last_month",
    label: "Last Month",
    getRange: () => {
      const lastMonth = subMonths(new Date(), 1);
      return {
        from: startOfMonth(lastMonth),
        to: endOfMonth(lastMonth),
      };
    },
  },
  {
    key: "last_3_months",
    label: "Last 3 Months",
    getRange: () => ({
      from: startOfMonth(subMonths(new Date(), 2)),
      to: new Date(),
    }),
  },
  {
    key: "last_6_months",
    label: "Last 6 Months",
    getRange: () => ({
      from: startOfMonth(subMonths(new Date(), 5)),
      to: new Date(),
    }),
  },
  {
    key: "current_year",
    label: "Current Year",
    getRange: () => ({
      from: startOfYear(new Date()),
      to: new Date(),
    }),
  },
];

interface BiDateFilterProps {
  value: BiDateRange;
  onChange: (range: BiDateRange) => void;
  className?: string;
}

export function BiDateFilter({ value, onChange, className }: BiDateFilterProps) {
  const [activePreset, setActivePreset] = useState<PresetKey>("current_month");
  const [customRange, setCustomRange] = useState<DateRange | undefined>(undefined);
  const [isOpen, setIsOpen] = useState(false);

  const handlePresetClick = (preset: PresetOption) => {
    setActivePreset(preset.key);
    const range = preset.getRange();
    onChange({
      from: format(range.from, "yyyy-MM-dd"),
      to: format(range.to, "yyyy-MM-dd"),
      label: preset.label,
    });
    if (preset.key !== "custom") {
      setIsOpen(false);
    }
  };

  const handleCustomSelect = (range: DateRange | undefined) => {
    setCustomRange(range);
    if (range?.from && range?.to) {
      setActivePreset("custom");
      onChange({
        from: format(range.from, "yyyy-MM-dd"),
        to: format(range.to, "yyyy-MM-dd"),
        label: `${format(range.from, "dd MMM")} – ${format(range.to, "dd MMM yyyy")}`,
      });
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "gap-2 border-slate-200 text-slate-700 hover:bg-slate-50 font-medium text-xs h-9",
            className
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 text-slate-500" />
          <span>{value.label}</span>
          <ChevronDown className="h-3 w-3 text-slate-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end" sideOffset={8}>
        <div className="flex">
          {/* Preset options sidebar */}
          <div className="border-r border-slate-200 p-2 w-fit">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-2 py-1.5 whitespace-nowrap">
              Quick Select
            </p>
            {PRESETS.map((preset) => (
              <button
                key={preset.key}
                onClick={() => handlePresetClick(preset)}
                className={cn(
                  "w-full text-left text-xs px-3 py-2 rounded-md transition-colors whitespace-nowrap",
                  activePreset === preset.key
                    ? "bg-slate-900 text-white font-medium"
                    : "text-slate-600 hover:bg-slate-100"
                )}
              >
                {preset.label}
              </button>
            ))}
            <div className="border-t border-slate-200 mt-2 pt-2">
              <button
                onClick={() => setActivePreset("custom")}
                className={cn(
                  "w-full text-left text-xs px-3 py-2 rounded-md transition-colors whitespace-nowrap",
                  activePreset === "custom"
                    ? "bg-slate-900 text-white font-medium"
                    : "text-slate-600 hover:bg-slate-100"
                )}
              >
                Custom Range
              </button>
            </div>
          </div>
          {/* Calendar for custom range */}
          <div className="p-2">
            <Calendar
              mode="range"
              defaultMonth={customRange?.from || new Date()}
              selected={customRange}
              onSelect={handleCustomSelect}
              numberOfMonths={2}
              disabled={{ after: new Date() }}
            />
            {customRange?.from && customRange?.to && (
              <div className="flex items-center justify-between px-3 py-2 border-t border-slate-200">
                <span className="text-xs text-slate-500">
                  {format(customRange.from, "dd MMM yyyy")} – {format(customRange.to, "dd MMM yyyy")}
                </span>
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 text-xs"
                  onClick={() => setIsOpen(false)}
                >
                  Apply
                </Button>
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Helper: get default date range (current month)
 */
export function getDefaultBiDateRange(): BiDateRange {
  return {
    from: format(startOfMonth(new Date()), "yyyy-MM-dd"),
    to: format(new Date(), "yyyy-MM-dd"),
    label: "Current Month",
  };
}
