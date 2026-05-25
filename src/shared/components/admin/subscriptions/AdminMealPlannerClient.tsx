"use client";

import { useState, useMemo } from "react";
import { format, addDays, startOfDay, parseISO, isBefore } from "date-fns";
import { Save, Loader2, AlertCircle, Utensils, Ban, CheckCircle2, XCircle, ShoppingBag } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { adminBulkUpdateMealPreferences } from "@/actions/admin-actions/adminMealActions";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function AdminMealPlannerClient({
  subscriptionId,
  dailyPrefs,
  mealCategories,
  customerDietaryPreference,
  deliveryOrders,
}: any) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);

  // Helper to find the default category based on customer preference
  const defaultCategory = useMemo(() => {
    const prefLower = (customerDietaryPreference || "Veg").toLowerCase();
    return mealCategories.find((cat: any) => {
      const code = cat.code?.toUpperCase();
      const name = cat.name?.toLowerCase() || "";
      if (prefLower === "veg") return code === "VEG" || name === "veg";
      if (prefLower === "non-veg") return code === "CHICKEN" || name.includes("non-veg") || name.includes("non veg");
      if (prefLower === "egg") return code === "EGG" || name === "egg";
      if (prefLower === "mixed") return code === "MIXED" || name === "mixed";
      return false;
    }) || mealCategories[0];
  }, [customerDietaryPreference, mealCategories]);

  // Initialize state with current DB values, falling back to default customer preference if null
  const [mealSelections, setMealSelections] = useState<
    Record<string, string | null>
  >(() => {
    return dailyPrefs.reduce((acc: any, pref: any) => {
      acc[pref.preference_date] = pref.meal_category_id || defaultCategory?.id || null;
      return acc;
    }, {});
  });

  // 5 PM Cutoff Logic
  const minEditableDate = useMemo(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const daysToAdd = currentHour >= 17 ? 2 : 1;
    return startOfDay(addDays(now, daysToAdd));
  }, []);

  const handleMealChange = (date: string, categoryId: string) => {
    setMealSelections((prev) => ({ ...prev, [date]: categoryId }));
  };

  const handleSave = async () => {
    setIsSaving(true);

    const updates: any[] = [];
    dailyPrefs.forEach((pref: any) => {
      const selectedCategory = mealSelections[pref.preference_date];
      const originalCategory = pref.meal_category_id || defaultCategory?.id || null;
      if (originalCategory !== selectedCategory) {
        updates.push({
          date: pref.preference_date,
          categoryId: selectedCategory,
        });
      }
    });

    if (updates.length === 0) {
      toast.info("No changes detected.");
      setIsSaving(false);
      return;
    }

    const result = await adminBulkUpdateMealPreferences(
      subscriptionId,
      updates,
    );

    if (result.success) {
      toast.success("Meal preferences successfully updated!");
      router.refresh();
    } else {
      toast.error(result.error || "Failed to update meals. Please try again.");
    }
    setIsSaving(false);
  };

  // Check if any selections differ from the original props (or fallback default)
  const hasChanges = dailyPrefs.some((pref: any) => {
    const originalCategory = pref.meal_category_id || defaultCategory?.id || null;
    return mealSelections[pref.preference_date] !== originalCategory;
  });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 border rounded-xl shadow-sm sticky top-[60px] z-10">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 flex items-center gap-2">
            <Utensils className="h-5 w-5 text-primary" /> Manage Meal Selection
          </h2>
          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
            <AlertCircle className="h-3 w-3" /> Changes for tomorrow must be
            made before 5:00 PM today.
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          className="w-full sm:w-auto font-bold transition-all bg-primary hover:bg-primary/90"
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" /> Save Meals
            </>
          )}
        </Button>
      </div>

      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <div className="grid grid-cols-1 divide-y">
          {dailyPrefs.map((pref: any) => {
            const date = parseISO(pref.preference_date);
            const today = startOfDay(new Date());
            const tomorrow = startOfDay(addDays(new Date(), 1));

            const isPast = isBefore(startOfDay(date), today);
            const isToday = format(date, "yyyy-MM-dd") === format(today, "yyyy-MM-dd");
            const isTomorrow = format(date, "yyyy-MM-dd") === format(tomorrow, "yyyy-MM-dd");

            // Look up delivery order dynamically by date from the separate deliveryOrders prop
            const delivery = (deliveryOrders || []).find(
              (d: any) => d.delivery_date === pref.preference_date
            );
            const deliveryStatus = delivery?.status;

            // 5 PM Cutoff Active logic:
            // Lock tomorrow's meal if current time is >= 5:00 PM
            const isTimeAfter5PM = new Date().getHours() >= 17;
            const isLocked = isPast || isToday || (isTomorrow && isTimeAfter5PM) || deliveryStatus === "DELIVERED";
            const isPaused = pref.is_paused;
            const isDisabled = isLocked || isPaused;

            // Format delivery status label
            const formatDeliveryStatus = (status: string) => {
              if (status === "DELIVERED") return "Delivered";
              if (status === "OUT_FOR_DELIVERY") return "Out for Delivery";
              if (status === "REACHING_TO_LOCATION") return "Rider Arriving";
              if (status === "ASSIGNED") return "Rider Assigned";
              if (status === "ORDER_CREATED") return "Preparing";
              if (status === "CANCELLED") return "Cancelled";
              return status;
            };

            let statusLabel = "";
            let statusClass = "text-zinc-500";
            let statusIcon = <AlertCircle className="h-3.5 w-3.5" />;

            if (isPaused) {
              statusLabel = "Delivery Paused";
              statusClass = "text-amber-600";
              statusIcon = <Ban className="h-3.5 w-3.5" />;
            } else if (deliveryStatus) {
              statusLabel = formatDeliveryStatus(deliveryStatus);
              if (deliveryStatus === "DELIVERED") {
                statusClass = "text-green-600 font-bold";
                statusIcon = <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />;
              } else if (deliveryStatus === "OUT_FOR_DELIVERY" || deliveryStatus === "REACHING_TO_LOCATION") {
                statusClass = "text-blue-600 font-bold";
                statusIcon = <Loader2 className="h-3.5 w-3.5 text-blue-600 animate-spin" />;
              } else if (deliveryStatus === "CANCELLED") {
                statusClass = "text-red-600 font-medium";
                statusIcon = <XCircle className="h-3.5 w-3.5 text-red-600" />;
              } else {
                statusClass = "text-zinc-600 font-medium";
                statusIcon = <Utensils className="h-3.5 w-3.5 text-zinc-500" />;
              }
            } else if (isPast) {
              statusLabel = "Delivered";
              statusClass = "text-green-600 font-bold";
              statusIcon = <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />;
            } else if (isToday) {
              statusLabel = "Preparing";
              statusClass = "text-zinc-600 font-medium";
              statusIcon = <Utensils className="h-3.5 w-3.5 text-zinc-500" />;
            } else if (isTomorrow && isLocked) {
              statusLabel = "Locked (Past 5 PM cut-off)";
              statusClass = "text-zinc-500 font-medium";
              statusIcon = <AlertCircle className="h-3.5 w-3.5 text-zinc-400" />;
            } else {
              statusLabel = "Active Delivery";
              statusClass = "text-green-600 font-medium";
              statusIcon = <Utensils className="h-3.5 w-3.5 text-green-600" />;
            }

            // Extract shop products (add-ons)
            const addonOrdersList = delivery?.addon_orders
              ? (Array.isArray(delivery.addon_orders) ? delivery.addon_orders : [delivery.addon_orders])
              : [];

            const getProductName = (products: any) => {
              if (!products) return "Shop Product";
              if (Array.isArray(products)) {
                return products[0]?.name || "Shop Product";
              }
              return products.name || "Shop Product";
            };

            const shopProducts = addonOrdersList.flatMap((order: any) => {
              const items = order.addon_order_items
                ? (Array.isArray(order.addon_order_items) ? order.addon_order_items : [order.addon_order_items])
                : [];
              return items.map((item: any) => ({
                name: getProductName(item.products),
                quantity: item.quantity,
              }));
            });

            return (
              <div
                key={pref.id}
                className={cn(
                  "p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-colors",
                  isPaused ? "bg-zinc-50/50" : "hover:bg-zinc-50/50",
                )}
              >
                <div className="flex items-center gap-4">
                  <div
                    className={cn(
                      "flex flex-col items-center justify-center h-14 w-14 rounded-xl border-2 shrink-0",
                      isPaused
                        ? "border-dashed border-zinc-300 bg-zinc-100"
                        : isLocked
                          ? "border-zinc-200 bg-zinc-50"
                          : "border-primary/20 bg-primary/5",
                    )}
                  >
                    <span className="text-xs font-bold text-muted-foreground uppercase">
                      {format(date, "MMM")}
                    </span>
                    <span
                      className={cn(
                        "text-lg font-black leading-none",
                        isPaused || isLocked ? "text-zinc-500" : "text-primary",
                      )}
                    >
                      {format(date, "d")}
                    </span>
                  </div>
                  <div>
                    <p className="font-bold text-zinc-900">
                      {format(date, "EEEE")}
                    </p>
                    <p className={cn("text-sm flex items-center gap-1 mt-0.5", statusClass)}>
                      {statusIcon} {statusLabel}
                    </p>
                    
                    {/* Change 3: Shop Add-ons Display */}
                    {(deliveryStatus === "DELIVERED" || (isPast && !isPaused)) && shopProducts.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5 items-center text-xs">
                        <span className="text-zinc-500 font-bold flex items-center gap-1">
                          <ShoppingBag className="h-3.5 w-3.5 text-blue-500" /> Shop Add-ons Delivered:
                        </span>
                        {shopProducts.map((p: any, idx: number) => (
                          <span
                            key={idx}
                            className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold border border-blue-100"
                          >
                            {p.name} (x{p.quantity})
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="w-full sm:w-64">
                  {isPaused ? (
                    <div className="h-10 w-full rounded-md border border-dashed border-zinc-300 bg-zinc-50 flex items-center px-3 text-sm text-zinc-400 font-medium cursor-not-allowed">
                      Paused
                    </div>
                  ) : (
                    <Select
                      disabled={isDisabled}
                      value={mealSelections[pref.preference_date] || ""}
                      onValueChange={(val) =>
                        handleMealChange(pref.preference_date, val)
                      }
                    >
                      <SelectTrigger
                        className={cn(
                          "h-10 font-medium",
                          isLocked && "bg-zinc-50 text-zinc-500",
                        )}
                      >
                        <SelectValue placeholder="Select Meal..." />
                      </SelectTrigger>
                      <SelectContent>
                        {mealCategories.map((cat: any) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
