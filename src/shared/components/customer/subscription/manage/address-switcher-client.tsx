"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { format, addDays, startOfDay, parseISO, isBefore, isToday as isDateToday } from "date-fns";
import { Check, Home, MapPinned, Save, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { IconChip } from "@/shared/components/customer/profile-ui/IconChip";
import { StatusPill } from "@/shared/components/customer/profile-ui/StatusPill";
import { cn } from "@/lib/utils";
import { bulkUpdateAddressPreferencesAction } from "@/actions/manageMealActions";
import { dispatchNotificationsRefresh } from "@/lib/notifications/refresh";

// --- DYNAMIC COLOR THEMES FOR ADDRESSES ---
const ADDRESS_THEMES = [
  {
    border: "border-emerald-200",
    activeBg: "bg-emerald-50",
    text: "text-emerald-700",
    icon: "text-emerald-600",
    tagBg: "bg-emerald-50 border border-emerald-200",
  },
  {
    border: "border-red-200",
    activeBg: "bg-red-50",
    text: "text-red-700",
    icon: "text-red-600",
    tagBg: "bg-red-50 border border-red-200",
  },
  {
    border: "border-blue-200",
    activeBg: "bg-blue-50",
    text: "text-blue-700",
    icon: "text-blue-600",
    tagBg: "bg-blue-50 border border-blue-200",
  },
  {
    border: "border-purple-200",
    activeBg: "bg-purple-50",
    text: "text-purple-700",
    icon: "text-purple-600",
    tagBg: "bg-purple-50 border border-purple-200",
  },
];

export function AddressSwitcherClient({
  subscriptionId,
  scheduleDays,
  initialAddressMap,
  availableAddresses,
  pausedDates = [], // Accept the new pausedDates array
}: any) {
  const router = useRouter();
  const [addressMap, setAddressMap] =
    useState<Record<string, string>>(initialAddressMap);
  const [selectedAddressId, setSelectedAddressId] = useState(
    availableAddresses[0]?.id,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    setAddressMap(initialAddressMap);
  }, [initialAddressMap]);

  const addressColors = useMemo(() => {
    const map: Record<string, (typeof ADDRESS_THEMES)[0]> = {};
    availableAddresses.forEach((addr: any, index: number) => {
      map[addr.id] = ADDRESS_THEMES[index % ADDRESS_THEMES.length];
    });
    return map;
  }, [availableAddresses]);

  const minEditableDate = useMemo(() => {
    const now = new Date();
    const daysToAdd = now.getHours() >= 17 ? 2 : 1;
    return startOfDay(addDays(now, daysToAdd));
  }, []);

  const handleDateClick = (dateStr: string) => {
    setSaveMessage(null);
    setAddressMap((prev) => ({
      ...prev,
      [dateStr]: selectedAddressId,
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    const updates = Object.entries(addressMap)
      .filter(([date, id]) => initialAddressMap[date] !== id)
      .map(([date, addressId]) => ({ date, addressId }));

    if (updates.length === 0) {
      setSaveMessage({ type: "success", text: "No changes detected." });
      setIsSaving(false);
      return;
    }

    const result = await bulkUpdateAddressPreferencesAction(
      subscriptionId,
      updates,
    );
    if (result.success) {
      setSaveMessage({
        type: "success",
        text: "Delivery addresses updated successfully!",
      });
      dispatchNotificationsRefresh();
      router.refresh();
    } else {
      setSaveMessage({ type: "error", text: "Update failed." });
    }
    setIsSaving(false);
  };

  const hasChanges =
    JSON.stringify(addressMap) !== JSON.stringify(initialAddressMap);

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Header — same IconChip + eyebrow + heading pattern as the checkout
          wizard's "Where should we deliver?" step, so switching an address
          on an existing plan feels like the same product as setting one up
          during checkout. */}
      <div>
        <div className="flex items-center gap-2.5">
          <IconChip icon={MapPinned} tone="coral" />
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-primary/80">
            Your Delivery Address
          </span>
        </div>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              Switch Delivery Address
            </h2>
            <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-slate-500">
              Select an address below, then tap the dates you want it applied
              to.
            </p>
          </div>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            size="lg"
            className="group h-12 shrink-0 rounded-full bg-emerald-600 text-base font-semibold text-white shadow-sm transition-all duration-200 hover:bg-emerald-700 hover:shadow-md active:scale-[0.98] disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" /> Save Changes
              </>
            )}
          </Button>
        </div>
      </div>

      {saveMessage && (
        <Alert
          className={cn(
            "rounded-2xl",
            saveMessage.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-red-50 border-red-200 text-red-900",
          )}
        >
          <AlertDescription className="text-sm font-medium">
            {saveMessage.text}
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-8">
        {/* Address Selection Strip — same rounded-3xl selectable card as
            OnboardingAddressCard in the checkout wizard (home icon chip,
            emerald glow + checkmark on selection). */}
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold tracking-tight text-slate-900">
              Your Addresses
            </h3>
            <p className="mt-0.5 text-sm text-slate-500">
              Tap an address, then click dates below to assign it.
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            {availableAddresses.map((addr: any) => {
              const isSelected = selectedAddressId === addr.id;

              return (
                <button
                  key={addr.id}
                  type="button"
                  onClick={() => setSelectedAddressId(addr.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    "group relative flex w-full items-start gap-3.5 rounded-3xl border bg-white p-5 text-left shadow-sm transition-all duration-300 sm:max-w-md sm:flex-1 sm:basis-[280px]",
                    "hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60",
                    isSelected
                      ? "-translate-y-0.5 border-emerald-400 bg-emerald-50/40 shadow-md ring-2 ring-emerald-200"
                      : "border-slate-200 hover:border-emerald-200",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors duration-300",
                      isSelected
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-500",
                    )}
                  >
                    <Home className="h-5 w-5" strokeWidth={1.75} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "text-sm font-semibold",
                        isSelected ? "text-emerald-800" : "text-slate-900",
                      )}
                    >
                      {addr.tag || "Address"}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-slate-500">
                      {addr.street_1}
                      {addr.city ? `, ${addr.city}` : ""}
                    </p>
                  </div>

                  {isSelected ? (
                    <span className="absolute right-4 top-4 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white duration-200 animate-in zoom-in-50">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Delivery Schedule — unified rounded-3xl card matching the meal
            planner's calendar, instead of a separately-bordered Card with
            its own header. */}
        <div className="rounded-3xl border border-slate-100 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Delivery Schedule
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Click a date to apply the selected address. Locked dates cannot
              be changed.
            </p>
          </div>
          <div className="p-5 sm:p-6">
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 lg:grid-cols-7">
              {scheduleDays.map((dateStr: string) => {
                const date = parseISO(dateStr);
                const isCutoffLocked = isBefore(
                  startOfDay(date),
                  minEditableDate,
                );
                const isPaused = pausedDates.includes(dateStr);
                const isLocked = isCutoffLocked || isPaused;
                const isTodayCell = isDateToday(date);

                const currentAddr =
                  availableAddresses.find(
                    (a: any) => a.id === addressMap[dateStr],
                  ) || availableAddresses[0];
                const theme =
                  addressColors[currentAddr?.id] || ADDRESS_THEMES[0];

                return (
                  <button
                    key={dateStr}
                    disabled={isLocked}
                    onClick={() => handleDateClick(dateStr)}
                    className={cn(
                      "group relative flex select-none flex-col items-center justify-center gap-1.5 rounded-2xl border p-2 text-center transition-all duration-200 sm:p-3",
                      isPaused
                        ? "cursor-not-allowed border-dashed border-slate-300 bg-slate-50 opacity-80"
                        : isCutoffLocked
                          ? "cursor-not-allowed border-slate-100 bg-slate-50 opacity-60"
                          : cn(
                              "bg-white hover:-translate-y-0.5 hover:shadow-md",
                              theme.border,
                            ),
                    )}
                  >
                    {isTodayCell && !isLocked && (
                      <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide text-white shadow-sm">
                        Today
                      </span>
                    )}

                    <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">
                      {format(date, "EEE")}
                    </span>
                    <span
                      className={cn(
                        "text-base font-bold sm:text-lg",
                        isLocked ? "text-slate-400" : theme.text,
                      )}
                    >
                      {format(date, "dd")}
                    </span>

                    <div className="w-full px-0.5">
                      {isPaused ? (
                        <StatusPill
                          tone="slate"
                          className="w-full justify-center border-dashed px-2 py-0.5 text-[0.6rem]"
                        >
                          Paused
                        </StatusPill>
                      ) : (
                        <span
                          className={cn(
                            "block w-full truncate rounded-full border px-2 py-0.5 text-[0.6rem] font-semibold",
                            isCutoffLocked
                              ? "border-slate-200 bg-slate-100 text-slate-500"
                              : cn(theme.tagBg, theme.text),
                          )}
                        >
                          {currentAddr?.tag || "Default"}
                        </span>
                      )}
                    </div>

                    {isCutoffLocked && !isPaused && (
                      <div className="absolute right-1 top-1">
                        <AlertCircle className="h-2.5 w-2.5 text-slate-400" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
