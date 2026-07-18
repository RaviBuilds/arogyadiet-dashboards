"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { format, addDays, startOfDay } from "date-fns";
import {
  CalendarIcon,
  Plus,
  Settings,
  CalendarClock,
  MapPinned,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { cn } from "@/lib/utils";
import { IconChip } from "@/shared/components/customer/profile-ui/IconChip";
import { OnboardingAddressCard } from "./onboarding/OnboardingAddressCard";
import { OnboardingSummaryBar } from "./onboarding/OnboardingSummaryBar";

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

  
  const selectedAddress = addresses.find((a) => a.id === data.addressId) ?? null;

  return (
    <div className="space-y-14 animate-in fade-in slide-in-from-right-4">
      {/* 1. Subscription Start Date */}
      <section className="space-y-7">
        <div>
          <div className="flex items-center gap-2.5">
            <IconChip icon={CalendarClock} tone="green" />
            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-emerald-700/90">
              Your Start Date
            </span>
          </div>
          <h2 className="mt-3 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            When should we start?
          </h2>
          <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-slate-500">
            Pick the day your first delivery should arrive.
          </p>
        </div>

        {/* Two-column layout on larger screens so the date picker never sits
            alone in a wide, mostly-empty card — the right column carries the
            same real notes that used to sit as small muted text underneath
            the button, now given proper visual weight instead of being an
            afterthought. Nothing here is invented; it's the same copy,
            better composed. */}
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,280px)_1fr]">
          <div>
            <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "h-12 w-full justify-start rounded-2xl border border-slate-200 text-left font-normal transition-all duration-200 hover:border-emerald-200 hover:bg-emerald-50/40",
                    !data.startDate && "text-slate-500",
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4 text-emerald-600" />
                  {data.startDate ? (
                    format(data.startDate, "PPP")
                  ) : (
                    <span>Select Start Date</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto rounded-2xl p-0" align="start">
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
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-4 sm:p-5">
            <div className="flex items-start gap-2.5">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <p className="text-sm leading-relaxed text-slate-500">
                Tomorrow&apos;s meal must be finalized before 5:00 PM today.
              </p>
            </div>
            {latestSubscription && (
              <div className="flex items-start gap-2.5 border-t border-slate-200/70 pt-3">
                <CalendarIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <p className="text-sm leading-relaxed text-emerald-800">
                  Your new plan will automatically begin after your current
                  subscription expires.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Soft organic divider between sections instead of plain whitespace. */}
      <div
        aria-hidden="true"
        className="h-px w-full bg-gradient-to-r from-transparent via-slate-200 to-transparent"
      />

      {/* 2. Address Selection */}
      <section className="space-y-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <IconChip icon={MapPinned} tone="coral" />
              <span className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-primary/80">
                Your Delivery Address
              </span>
            </div>
            <h2 className="mt-3 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              Where should we deliver?
            </h2>
            <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-slate-500">
              Choose a saved address, or add a new one.
            </p>
          </div>

          {/* "Manage Addresses" is a distinct bulk-edit action (edit/delete
              existing entries), so it stays as its own top-right button once
              there's more than one to manage. Adding a NEW address now lives
              as an inline tile in the row below instead — that fixes the
              earlier "floating disconnected button" issue and, as a side
              effect, keeps the row from ever looking sparse with just one
              saved address, since there's always a second tile beside it. */}
          {addresses.length >= 2 ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 self-start rounded-full transition-all duration-200 sm:self-auto"
              onClick={() => setIsAddressModalOpen(true)}
            >
              <Settings className="h-4 w-4" /> Manage Addresses
            </Button>
          ) : null}
        </div>

        {isLoading ? (
          <div className="flex h-32 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50/50">
            <p className="animate-pulse text-sm text-slate-500">
              Loading saved addresses...
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-4">
            {/* flex-wrap + a per-card max-width (rather than a CSS grid with
                auto-fit) so saved addresses never leave a phantom empty
                column of whitespace beside them — cards only ever take the
                room they need and wrap naturally once there are enough of
                them to fill a row. */}
            {addresses.map((addr, index) => (
              <div
                key={addr.id}
                className="reveal-rise w-full sm:max-w-md sm:flex-1 sm:basis-[320px]"
                style={{ ["--reveal-delay" as string]: `${index * 60}ms` }}
              >
                <OnboardingAddressCard
                  address={addr}
                  isSelected={data.addressId === addr.id}
                  onSelect={() => setData({ ...data, addressId: addr.id })}
                />
              </div>
            ))}

            {/* Inline "Add address" tile — same footprint as a saved address
                card, so it belongs in the same row/story rather than being a
                separate floating action. */}
            <button
              type="button"
              onClick={() => setIsAddressModalOpen(true)}
              className="reveal-rise flex w-full items-center justify-center gap-2 rounded-3xl border border-dashed border-slate-200 bg-slate-50/50 p-5 text-sm font-medium text-slate-500 transition-all duration-300 hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50/40 hover:text-emerald-700 sm:max-w-md sm:flex-1 sm:basis-[320px]"
              style={{ ["--reveal-delay" as string]: `${addresses.length * 60}ms` }}
            >
              <Plus className="h-4 w-4" />
              {addresses.length === 0 ? "Enter Delivery Address" : "Add New Address"}
            </button>
          </div>
        )}
      </section>

      <OnboardingSummaryBar
        items={[
          data.startDate
            ? { label: "Start Date", value: format(data.startDate, "MMM d, yyyy") }
            : null,
          selectedAddress
            ? { label: "Delivery Address", value: selectedAddress.tag || "Selected" }
            : null,
        ].filter((item): item is NonNullable<typeof item> => item !== null)}
        emptyLabel="Pick a start date and address to continue"
        continueLabel="Customize My Meals"
        disabled={!data.startDate || !data.addressId}
        onContinue={onNext}
        backLabel="Back to Plans"
        onBack={onBack}
      />

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
