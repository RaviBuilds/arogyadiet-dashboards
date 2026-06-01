"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { AlertCircle, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import {
  getHolidaysForMonth,
  saveHolidaysForMonth,
} from "@/actions/admin-actions/holidayActions";
import { type HolidayDayEntry } from "@/lib/holidays";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

const YEAR_START = 2024;
const YEAR_END = 2030;

function getYearOptions() {
  return Array.from({ length: YEAR_END - YEAR_START + 1 }, (_, i) => YEAR_START + i);
}

export function HolidayCalendarClient() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [entries, setEntries] = useState<HolidayDayEntry[]>([]);
  const [savedEntries, setSavedEntries] = useState<HolidayDayEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [setupWarning, setSetupWarning] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const loadRequestId = useRef(0);

  useEffect(() => {
    const requestId = ++loadRequestId.current;
    let cancelled = false;

    async function loadMonth() {
      setIsLoading(true);
      setSetupWarning(null);

      const result = await getHolidaysForMonth(year, month);

      if (cancelled || requestId !== loadRequestId.current) return;

      setIsLoading(false);

      if (result.success) {
        setEntries(result.entries);
        setSavedEntries(result.entries);
        if (result.warning) {
          setSetupWarning(result.warning);
        }
      } else {
        toast.error(result.error);
        setEntries([]);
        setSavedEntries([]);
      }
    }

    loadMonth();

    return () => {
      cancelled = true;
    };
  }, [year, month]);

  const isDirty =
    entries.length !== savedEntries.length ||
    entries.some(
      (e, i) => e.name !== savedEntries[i]?.name || e.date !== savedEntries[i]?.date,
    );

  const handleNameChange = (date: string, name: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.date === date ? { ...e, name } : e)),
    );
  };

  const handleSave = () => {
    startTransition(async () => {
      const result = await saveHolidaysForMonth(year, month, entries);
      if (result.success) {
        toast.success("Holiday calendar saved successfully.");
        setSavedEntries(entries);
        setSetupWarning(null);

        const reload = await getHolidaysForMonth(year, month);
        if (reload.success) {
          setEntries(reload.entries);
          setSavedEntries(reload.entries);
          if (reload.warning) setSetupWarning(reload.warning);
        }
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Holiday Calendar</CardTitle>
          <CardDescription>
            Add holiday names for each day. Customers will see these in their
            meal planner. Holidays are informational only and do not pause
            deliveries.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {setupWarning && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{setupWarning}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label>Year</Label>
                <Select
                  value={String(year)}
                  onValueChange={(v) => setYear(Number(v))}
                  disabled={isLoading || isPending}
                >
                  <SelectTrigger className="w-[120px] bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {getYearOptions().map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Month</Label>
                <Select
                  value={String(month)}
                  onValueChange={(v) => setMonth(Number(v))}
                  disabled={isLoading || isPending}
                >
                  <SelectTrigger className="w-[160px] bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m) => (
                      <SelectItem key={m.value} value={String(m.value)}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              onClick={handleSave}
              disabled={!isDirty || isLoading || isPending || !!setupWarning}
              className="shrink-0"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Changes
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Loading days...
            </div>
          ) : entries.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              No days to display for this month.
            </div>
          ) : (
            <div className="border rounded-lg divide-y max-h-[60vh] overflow-y-auto">
              {entries.map((entry) => (
                <div
                  key={entry.date}
                  className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 p-3 sm:p-4 hover:bg-muted/30 transition-colors"
                >
                  <span className="text-sm font-medium text-muted-foreground shrink-0 sm:w-48">
                    {format(parseISO(entry.date), "EEE, d MMMM yyyy")}
                  </span>
                  <Input
                    value={entry.name}
                    onChange={(e) => handleNameChange(entry.date, e.target.value)}
                    placeholder="Holiday name (optional)"
                    disabled={isPending || !!setupWarning}
                    className="flex-1 bg-background"
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
