"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { format, parseISO } from "date-fns";
import { CalendarIcon, Package, Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { confirmReceivedDateAction } from "@/actions/kitTrackerActions";
import { cn } from "@/lib/utils";

interface PackageReceiptScreenProps {
  subscriptionId: string;
  subscriptionStartDate?: string; // Not used for KIT — received date IS the start date
  initialReceivedDate: string | null;
  hasAnyDailyLog: boolean;
  todayServerDate: string;
}

/**
 * Client Component: Confirms the date the customer received their KIT package.
 * For KIT subscriptions, the received date becomes the tracker start date.
 * Only validates that the date is not in the future.
 * On success, triggers router.refresh() to transition to Daily_Tracker_Calendar.
 *
 * Requirements: 2.1, 2.2, 2.5, 2.6, 2.9
 */
export function PackageReceiptScreen({
  subscriptionId,
  initialReceivedDate,
  hasAnyDailyLog,
  todayServerDate,
}: PackageReceiptScreenProps) {
  const router = useRouter();

  // Guard: if daily logs exist, the received date is locked (Req 2.8)
  if (hasAnyDailyLog) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-2">
          <p className="text-lg font-medium text-muted-foreground">
            Received Date Locked
          </p>
          <p className="text-sm text-muted-foreground">
            The received date cannot be changed because daily logs have already
            been recorded.
          </p>
        </div>
      </div>
    );
  }

  const today = parseISO(todayServerDate);

  const defaultDate = initialReceivedDate
    ? parseISO(initialReceivedDate)
    : today;

  const [selectedDate, setSelectedDate] = useState<Date>(defaultDate);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  function handleDateSelect(date: Date | undefined) {
    if (!date) return;

    // Only validate: date cannot be in the future
    if (date > today) {
      setError("The received date cannot be in the future.");
      return;
    }

    // Valid date selected
    setError("");
    setSelectedDate(date);
    setPopoverOpen(false);
  }

  async function handleConfirm() {
    setIsLoading(true);
    setError("");

    const formattedDate = format(selectedDate, "yyyy-MM-dd");
    const result = await confirmReceivedDateAction(subscriptionId, formattedDate);

    if (result.success) {
      // Transition to Daily_Tracker_Calendar via server component re-render (Req 2.9)
      router.refresh();
    } else {
      // Show error, preserve selected date for retry (Req 2.6)
      setError(result.error);
      setIsLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[400px] px-4">
      <Card className="w-full max-w-md shadow-lg border-0">
        <CardHeader className="text-center pb-2 pt-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Package className="h-7 w-7 text-primary" />
          </div>
          <CardTitle className="text-xl">Confirm Package Receipt</CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            Select the date you received your KIT package
          </p>
        </CardHeader>
        <CardContent className="space-y-6 px-6 pb-8 pt-4">
          {/* Date Picker */}
          <div className="space-y-2">
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full h-12 justify-start text-left font-normal rounded-lg",
                    !selectedDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-3 h-4 w-4" />
                  {selectedDate ? (
                    format(selectedDate, "PPP")
                  ) : (
                    <span>Pick a date</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="center">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={handleDateSelect}
                  disabled={(date) => date > today}
                  defaultMonth={selectedDate}
                />
              </PopoverContent>
            </Popover>

            {/* Validation error message */}
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>

          {/* Confirm Button */}
          <Button
            className="w-full h-12 rounded-lg text-base font-semibold shadow-sm"
            onClick={handleConfirm}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Confirming...
              </>
            ) : (
              "Mark KIT Received"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
