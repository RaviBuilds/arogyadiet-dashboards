"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { format, addDays, startOfDay } from "date-fns";
import {
  CalendarIcon,
  MapPin,
  Plus,
  CheckCircle2,
  ChevronLeft,
  Settings,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/lib/utils";

// 1. IMPORT YOUR MODAL (Adjust path if necessary based on your structure)
import { AddressManagerModal } from "@/shared/components/customer/address-manager-modal";

export function DeliveryDetails({
  data,
  setData,
  onNext,
  onBack,
  latestSubscription,
}: any) {
  const [addresses, setAddresses] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  // 2. ADD MODAL STATE
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);

  const supabase = createClient();

  // 3. EXTRACT FETCH FUNCTION so it can be reused after saving a new address
  const fetchAddresses = useCallback(async () => {
    setIsLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from("customer_profiles")
      .select("id")
      .eq(
        "user_id",
        (
          await supabase
            .from("users")
            .select("id")
            .eq("auth_user_id", user.id)
            .maybeSingle()
        ).data?.id,
      )
      .maybeSingle();

    if (!profile) {
      setIsLoading(false);
      return;
    }

    const { data: addrData } = await supabase
      .from("addresses")
      .select("*")
      .eq("customer_profile_id", profile.id)
      .order("is_primary", { ascending: false });

    const addressList = addrData || [];
    setAddresses(addressList);

    // Auto-select primary address if nothing is selected yet
    if (!data.addressId && addressList.length > 0) {
      const primary =
        addressList.find((a: any) => a.is_primary) || addressList[0];
      setData((prev: any) => ({ ...prev, addressId: primary.id }));
    }
    setIsLoading(false);
  }, [data.addressId, setData, supabase]);

  const minStartDate = useMemo(() => {
   
    if(latestSubscription)
    {
      const currentEndDate = new Date(latestSubscription.effective_end_on || latestSubscription.ends_on); 
      return startOfDay(addDays(currentEndDate, 1));
    }
    const now = new Date();
    const currentHour = now.getHours(); // Local hour (0-23)

    // If it's past 17:00 (5 PM), we need 2 days lead time. Otherwise, 1 day.
    const daysToAdd = currentHour >= 17 ? 2 : 1;

    // startOfDay resets the time to 00:00:00 so the calendar compares cleanly
    return startOfDay(addDays(now, daysToAdd));
  }, []);

  // Call it on initial load
  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses]);

  useEffect(() => {
    // Auto-set the start date ONLY if they have a latest subscription and haven't picked a date yet
    if (latestSubscription && !data.startDate) {
      setData((prev: any) => ({ ...prev, startDate: minStartDate }));
    }
  }, [latestSubscription, minStartDate, data.startDate, setData]);

  
  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-right-4">
      {/* 1. Subscription Start Date */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900 tracking-tight flex items-center gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">
            3
          </span>
          When should we start?
        </h2>
        <div className="max-w-xs">
          <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal h-12 rounded-lg border border-slate-200 hover:bg-slate-50 transition-all duration-200",
                  !data.startDate && "text-slate-500",
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {data.startDate ? (
                  format(data.startDate, "PPP")
                ) : (
                  <span>Select Start Date</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={data.startDate}
                defaultMonth={data.startDate || minStartDate} 
                onSelect={(date) => {
                  setData({ ...data, startDate: date });
                  setIsCalendarOpen(false);
                }}
                disabled={(date) => startOfDay(date) < minStartDate}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          <p className="text-xs text-slate-500 mt-2 px-1">
            * Note: Tomorrow's meal must be finalized before 5:00 PM today.
          </p>
          {latestSubscription && (
            <p className="text-sm text-blue-800 bg-blue-50 p-3 rounded-lg border border-blue-200">
              Your new plan will automatically begin after your current
              subscription expires.
            </p>
          )}
        </div>
      </section>

      {/* 2. Address Selection */}
      <section className="space-y-4">
        <div className="flex flex-col md:flex-row gap-2 items-start justify-between md:items-center">
          <h2 className="text-lg font-semibold text-slate-900 tracking-tight flex items-center gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">
              4
            </span>
            Delivery Address
          </h2>

          {/* WIRE UP THE ONCLICK HANDLERS HERE */}
          {addresses.length >= 2 ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 transition-all duration-200"
              onClick={() => setIsAddressModalOpen(true)}
            >
              <Settings className="h-4 w-4" /> Manage Addresses
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 transition-all duration-200"
              onClick={() => setIsAddressModalOpen(true)}
            >
              <Plus className="h-4 w-4" /> Add New Address
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="h-32 flex items-center justify-center border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
            <p className="text-sm text-slate-500 animate-pulse">
              Loading saved addresses...
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {addresses.map((addr) => (
              <Card
                key={addr.id}
                className={cn(
                  "cursor-pointer rounded-xl border shadow-sm transition-all duration-200 relative group",
                  data.addressId === addr.id
                    ? "border-secondary bg-secondary/5 ring-2 ring-secondary/20"
                    : "border-slate-200 hover:border-slate-300 hover:bg-slate-50/50",
                )}
                onClick={() => setData({ ...data, addressId: addr.id })}
              >
                {data.addressId === addr.id && (
                  <div className="absolute top-3 right-3 text-secondary">
                    <CheckCircle2 className="h-5 w-5 fill-secondary text-white" />
                  </div>
                )}
                <CardContent className="p-4 flex gap-3">
                  <MapPin className="h-5 w-5 text-slate-400 shrink-0 mt-1" />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm text-slate-900">
                        {addr.tag}
                      </p>
                      {addr.is_primary && (
                        <Badge
                          variant="outline"
                          className="rounded-full border-emerald-200 bg-emerald-50 text-[10px] font-semibold uppercase tracking-wider text-emerald-700"
                        >
                          PRIMARY
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 mt-1 line-clamp-2">
                      {addr.street_1}, {addr.street_2 && `${addr.street_2},`}{" "}
                      {addr.city}, {addr.pincode}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}

            {addresses.length === 0 && (
              <div className="col-span-full py-10 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/50 space-y-3">
                <p className="text-sm text-slate-500">
                  No saved addresses found.
                </p>
                <Button
                  size="sm"
                  onClick={() => setIsAddressModalOpen(true)}
                  className="transition-all duration-200"
                >
                  Enter Delivery Address
                </Button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Navigation */}
      <div className="pt-8 border-t border-slate-100 flex flex-col-reverse sm:flex-row justify-between items-center gap-4 mt-8">
        <Button
          variant="ghost"
          onClick={onBack}
          className="gap-2 transition-all duration-200"
        >
          <ChevronLeft className="h-4 w-4" /> Back to Plans
        </Button>
        <Button
          size="lg"
          variant="secondary"
          disabled={!data.startDate || !data.addressId}
          onClick={onNext}
          className="px-10 font-semibold transition-all duration-200"
        >
          Customize My Meals
        </Button>
      </div>

      {/* 4. RENDER THE MODAL AT THE BOTTOM */}
      {isAddressModalOpen && (
        <AddressManagerModal
          isOpen={isAddressModalOpen}
          onClose={() => setIsAddressModalOpen(false)}
          onAddressUpdated={() => fetchAddresses()} // Refresh checkout list when done
        />
      )}
    </div>
  );
}
