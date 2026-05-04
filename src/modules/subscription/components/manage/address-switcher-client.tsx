"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { format, addDays, startOfDay, parseISO, isBefore } from "date-fns";
import { MapPin, Save, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { cn } from "@/lib/utils";
import { bulkUpdateAddressPreferencesAction } from "@/actions/manageMealActions";

// --- DYNAMIC COLOR THEMES FOR ADDRESSES ---
const ADDRESS_THEMES = [
  {
    border: "border-green-500",
    activeBg: "bg-green-50",
    text: "text-green-700",
    icon: "text-green-500",
    tagBg: "bg-green-100",
  },
  {
    border: "border-red-500",
    activeBg: "bg-red-50",
    text: "text-red-700",
    icon: "text-red-500",
    tagBg: "bg-red-100",
  },
  {
    border: "border-blue-500",
    activeBg: "bg-blue-50",
    text: "text-blue-700",
    icon: "text-blue-500",
    tagBg: "bg-blue-100",
  },
  {
    border: "border-purple-500",
    activeBg: "bg-purple-50",
    text: "text-purple-700",
    icon: "text-purple-500",
    tagBg: "bg-purple-100",
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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 border rounded-xl shadow-sm sticky top-[60px] z-10">
        <div>
          <h2 className="text-xl font-bold text-zinc-900">
            Switch Delivery Address
          </h2>
          <p className="text-xs md:text-sm text-muted-foreground flex items-center gap-1 mt-1">
            <AlertCircle className="h-3 w-3 shrink-0" /> Select an address
            below, then click dates to apply.
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          className="w-full sm:w-auto font-bold bg-primary text-white"
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
              ? "bg-green-50 border-green-200 text-green-900"
              : "bg-red-50 border-red-200 text-red-900"
          }
        >
          <AlertDescription className="font-medium">
            {saveMessage.text}
          </AlertDescription>
        </Alert>
      )}

      {/* Address Selection Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
        {availableAddresses.map((addr: any) => {
          const theme = addressColors[addr.id];
          const isSelected = selectedAddressId === addr.id;

          return (
            <Card
              key={addr.id}
              onClick={() => setSelectedAddressId(addr.id)}
              className={cn(
                "cursor-pointer border-2 transition-all select-none",
                isSelected
                  ? cn(theme.border, theme.activeBg)
                  : "border-zinc-200 hover:border-zinc-300 bg-white",
              )}
            >
              <CardContent className="p-3 md:p-4 flex gap-3 items-center">
                <MapPin
                  className={cn(
                    "h-5 w-5 shrink-0",
                    isSelected ? theme.icon : "text-muted-foreground",
                  )}
                />
                <div className="overflow-hidden">
                  <p
                    className={cn(
                      "font-bold text-sm",
                      isSelected ? theme.text : "text-zinc-700",
                    )}
                  >
                    {addr.tag}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {addr.street_1}, {addr.city}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Calendar Grid */}
      <div className="bg-white rounded-2xl border p-4 md:p-6 shadow-sm">
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-2 md:gap-3">
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
                  "flex flex-col items-center justify-center p-2 md:p-3 rounded-xl border-2 transition-all text-center relative overflow-hidden select-none",
                  isPaused
                    ? "bg-zinc-50 border-zinc-300 border-dashed opacity-80 cursor-not-allowed" // Specific dashed styling for paused dates
                    : isCutoffLocked
                      ? "bg-zinc-50 border-zinc-200 opacity-60 grayscale cursor-not-allowed"
                      : cn(
                          "bg-white hover:shadow-md hover:-translate-y-0.5",
                          theme.border,
                        ),
                )}
              >
                <span className="text-[9px] md:text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                  {format(date, "EEE")}
                </span>
                <span
                  className={cn(
                    "text-base md:text-xl font-black mt-0.5 mb-1 md:mb-2",
                    isLocked ? "text-zinc-500" : theme.text,
                  )}
                >
                  {format(date, "dd")}
                </span>

                <div className="w-full px-1">
                  {isPaused ? (
                    // Paused Badge
                    <span className="text-[8px] md:text-[9px] font-bold px-1.5 py-0.5 md:py-1 rounded flex items-center justify-center truncate bg-zinc-200 text-zinc-600 border border-zinc-300 border-dashed">
                      Paused
                    </span>
                  ) : (
                    // Address Tag Badge
                    <span
                      className={cn(
                        "text-[8px] md:text-[9px] font-bold px-1.5 py-0.5 md:py-1 rounded flex items-center justify-center truncate",
                        isCutoffLocked
                          ? "bg-zinc-200 text-zinc-500"
                          : cn(theme.tagBg, theme.text),
                      )}
                    >
                      {currentAddr?.tag || "Default"}
                    </span>
                  )}
                </div>

                {isCutoffLocked && !isPaused && (
                  <div className="absolute top-1 right-1">
                    <AlertCircle className="h-2.5 w-2.5 text-zinc-400" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
