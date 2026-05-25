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
        <h2 className="text-xl font-bold flex items-center gap-2">
          <span className="bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">
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
                  "w-full justify-start text-left font-normal h-12 border-2",
                  !data.startDate && "text-muted-foreground",
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
          <p className="text-[11px] text-muted-foreground mt-2 px-1">
            * Note: Tomorrow's meal must be finalized before 5:00 PM today.
          </p>
          {latestSubscription && (
            <p className="text-sm text-blue-600 bg-blue-50 p-2 rounded-md border border-blue-100">
              Your new plan will automatically begin after your current
              subscription expires.
            </p>
          )}
        </div>
      </section>

      {/* 2. Address Selection */}
      <section className="space-y-4">
        <div className="flex flex-col md:flex-row gap-2 items-start justify-between md:items-center">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <span className="bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">
              4
            </span>
            Delivery Address
          </h2>

          {/* WIRE UP THE ONCLICK HANDLERS HERE */}
          {addresses.length >= 2 ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-zinc-300 text-zinc-700 hover:bg-zinc-50"
              onClick={() => setIsAddressModalOpen(true)}
            >
              <Settings className="h-4 w-4" /> Manage Addresses
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-primary text-primary hover:bg-primary/5"
              onClick={() => setIsAddressModalOpen(true)}
            >
              <Plus className="h-4 w-4" /> Add New Address
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="h-32 flex items-center justify-center border-2 border-dashed rounded-xl">
            <p className="text-muted-foreground animate-pulse">
              Loading saved addresses...
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {addresses.map((addr) => (
              <Card
                key={addr.id}
                className={cn(
                  "cursor-pointer border-2 transition-all relative group",
                  data.addressId === addr.id
                    ? "border-secondary bg-secondary/5"
                    : "hover:border-zinc-300",
                )}
                onClick={() => setData({ ...data, addressId: addr.id })}
              >
                {data.addressId === addr.id && (
                  <div className="absolute top-3 right-3 text-secondary">
                    <CheckCircle2 className="h-5 w-5 fill-secondary text-white" />
                  </div>
                )}
                <CardContent className="p-4 flex gap-3">
                  <MapPin className="h-5 w-5 text-muted-foreground shrink-0 mt-1" />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-sm">{addr.tag}</p>
                      {addr.is_primary && (
                        <span className="bg-secondary/20 text-secondary-foreground text-[10px] px-2 py-0.5 rounded font-bold">
                          PRIMARY
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {addr.street_1}, {addr.street_2 && `${addr.street_2},`}{" "}
                      {addr.city}, {addr.pincode}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}

            {addresses.length === 0 && (
              <div className="col-span-full py-10 text-center border-2 border-dashed rounded-xl space-y-3">
                <p className="text-muted-foreground">
                  No saved addresses found.
                </p>
                <Button
                  size="sm"
                  className="bg-primary"
                  onClick={() => setIsAddressModalOpen(true)}
                >
                  Enter Delivery Address
                </Button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Navigation */}
      <div className="pt-8 border-t flex flex-col-reverse sm:flex-row justify-between items-center gap-4 mt-8">
        <Button variant="ghost" onClick={onBack} className="gap-2">
          <ChevronLeft className="h-4 w-4" /> Back to Plans
        </Button>
        <Button
          size="lg"
          disabled={!data.startDate || !data.addressId}
          onClick={onNext}
          className="bg-secondary hover:bg-secondary/90 px-10 text-white font-bold"
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
