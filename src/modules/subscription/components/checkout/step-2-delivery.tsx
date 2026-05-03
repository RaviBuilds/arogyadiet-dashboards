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

import { AddressManagerModal } from "@/shared/components/customer/address-manager-modal";

export function DeliveryDetails({ data, setData, onNext, onBack }: any) {
  const [addresses, setAddresses] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);

  const supabase = createClient();

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

    if (!data.addressId && addressList.length > 0) {
      const primary =
        addressList.find((a: any) => a.is_primary) || addressList[0];
      setData((prev: any) => ({ ...prev, addressId: primary.id }));
    }
    setIsLoading(false);
  }, [data.addressId, setData, supabase]);

  const minStartDate = useMemo(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const daysToAdd = currentHour >= 17 ? 2 : 1;
    return startOfDay(addDays(now, daysToAdd));
  }, []);

  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses]);

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-right-4 max-w-full overflow-hidden">
      <section className="space-y-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <span className="bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0">
            3
          </span>
          When should we start?
        </h2>
        <div className="w-full sm:max-w-xs">
          <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal h-12 border-2",
                  !data.startDate && "text-muted-foreground",
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                <span className="truncate">
                  {data.startDate
                    ? format(data.startDate, "PPP")
                    : "Select Start Date"}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={data.startDate}
                onSelect={(date) => {
                  setData({ ...data, startDate: date });
                  setIsCalendarOpen(false);
                }}
                disabled={(date) => startOfDay(date) < minStartDate}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          <p className="text-[11px] text-muted-foreground mt-2 px-1 break-words">
            * Note: Tomorrow's meal must be finalized before 5:00 PM today.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <span className="bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0">
              4
            </span>
            Delivery Address
          </h2>

          {addresses.length >= 2 ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-zinc-300 text-zinc-700 hover:bg-zinc-50 w-full sm:w-auto"
              onClick={() => setIsAddressModalOpen(true)}
            >
              <Settings className="h-4 w-4 shrink-0" /> Manage Addresses
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-primary text-primary hover:bg-primary/5 w-full sm:w-auto"
              onClick={() => setIsAddressModalOpen(true)}
            >
              <Plus className="h-4 w-4 shrink-0" /> Add New Address
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
                    <CheckCircle2 className="h-5 w-5 fill-secondary text-white shrink-0" />
                  </div>
                )}
                <CardContent className="p-4 flex gap-3 min-w-0">
                  <MapPin className="h-5 w-5 text-muted-foreground shrink-0 mt-1" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-sm truncate">{addr.tag}</p>
                      {addr.is_primary && (
                        <span className="bg-secondary/20 text-secondary-foreground text-[10px] px-2 py-0.5 rounded font-bold shrink-0">
                          PRIMARY
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2 break-words">
                      {addr.street_1}, {addr.street_2 && `${addr.street_2},`}{" "}
                      {addr.city}, {addr.pincode}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}

            {addresses.length === 0 && (
              <div className="col-span-full py-10 px-4 text-center border-2 border-dashed rounded-xl space-y-3">
                <p className="text-muted-foreground text-sm break-words">
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

      {/* Button Layout Fixed */}
      <div className="pt-8 border-t flex flex-col-reverse sm:flex-row justify-between items-center gap-4 mt-8">
        <Button
          variant="ghost"
          onClick={onBack}
          className="w-full sm:w-auto gap-2"
        >
          <ChevronLeft className="h-4 w-4 shrink-0" /> Back to Plans
        </Button>
        <Button
          size="lg"
          disabled={!data.startDate || !data.addressId}
          onClick={onNext}
          className="w-full sm:w-auto bg-secondary hover:bg-secondary/90 px-10 text-white font-bold"
        >
          Customize My Meals
        </Button>
      </div>

      {isAddressModalOpen && (
        <AddressManagerModal
          isOpen={isAddressModalOpen}
          onClose={() => setIsAddressModalOpen(false)}
          onAddressUpdated={() => fetchAddresses()}
        />
      )}
    </div>
  );
}
