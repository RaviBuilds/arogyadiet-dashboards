"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { addDays, format, startOfDay } from "date-fns";
import { useRouter } from "next/navigation";
import { CalendarIcon, Clock3, IndianRupee, Loader2, PauseCircle, AlertTriangle, Truck } from "lucide-react";

import { addSubscription } from "@/actions/admin-actions/adminSubscriptionActions";
import { calculateDeliveryChargeAction } from "@/actions/admin-actions/deliveryChargeActions";
import { cn } from "@/lib/utils";
import { earliestStartDate, getPastDateRangeForAddSub, pastDayStatusBoundary, ONBOARDING_CUTOFF_HOUR_IST } from "@/lib/onboarding/cutoff";
import { hasOverlap, type ExistingSubscription } from "@/lib/subscriptions/overlap";
import { getISTDateString, addDaysToISODate, parseISODateString, istHourOf, istDateStringOf } from "@/lib/dates/ist";
import type { PastDayStatus } from "@/types/onboarding";

import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/shared/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { Calendar } from "@/shared/components/ui/calendar";
import { Separator } from "@/shared/components/ui/separator";
import { PastDayStatusPopup } from "@/shared/components/admin/customers/PastDayStatusPopup";

// ─── types ───────────────────────────────────────────────────────────────────

type SubscriptionPlan = {
  id: string;
  name: string;
  price: number;
  duration_days: number;
  pause_credits: number;
  is_active?: boolean;
};

type MealCategory = {
  id: string;
  code: string;
  name: string;
};

type AddressOption = {
  id: string;
  tag: string;
  street_1: string;
  city: string;
  pincode: string;
};

export type InitialSubscriptionData = {
  activeSubscription: { id: string; effective_end_on: string } | null;
  previousSubscriptionEndDate: string | null; // YYYY-MM-DD of last completed sub's effective_end_on
  existingSubscriptions: ExistingSubscription[]; // ACTIVE/PENDING subs for overlap detection
  subscriptionPlans: SubscriptionPlan[];
  mealCategories: MealCategory[];
  addresses: AddressOption[];
};

// ─── Admin start-date helper (no 5 PM cutoff) ────────────────────────────────

function getMinStartDate(activeSubEnd: string | null): Date {
  let min = startOfDay(addDays(new Date(), 1));

  if (activeSubEnd) {
    const afterActive = startOfDay(addDays(new Date(activeSubEnd), 1));
    if (afterActive > min) min = afterActive;
  }
  return min;
}

// ─── Zod schema ──────────────────────────────────────────────────────────────

const pastDayStatusSchema = z.object({
  date: z.string(),
  mealStatus: z.enum(["Delivered", "Skipped"]),
  mealType: z.enum(["VEG", "EGG", "CHICKEN"]).nullable(),
  deliveryAddress: z.enum(["Primary", "Secondary"]).nullable(),
});

const formSchema = z
  .object({
    mode: z.enum(["existing", "custom"]),
    planId: z.string().optional(),
    startDate: z.date(),
    endDate: z.date().optional(),
    mealCategoryId: z.string().min(1, "Meal preference is required"),
    deliveryAddressId: z.string().min(1, "Delivery address is required"),
    paymentStatus: z.enum(["Payment Collected", "Payment Pending"]),
    paymentReference: z.string().optional(),
    paymentNotes: z.string().optional(),
    basePrice: z.number().optional(),
    taxPercent: z.number().min(0).max(100).optional(),
    taxAmount: z.number().optional(),
    totalAmount: z.number().optional(),
    pauseCredits: z.number().int().min(0).optional(),
    pastDateEnabled: z.boolean(),
    pastDayStatuses: z.array(pastDayStatusSchema),
    automationOverrideAcknowledged: z.boolean(),
  })
  .superRefine((d, ctx) => {
    if (d.mode === "existing" && !d.planId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Please select a plan", path: ["planId"] });
    }
    if (d.mode === "custom") {
      if (!d.basePrice || d.basePrice <= 0)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Base price is required", path: ["basePrice"] });
      if (!d.endDate)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "End date is required", path: ["endDate"] });
      if (d.pauseCredits === undefined)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Pause credits are required", path: ["pauseCredits"] });
    }
  });

type FormValues = z.infer<typeof formSchema>;

// ─── component ───────────────────────────────────────────────────────────────

interface AdminAddSubscriptionFormProps {
  customerProfileId: string;
  initialData: InitialSubscriptionData;
  /**
   * Injectable submit action. Defaults to the admin-scoped addSubscription.
   * Franchise callers pass franchiseAddSubscription.
   */
  submitAction?: (
    payload: any,
    isCustom: boolean,
  ) => Promise<{ success: boolean; error?: string }>;
  /** When provided, stamped into the payload (franchise portal). */
  franchiseId?: string;
}

export function AdminAddSubscriptionForm({
  customerProfileId,
  initialData,
  submitAction = addSubscription,
  franchiseId,
}: AdminAddSubscriptionFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isStartDateOpen, setIsStartDateOpen] = useState(false);
  const [isEndDateOpen, setIsEndDateOpen] = useState(false);
  const [showPastDayStatusPopup, setShowPastDayStatusPopup] = useState(false);
  const pendingFormDataRef = useRef<FormValues | null>(null);

  // ─── Delivery Charge State (Req 8.1–8.8) ──────────────────────────────────
  const [deliveryCharge, setDeliveryCharge] = useState<number | null>(null);
  const [deliveryChargeInput, setDeliveryChargeInput] = useState<string>("");
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [ratePerKm, setRatePerKm] = useState<number | null>(null);
  const [deliveryChargeError, setDeliveryChargeError] = useState<string | null>(null);
  const [isCalculatingDelivery, setIsCalculatingDelivery] = useState(false);
  /** Tracks the system-calculated delivery charge for admin override audit (Req 12.4) */
  const [autoCalculatedDeliveryCharge, setAutoCalculatedDeliveryCharge] = useState<number | null>(null);

  const { activeSubscription, mealCategories, addresses } = initialData;
  const subscriptionPlans = useMemo(
    () =>
      initialData.subscriptionPlans.filter((p) => p.is_active !== false),
    [initialData.subscriptionPlans],
  );

  const minStartDate = useMemo(
    () => getMinStartDate(activeSubscription?.effective_end_on ?? null),
    [activeSubscription?.effective_end_on],
  );

  const willBePending = activeSubscription !== null;
  console.log(willBePending);
  // Determine if past date toggle should be disabled
  // (when previousSubscriptionEndDate >= yesterday IST, no valid past dates exist)
  const pastDateToggleDisabled = useMemo(() => {
    if (!initialData.previousSubscriptionEndDate) return false;
    const yesterday = addDaysToISODate(getISTDateString(0), -1);
    return initialData.previousSubscriptionEndDate >= yesterday;
  }, [initialData.previousSubscriptionEndDate]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      mode: "existing",
      startDate: minStartDate,
      paymentStatus: "Payment Pending",
      paymentReference: "",
      paymentNotes: "",
      taxPercent: 0,
      pastDateEnabled: false,
      pastDayStatuses: [],
      automationOverrideAcknowledged: false,
    },
  });

  const { control, watch, setValue, handleSubmit, reset, formState } = form;
  const { errors } = formState;

  const mode = watch("mode");
  const planId = watch("planId");
  const startDate = watch("startDate");
  const basePrice = watch("basePrice");
  const taxPercent = watch("taxPercent");
  const paymentStatus = watch("paymentStatus");
  const pastDateEnabled = watch("pastDateEnabled");

  const selectedPlan = subscriptionPlans.find((p) => p.id === planId);

  // ─── Past-date calendar logic (Req 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.4) ────
  const istToday = useMemo(() => getISTDateString(0), []);

  // Compute past-date range using getPastDateRangeForAddSub
  const pastDateRange = useMemo(
    () => getPastDateRangeForAddSub(istToday, initialData.previousSubscriptionEndDate),
    [istToday, initialData.previousSubscriptionEndDate],
  );

  // Compute future-mode min date using cutoff logic from cutoff.ts
  const futureMinDate = useMemo(() => {
    const earliest = earliestStartDate(new Date());
    return parseISODateString(earliest);
  }, []);

  // Compute the plan duration (needed for overlap end date calculation)
  const planDurationDays = useMemo(() => {
    if (mode === "existing" && selectedPlan) {
      return selectedPlan.duration_days;
    }
    // For custom mode, use the difference between start and end if available
    const endDate = form.getValues("endDate");
    if (mode === "custom" && startDate && endDate) {
      return Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    }
    // Default fallback — use 30 days for overlap checking when plan info unavailable
    return 30;
  }, [mode, selectedPlan, startDate, form]);

  // Calendar disabled function: handles both past-date and future-date modes + overlap
  const isDateDisabled = useMemo(() => {
    return (date: Date): boolean => {
      const dateStr = format(date, "yyyy-MM-dd");

      if (pastDateEnabled) {
        // Past Date Mode: only allow dates within [pastDateRange.start, pastDateRange.end]
        if (dateStr < pastDateRange.start || dateStr > pastDateRange.end) {
          return true;
        }
      } else {
        // Future Date Mode: disable dates before the future min date
        if (date < futureMinDate) {
          return true;
        }
      }

      // In both modes: disable dates that would cause overlap with existing subs
      // Compute the proposed subscription end date: startDate + duration - 1
      const proposedEndStr = addDaysToISODate(dateStr, planDurationDays - 1);
      if (hasOverlap(dateStr, proposedEndStr, initialData.existingSubscriptions)) {
        return true;
      }

      return false;
    };
  }, [pastDateEnabled, pastDateRange, futureMinDate, planDurationDays, initialData.existingSubscriptions]);

  // ─── 5 PM IST Cutoff Alert Logic (Req 4.1, 4.2, 4.3, 4.4, 4.5, 4.6) ──────
  const isAfterCutoff = useMemo(() => {
    return istHourOf(new Date()) >= ONBOARDING_CUTOFF_HOUR_IST;
  }, []);

  const tomorrowIST = useMemo(() => {
    return addDaysToISODate(istDateStringOf(new Date()), 1);
  }, []);

  const automationOverrideAcknowledged = watch("automationOverrideAcknowledged");

  const showAutomationAlert = useMemo(() => {
    if (!isAfterCutoff || pastDateEnabled || !startDate) return false;
    const startDateStr = format(startDate, "yyyy-MM-dd");
    return startDateStr === tomorrowIST;
  }, [isAfterCutoff, pastDateEnabled, startDate, tomorrowIST]);

  // Reset acknowledgment when alert hides (start date changes away from tomorrow or pastDateEnabled turns on)
  useEffect(() => {
    if (!showAutomationAlert) {
      setValue("automationOverrideAcknowledged", false);
    }
  }, [showAutomationAlert, setValue]);

  // ─── Delivery Charge Helpers (Req 8.1–8.8) ────────────────────────────────

  /**
   * Validates and sets the delivery charge from manual input.
   * Rejects non-numeric, negative, > 999,999,999.99
   */
  const handleDeliveryChargeInput = (rawValue: string) => {
    setDeliveryChargeInput(rawValue);

    if (rawValue === "") {
      setDeliveryCharge(null);
      setDeliveryChargeError(null);
      return;
    }

    // Reject non-numeric
    const parsed = Number(rawValue);
    if (isNaN(parsed) || !isFinite(parsed)) {
      setDeliveryChargeError("Delivery charge must be a valid number");
      return;
    }

    // Reject negative
    if (parsed < 0) {
      setDeliveryChargeError("Delivery charge cannot be negative");
      return;
    }

    // Reject > 999,999,999.99
    if (parsed > 999999999.99) {
      setDeliveryChargeError("Delivery charge cannot exceed ₹999,999,999.99");
      return;
    }

    // Reject > 2 decimal places
    const parts = rawValue.split(".");
    if (parts.length === 2 && parts[1].length > 2) {
      setDeliveryChargeError("Maximum 2 decimal places allowed");
      return;
    }

    setDeliveryChargeError(null);
    setDeliveryCharge(parsed);
  };

  /**
   * Get planDays for the "Calculate Delivery Charges" action.
   * Existing mode: selectedPlan.duration_days
   * Custom mode: admin-entered duration (computed from start/end dates)
   */
  const getDeliveryPlanDays = (): number | null => {
    if (mode === "existing") {
      return selectedPlan?.duration_days ?? null;
    }
    // Custom mode: duration derived from start and end dates
    const endDate = form.getValues("endDate");
    if (startDate && endDate) {
      return Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    }
    return null;
  };

  /**
   * Triggers the delivery charge calculation via server action.
   */
  const handleCalculateDeliveryCharge = async () => {
    const planDays = getDeliveryPlanDays();
    if (!planDays || planDays < 1) {
      setDeliveryChargeError(
        mode === "existing"
          ? "Please select a plan first"
          : "Please set start and end dates first",
      );
      return;
    }

    setIsCalculatingDelivery(true);
    setDeliveryChargeError(null);

    try {
      const result = await calculateDeliveryChargeAction({
        customerProfileId,
        planDays,
      });

      if (!result.success) {
        setDeliveryChargeError(result.error);
        // Leave field editable for manual entry
        setDistanceKm(null);
        setRatePerKm(null);
        return;
      }

      const outcome = result.outcome;

      if (outcome.ok) {
        // Success — auto-fill the delivery charge
        setDeliveryCharge(outcome.totalDeliveryCharge);
        setDeliveryChargeInput(outcome.totalDeliveryCharge.toFixed(2));
        setDistanceKm(outcome.distanceKm);
        setRatePerKm(outcome.ratePerKm);
        setDeliveryChargeError(null);
        setAutoCalculatedDeliveryCharge(outcome.totalDeliveryCharge);
      } else {
        // Failure — show user-friendly message, allow manual entry
        let message = "Unable to calculate delivery charge";
        switch (outcome.reason) {
          case "missing_pincode":
            message = "Customer has no primary address or pincode is missing";
            break;
          case "unresolved_clinic":
            message =
              outcome.clinicResolution === "ambiguous"
                ? "Multiple clinics found for this pincode (ambiguous)"
                : "No clinic found for the customer's pincode";
            break;
          case "missing_coordinates":
            message =
              "Address or clinic coordinates are missing. Please update the address with valid coordinates.";
            break;
          case "invalid_coordinates":
            message = "Address or clinic coordinates are invalid (out of range)";
            break;
          case "unresolved_rate":
            message = "Could not resolve the delivery rate for this clinic";
            break;
          case "invalid_input":
            message = `Invalid input: ${outcome.field}`;
            break;
        }
        setDeliveryChargeError(message);
        setDistanceKm(null);
        setRatePerKm(null);
      }
    } catch {
      setDeliveryChargeError("An error occurred while calculating delivery charge");
      setDistanceKm(null);
      setRatePerKm(null);
    } finally {
      setIsCalculatingDelivery(false);
    }
  };

  // ─── Recompute Total_Payable when delivery charge changes (Req 8.6) ────────
  useEffect(() => {
    if (mode === "existing" && selectedPlan) {
      const planAmount = selectedPlan.price;
      const total = planAmount + (deliveryCharge ?? 0);
      setValue("totalAmount", parseFloat(total.toFixed(2)));
    }
  }, [deliveryCharge, mode, selectedPlan, setValue]);

  useEffect(() => {
    if (mode === "custom" && basePrice !== undefined && taxPercent !== undefined) {
      const tax = parseFloat((basePrice * (taxPercent / 100)).toFixed(2));
      const planAmount = parseFloat((basePrice + tax).toFixed(2));
      const total = planAmount + (deliveryCharge ?? 0);
      setValue("taxAmount", tax);
      setValue("totalAmount", parseFloat(total.toFixed(2)));
    }
  }, [mode, basePrice, taxPercent, deliveryCharge, setValue]);

  // Reset start date when pastDateEnabled toggles (valid range changes completely)
  useEffect(() => {
    if (pastDateEnabled) {
      // When switching to past-date mode, reset to a valid past date or clear selection
      const pastStart = parseISODateString(pastDateRange.start);
      setValue("startDate", pastStart);
      setValue("pastDayStatuses", []);
    } else {
      // When switching to future-date mode, reset to the future min date
      setValue("startDate", futureMinDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastDateEnabled]);

  // Auto-fill plan details when plan / startDate changes
  useEffect(() => {
    if (mode === "existing" && selectedPlan && startDate) {
      setValue("basePrice", selectedPlan.price);
      setValue("taxPercent", 0);
      setValue("taxAmount", 0);
      const total = selectedPlan.price + (deliveryCharge ?? 0);
      setValue("totalAmount", parseFloat(total.toFixed(2)));
      setValue("pauseCredits", selectedPlan.pause_credits);
      setValue("endDate", addDays(startDate, selectedPlan.duration_days - 1));
    }
  }, [mode, selectedPlan, startDate, setValue, deliveryCharge]);

  // (Delivery charge effects handle tax/total recalculation for custom mode)

  const onSubmit = (values: FormValues) => {
    // Req 3.1: If pastDateEnabled AND startDate is in the past, open the PastDayStatusPopup
    const startDateStr = format(values.startDate, "yyyy-MM-dd");
    if (values.pastDateEnabled && startDateStr < istToday) {
      // Store validated form data so we can proceed after popup confirmation
      pendingFormDataRef.current = values;
      setShowPastDayStatusPopup(true);
      return;
    }

    // Normal submission (no past date or pastDateEnabled is off)
    performSubmission(values);
  };

  /** Actually submits the form data to the server action. */
  const performSubmission = (values: FormValues) => {
    startTransition(async () => {
      const isCustom = values.mode === "custom";

      const commonPaymentFields = {
        paymentStatus: values.paymentStatus,
        paymentReference: values.paymentReference || undefined,
        paymentNotes: values.paymentNotes || undefined,
      };

      const startDateStr = format(values.startDate, "yyyy-MM-dd");

      const payload = isCustom
        ? {
            customerProfileId,
            mealCategoryId: values.mealCategoryId,
            deliveryAddressId: values.deliveryAddressId,
            ...commonPaymentFields,
            startDate: startDateStr,
            basePrice: values.basePrice!,
            taxPercent: values.taxPercent ?? 0,
            taxAmount: values.taxAmount ?? 0,
            totalAmount: values.totalAmount!,
            pauseCredits: values.pauseCredits!,
            endDate: format(values.endDate!, "yyyy-MM-dd"),
            ...(franchiseId ? { franchiseId } : {}),
            // Past date fields
            ...(values.pastDateEnabled ? {
              pastDateEnabled: true,
              pastDayStatuses: values.pastDayStatuses,
              skipStartDateCheck: true,
            } : {}),
            // Delivery charge fields (Req 6.1–6.5, 12.4)
            deliveryCharge: deliveryCharge ?? 0,
            autoCalculatedDeliveryCharge: autoCalculatedDeliveryCharge ?? undefined,
          }
        : {
            customerProfileId,
            mealCategoryId: values.mealCategoryId,
            deliveryAddressId: values.deliveryAddressId,
            ...commonPaymentFields,
            startDate: startDateStr,
            planId: values.planId!,
            ...(franchiseId ? { franchiseId } : {}),
            // Past date fields
            ...(values.pastDateEnabled ? {
              pastDateEnabled: true,
              pastDayStatuses: values.pastDayStatuses,
              skipStartDateCheck: true,
            } : {}),
            // Delivery charge fields (Req 6.1–6.5, 12.4)
            deliveryCharge: deliveryCharge ?? 0,
            autoCalculatedDeliveryCharge: autoCalculatedDeliveryCharge ?? undefined,
          };

      const res = await submitAction(payload, isCustom);

      if (res.success) {
        toast.success("Subscription created successfully!");
        reset({
          mode: "existing",
          startDate: minStartDate,
          paymentStatus: "Payment Pending",
          paymentReference: "",
          paymentNotes: "",
          taxPercent: 0,
          pastDateEnabled: false,
          pastDayStatuses: [],
          automationOverrideAcknowledged: false,
        });
        router.refresh();
      } else {
        toast.error(res.error ?? "Failed to create subscription.");
      }
    });
  };

  /** Handles PastDayStatusPopup confirmation (Req 3.6) */
  const handlePastDayStatusConfirm = (entries: { date: string; mealStatus: "Delivered" | "Skipped" | null; mealType: "VEG" | "EGG" | "CHICKEN" | null; deliveryAddress: "Primary" | "Secondary" | null }[]) => {
    setShowPastDayStatusPopup(false);
    const formData = pendingFormDataRef.current;
    if (!formData) return;

    // The popup validates all entries are complete before calling onConfirm,
    // so it's safe to treat them as PastDayStatus (non-null mealStatus)
    const validEntries = entries as PastDayStatus[];

    // Store past day statuses in form state
    setValue("pastDayStatuses", validEntries);

    // Proceed with submission using the stored form data + past day entries
    performSubmission({ ...formData, pastDayStatuses: validEntries });
    pendingFormDataRef.current = null;
  };

  /** Handles PastDayStatusPopup cancellation (Req 3.7) */
  const handlePastDayStatusCancel = () => {
    setShowPastDayStatusPopup(false);
    pendingFormDataRef.current = null;
  };

  return (
    <Card className="overflow-hidden border-border/70 shadow-sm">
      <CardHeader className="space-y-0 border-b bg-muted/20">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-xl">Add New Subscription</CardTitle>
            <CardDescription className="mt-1 max-w-2xl">
              Create a new subscription for this customer. If they already have
              an active plan, the new one will be queued as PENDING.
            </CardDescription>
          </div>
          <Badge
            className={cn(
              "w-fit shrink-0 px-3 py-1 text-xs font-semibold",
              willBePending
                ? "bg-amber-500 hover:bg-amber-500"
                : "bg-emerald-500 hover:bg-emerald-500",
            )}
          >
            Will be: {willBePending ? "PENDING" : "ACTIVE"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-5 sm:p-6">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* ── Mode toggle ── */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Subscription Mode</Label>
            <Controller
              control={control}
              name="mode"
              render={({ field }) => (
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl"
                >
                  <Label
                    htmlFor="mode-existing"
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors hover:bg-muted/40",
                      field.value === "existing" && "border-primary bg-primary/5",
                    )}
                  >
                    <RadioGroupItem value="existing" id="mode-existing" />
                    <span>
                      <span className="block font-medium">Existing Plan</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        Use an active plan template
                      </span>
                    </span>
                  </Label>
                  <Label
                    htmlFor="mode-custom"
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors hover:bg-muted/40",
                      field.value === "custom" && "border-primary bg-primary/5",
                    )}
                  >
                    <RadioGroupItem value="custom" id="mode-custom" />
                    <span>
                      <span className="block font-medium">Custom Plan</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        Migration or partial term
                      </span>
                    </span>
                  </Label>
                </RadioGroup>
              )}
            />
          </div>

          <Separator />

          {/* ── Existing Plan fields ── */}
          {mode === "existing" && (
            <div className="space-y-4">
              <div className="max-w-md space-y-2">
                <Label>Plan</Label>
                <Controller
                  control={control}
                  name="planId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Select a subscription plan" />
                      </SelectTrigger>
                      <SelectContent>
                        {subscriptionPlans.map((plan) => (
                          <SelectItem key={plan.id} value={plan.id}>
                            {plan.name} — ₹{plan.price} &nbsp;({plan.duration_days} days)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.planId && (
                  <p className="text-xs text-destructive">{errors.planId.message}</p>
                )}
              </div>

              {selectedPlan && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Card className="border-border/70 bg-background shadow-none">
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                        <IndianRupee className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Price
                        </p>
                        <p className="text-base font-semibold">
                          ₹{selectedPlan.price}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 bg-background shadow-none">
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                        <Clock3 className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Duration
                        </p>
                        <p className="text-base font-semibold">
                          {selectedPlan.duration_days} days
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 bg-background shadow-none">
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                        <PauseCircle className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Pause Credits
                        </p>
                        <p className="text-base font-semibold">
                          {selectedPlan.pause_credits}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          )}

          {/* ── Custom Plan fields ── */}
          {mode === "custom" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Base Price (₹)</Label>
                  <Controller
                    control={control}
                    name="basePrice"
                    render={({ field }) => (
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === "" ? undefined : parseFloat(e.target.value),
                          )
                        }
                      />
                    )}
                  />
                  {errors.basePrice && (
                    <p className="text-xs text-destructive">{errors.basePrice.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Tax %</Label>
                  <Controller
                    control={control}
                    name="taxPercent"
                    render={({ field }) => (
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        placeholder="0"
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === "" ? undefined : parseFloat(e.target.value),
                          )
                        }
                      />
                    )}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Pause Credits</Label>
                  <Controller
                    control={control}
                    name="pauseCredits"
                    render={({ field }) => (
                      <Input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === "" ? undefined : parseInt(e.target.value, 10),
                          )
                        }
                      />
                    )}
                  />
                  {errors.pauseCredits && (
                    <p className="text-xs text-destructive">{errors.pauseCredits.message}</p>
                  )}
                </div>
              </div>

              {/* Auto-calculated read-only fields */}
              <div className="grid gap-3 sm:grid-cols-2">
                <Card className="border-border/70 bg-muted/20 shadow-none">
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                      <IndianRupee className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Tax Amount
                      </p>
                      <p className="text-base font-semibold">
                        {basePrice !== undefined && taxPercent !== undefined
                          ? `₹ ${(basePrice * (taxPercent / 100)).toFixed(2)}`
                          : "—"}
                      </p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-border/70 bg-muted/20 shadow-none">
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                      <IndianRupee className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Total Amount
                      </p>
                      <p className="text-base font-semibold">
                        {basePrice !== undefined && taxPercent !== undefined
                          ? `₹ ${(basePrice + basePrice * ((taxPercent ?? 0) / 100)).toFixed(2)}`
                          : "—"}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>

            </div>
          )}

          {/* ── Common fields ── */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {/* Past Date Mode Toggle — only visible when no active subscription (Req 1.6) */}
            {activeSubscription === null && (
              <div className="col-span-full space-y-2">
                <div className="flex items-center gap-3">
                  <Controller
                    control={control}
                    name="pastDateEnabled"
                    render={({ field }) => (
                      <Switch
                        id="past-date-toggle"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={pastDateToggleDisabled}
                      />
                    )}
                  />
                  <Label
                    htmlFor="past-date-toggle"
                    className={cn(
                      "text-sm font-medium",
                      pastDateToggleDisabled && "text-muted-foreground",
                    )}
                  >
                    Past date start date
                  </Label>
                </div>
                {pastDateToggleDisabled && (
                  <p className="text-xs text-muted-foreground">
                    No valid past dates available
                  </p>
                )}
              </div>
            )}

            {/* Start Date */}
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Controller
                control={control}
                name="startDate"
                render={({ field }) => (
                  <Popover
                    open={isStartDateOpen}
                    onOpenChange={setIsStartDateOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          "h-10 w-full justify-start text-left font-normal",
                          !field.value && "text-muted-foreground",
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {field.value ? format(field.value, "PPP") : "Pick start date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        defaultMonth={
                          field.value ??
                          (pastDateEnabled
                            ? parseISODateString(pastDateRange.start)
                            : futureMinDate)
                        }
                        selected={field.value}
                        onSelect={(date) => {
                          if (!date) return;
                          field.onChange(date);
                          setIsStartDateOpen(false);
                        }}
                        disabled={isDateDisabled}
                      />
                    </PopoverContent>
                  </Popover>
                )}
              />
              <p className="text-xs text-muted-foreground">
                {pastDateEnabled ? (
                  <>
                    Selectable range:{" "}
                    <span className="font-medium">
                      {pastDateRange.start} to {pastDateRange.end}
                    </span>
                  </>
                ) : (
                  <>
                    Earliest allowed:{" "}
                    <span className="font-medium">{format(futureMinDate, "PPP")}</span>
                  </>
                )}
              </p>
            </div>

            {mode === "custom" && (
              <div className="space-y-2">
                <Label>End Date</Label>
                <Controller
                  control={control}
                  name="endDate"
                  render={({ field }) => (
                    <Popover
                      open={isEndDateOpen}
                      onOpenChange={setIsEndDateOpen}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className={cn(
                            "h-10 w-full justify-start text-left font-normal",
                            !field.value && "text-muted-foreground",
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {field.value ? format(field.value, "PPP") : "Pick end date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          defaultMonth={field.value ?? startDate ?? minStartDate}
                          selected={field.value}
                          onSelect={(date) => {
                            if (!date) return;
                            field.onChange(date);
                            setIsEndDateOpen(false);
                          }}
                          disabled={(date) => date < (startDate ?? minStartDate)}
                        />
                      </PopoverContent>
                    </Popover>
                  )}
                />
                {errors.endDate && (
                  <p className="text-xs text-destructive">{errors.endDate.message}</p>
                )}
                {watch("endDate") && startDate && (
                  <p className="text-xs text-muted-foreground">
                    Total days:{" "}
                    <span className="font-semibold">
                      {Math.ceil(
                        (watch("endDate")!.getTime() - startDate.getTime()) /
                          (1000 * 60 * 60 * 24),
                      ) + 1}
                    </span>
                  </p>
                )}
              </div>
            )}

            {/* Meal Preference */}
            <div className="space-y-2">
              <Label>Meal Preference</Label>
              <Controller
                control={control}
                name="mealCategoryId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Select meal category" />
                    </SelectTrigger>
                    <SelectContent>
                      {mealCategories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.mealCategoryId && (
                <p className="text-xs text-destructive">
                  {errors.mealCategoryId.message}
                </p>
              )}
            </div>

            {/* Payment Status */}
            <div className="space-y-2">
              <Label>Payment Status</Label>
              <Controller
                control={control}
                name="paymentStatus"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Payment Collected">
                        Payment Collected
                      </SelectItem>
                      <SelectItem value="Payment Pending">
                        Payment Pending
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            {/* Payment Reference (optional audit trail) */}
            {paymentStatus === "Payment Collected" && (
              <div className="space-y-2">
                <Label>
                  Payment Reference{" "}
                  <span className="text-muted-foreground font-normal text-xs">
                    (optional)
                  </span>
                </Label>
                <Controller
                  control={control}
                  name="paymentReference"
                  render={({ field }) => (
                    <Input
                      {...field}
                      placeholder="e.g. UPI ref, cheque no."
                      className="h-10"
                    />
                  )}
                />
              </div>
            )}

            {/* Delivery Address */}
            <div className="space-y-2 md:col-span-2 xl:col-span-1">
              <Label>Delivery Address</Label>
              {addresses.length === 0 ? (
                <p className="text-sm text-destructive">
                  No addresses found for this customer. Please add an address first.
                </p>
              ) : (
                <Controller
                  control={control}
                  name="deliveryAddressId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Select address" />
                      </SelectTrigger>
                      <SelectContent>
                        {addresses.map((addr) => (
                          <SelectItem key={addr.id} value={addr.id}>
                            {addr.tag}: {addr.street_1}, {addr.city} —{" "}
                            {addr.pincode}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
              {errors.deliveryAddressId && (
                <p className="text-xs text-destructive">
                  {errors.deliveryAddressId.message}
                </p>
              )}
            </div>
          </div>

          {/* Payment Notes */}
          <div className="space-y-2">
            <Label>
              Payment Notes{" "}
              <span className="text-muted-foreground font-normal text-xs">
                (optional, internal)
              </span>
            </Label>
            <Controller
              control={control}
              name="paymentNotes"
              render={({ field }) => (
                <Input
                  {...field}
                  placeholder="Any internal notes about this payment"
                  className="h-10 max-w-xl"
                />
              )}
            />
          </div>

          <Separator />

          {/* ── Delivery Charge Section (Req 8.1–8.8) ── */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-semibold">Delivery Charges</Label>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isCalculatingDelivery}
                onClick={handleCalculateDeliveryCharge}
              >
                {isCalculatingDelivery && (
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                )}
                Calculate Delivery Charges
              </Button>

              <div className="flex-1 max-w-xs space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Delivery Charge (₹)
                </Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  className="h-9"
                  value={deliveryChargeInput}
                  onChange={(e) => handleDeliveryChargeInput(e.target.value)}
                />
              </div>
            </div>

            {deliveryChargeError && (
              <p className="text-xs text-destructive">{deliveryChargeError}</p>
            )}

            {distanceKm !== null && ratePerKm !== null && (
              <p className="text-xs text-muted-foreground">
                Distance: {distanceKm.toFixed(2)} km × ₹{ratePerKm.toFixed(2)}/km
              </p>
            )}

            {/* Total Payable display */}
            {(mode === "existing" ? selectedPlan : basePrice !== undefined) && (
              <Card className="border-border/70 bg-muted/20 shadow-none">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                    <IndianRupee className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Total Payable (Plan + Delivery)
                    </p>
                    <p className="text-base font-semibold">
                      ₹{" "}
                      {mode === "existing" && selectedPlan
                        ? (selectedPlan.price + (deliveryCharge ?? 0)).toFixed(2)
                        : basePrice !== undefined && taxPercent !== undefined
                          ? (
                              basePrice +
                              parseFloat((basePrice * ((taxPercent ?? 0) / 100)).toFixed(2)) +
                              (deliveryCharge ?? 0)
                            ).toFixed(2)
                          : "—"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <Separator />

          {/* ── 5 PM IST Cutoff Alert with Automation Override (Req 4.1–4.6) ── */}
          {showAutomationAlert && (
            <Alert className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-amber-800 dark:text-amber-200">
                After-cutoff subscription
              </AlertTitle>
              <AlertDescription className="mt-1 text-amber-700 dark:text-amber-300">
                Operations will need to re-run the delivery automation for this subscription to take effect.
              </AlertDescription>
              <div className="mt-3 flex items-center gap-2">
                <Controller
                  control={control}
                  name="automationOverrideAcknowledged"
                  render={({ field }) => (
                    <Checkbox
                      id="automation-override-ack"
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                  )}
                />
                <Label
                  htmlFor="automation-override-ack"
                  className="text-sm font-normal text-amber-800 dark:text-amber-200 cursor-pointer"
                >
                  I acknowledge that operations will re-run automation
                </Label>
              </div>
            </Alert>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              A unique subscription code will be auto-generated.
            </p>
            <Button
              type="submit"
              disabled={isPending || addresses.length === 0 || (showAutomationAlert && !automationOverrideAcknowledged)}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Subscription
            </Button>
          </div>
        </form>

        {/* ── Past Day Status Popup (Req 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7) ── */}
        <PastDayStatusPopup
          open={showPastDayStatusPopup}
          startDate={startDate ? format(startDate, "yyyy-MM-dd") : ""}
          endDate={pastDayStatusBoundary(new Date())}
          onConfirm={handlePastDayStatusConfirm}
          onCancel={handlePastDayStatusCancel}
        />
      </CardContent>
    </Card>
  );
}
