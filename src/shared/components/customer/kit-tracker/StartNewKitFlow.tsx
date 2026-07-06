"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { CalendarIcon, Sparkles, Loader2 } from "lucide-react";
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
import { startNewKitAction } from "@/actions/kitLifecycleActions";
import { cn } from "@/lib/utils";
import { getISTDateString, parseISODateString } from "@/lib/dates/ist";

interface StartNewKitFlowProps {
  subscriptionId: string;
  deliveredAt: string;
  kitDurationDays: number;
}

/**
 * Displays a date picker for the customer to choose when to start their new KIT.
 * Defaults to current IST date. Disables future dates and dates before delivered_at.
 * On success, transitions to the Daily Tracker Calendar via router.refresh().
 *
 * Requirements: 6.2, 6.3, 6.4, 6.5, 6.6
 */
export function StartNewKitFlow({
  subscriptionId,
  deliveredAt,
  kitDurationDays,
}: StartNewKitFlowProps) {
  const router = useRouter();

  const todayIST = getISTDateString(0);
  const today = parseISODateString(todayIST);

  // Minimum selectable date is the delivered_at date (Req 6.3)
  const minDate = parseISODateString(deliveredAt.split("T")[0]);

  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  function handleDateSelect(date: Date | undefined) {
    if (!date) return;

    // Validate: date cannot be in the future (Req 6.3)
    if (date > today) {
      setError("Start date cannot be in the future.");
      return;
    }

    // Validate: date cannot be before delivered_at (Req 6.3)
    if (date < minDate) {
      setError("Start date cannot be before the delivery date.");
      return;
    }

    setError("");
    setSelectedDate(date);
    setPopoverOpen(false);
  }

  async function handleStartKit() {
    setIsLoading(true);
    setError("");

    const formattedDate = format(selectedDate, "yyyy-MM-dd");
    const result = await startNewKitAction(subscriptionId, formattedDate);

    if (result.success) {
      // Transition to Daily Tracker Calendar (Req 6.4)
      router.refresh();
    } else {
      // Show error, preserve selected date for retry (Req 6.6)
      setError(result.error);
      setIsLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[400px] px-4">
      <Card className="w-full max-w-md shadow-lg border-0">
        <CardHeader className="text-center pb-2 pt-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
            <Sparkles className="h-7 w-7 text-emerald-600" />
          </div>
          <CardTitle className="text-xl">Start Your New KIT</CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            Choose the date you want to begin your {kitDurationDays}-day KIT
            tracking period.
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
                  disabled={(date) => date > today || date < minDate}
                  defaultMonth={selectedDate}
                />
              </PopoverContent>
            </Popover>

            {/* Delivered on info */}
            <p className="text-xs text-muted-foreground">
              Delivered on {format(minDate, "PPP")}
            </p>

            {/* Validation error message */}
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>

          {/* Start KIT Button */}
          <Button
            className="w-full h-12 rounded-lg text-base font-semibold shadow-sm"
            onClick={handleStartKit}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting...
              </>
            ) : (
              "Start New KIT"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
