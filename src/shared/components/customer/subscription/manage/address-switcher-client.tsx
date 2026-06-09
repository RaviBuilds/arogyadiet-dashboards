"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { format, addDays, startOfDay, parseISO, isBefore } from "date-fns";
import { MapPin, Save, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
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
    <div className="space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-4">
      {/* Top Banner & Save Button */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 bg-white border border-slate-200 rounded-xl shadow-sm p-6 sticky top-[60px] z-10">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Switch Delivery Address
          </h2>
          <p className="text-sm text-slate-500 flex items-center gap-1.5 mt-1">
            <AlertCircle className="h-3 w-3 shrink-0" /> Select an address
            below, then click dates to apply.
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          className="w-full sm:w-auto transition-all duration-200"
        >
          {isSaving ? (
            <Loader2 className="animate-spin h-4 w-4 mr-2" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Address Changes
        </Button>
      </div>

      {saveMessage && (
        <Alert
          className={
            saveMessage.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-red-50 border-red-200 text-red-900"
          }
        >
          <AlertDescription className="text-sm font-medium">
            {saveMessage.text}
          </AlertDescription>
        </Alert>
      )}

      {/* Address Selection Strip */}
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900 tracking-tight">
            Your Addresses
          </h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Tap an address, then click dates below to assign it.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {availableAddresses.map((addr: any) => {
            const theme = addressColors[addr.id];
            const isSelected = selectedAddressId === addr.id;

            return (
              <Card
                key={addr.id}
                onClick={() => setSelectedAddressId(addr.id)}
                className={cn(
                  "rounded-xl border shadow-sm transition-all duration-200 select-none cursor-pointer",
                  isSelected
                    ? cn(theme.border, theme.activeBg, "ring-2 ring-offset-1")
                    : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-md hover:bg-slate-50/50",
                )}
              >
                <CardContent className="p-6 flex gap-4 items-center">
                  <MapPin
                    className={cn(
                      "h-5 w-5 shrink-0",
                      isSelected ? theme.icon : "text-slate-400",
                    )}
                  />
                  <div className="overflow-hidden flex-1 min-w-0">
                    <p
                      className={cn(
                        "font-semibold text-sm",
                        isSelected ? theme.text : "text-slate-700",
                      )}
                    >
                      {addr.tag}
                    </p>
                    <p className="text-sm text-slate-500 truncate">
                      {addr.street_1}, {addr.city}
                    </p>
                  </div>
                  {isSelected && (
                    <Badge
                      variant="outline"
                      className="ml-auto shrink-0 border-emerald-200 bg-emerald-50 text-emerald-700"
                    >
                      Selected
                    </Badge>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Calendar Grid */}
      <Card className="border border-slate-200 bg-white rounded-xl shadow-sm overflow-hidden">
        <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
          <CardTitle className="text-base font-semibold text-slate-900">
            Delivery Schedule
          </CardTitle>
          <p className="text-sm text-slate-500 mt-0.5">
            Click a date to apply the selected address. Locked dates cannot be
            changed.
          </p>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-3 md:gap-4">
            {scheduleDays.map((dateStr: string) => {
              const date = parseISO(dateStr);
              const isCutoffLocked = isBefore(startOfDay(date), minEditableDate);
              const isPaused = pausedDates.includes(dateStr); // Check if paused
              const isLocked = isCutoffLocked || isPaused; // Lock if past cutoff OR paused

              const currentAddr =
                availableAddresses.find(
                  (a: any) => a.id === addressMap[dateStr],
                ) || availableAddresses[0];
              const theme = addressColors[currentAddr?.id] || ADDRESS_THEMES[0];

              return (
                <button
                  key={dateStr}
                  disabled={isLocked}
                  onClick={() => handleDateClick(dateStr)}
                  className={cn(
                    "flex flex-col items-center justify-center p-2 md:p-3 rounded-xl border-2 transition-all duration-200 text-center relative overflow-hidden select-none",
                    isPaused
                      ? "bg-slate-50 border-slate-300 border-dashed opacity-80 cursor-not-allowed"
                      : isCutoffLocked
                        ? "bg-slate-50 border-slate-200 opacity-60 grayscale cursor-not-allowed"
                        : cn(
                            "bg-white hover:bg-slate-50 hover:shadow-sm",
                            theme.border,
                          ),
                  )}
                >
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                    {format(date, "EEE")}
                  </span>
                  <span
                    className={cn(
                      "text-lg md:text-xl font-semibold mt-0.5 mb-1 md:mb-2",
                      isLocked ? "text-slate-500" : theme.text,
                    )}
                  >
                    {format(date, "dd")}
                  </span>

                  <div className="w-full px-1">
                    {isPaused ? (
                      <Badge
                        variant="outline"
                        className="w-full justify-center rounded-full border-slate-300 bg-slate-100 text-slate-600 text-[10px] font-medium border-dashed"
                      >
                        Paused
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className={cn(
                          "w-full justify-center rounded-full text-[10px] font-medium truncate",
                          isCutoffLocked
                            ? "bg-slate-100 text-slate-500 border-slate-200"
                            : cn(theme.tagBg, theme.text),
                        )}
                      >
                        {currentAddr?.tag || "Default"}
                      </Badge>
                    )}
                  </div>

                  {isCutoffLocked && !isPaused && (
                    <div className="absolute top-1 right-1">
                      <AlertCircle className="h-2.5 w-2.5 text-slate-400" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
