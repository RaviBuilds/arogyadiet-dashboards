"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { addDays, format, startOfDay } from "date-fns";
import { useRouter } from "next/navigation";
import { CalendarIcon, Clock3, IndianRupee, Loader2, PauseCircle, AlertTriangle, Truck, Wallet } from "lucide-react";

import { addSubscription } from "@/actions/admin-actions/adminSubscriptionActions";
import {
  MISC_CHARGE_LABEL_MAX_LENGTH,
  validateMiscChargeAmount,
  validateMiscChargeLabel,
} from "@/lib/onboarding/miscCharge";
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

/**
 * One line of the amount breakup. Mirrors the identically-named helper in
 * `QuickOnboardingForm`, so the onboarding wizard and this form present the
 * breakup the same way (meal-subscription-partial-payment).
 */
function AmountRow({
  label,
  amount,
  note,
}: {
  label: string;
  amount: number;
  note?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-emerald-800">
        {label}
        {note && <span className="ml-1 text-emerald-600">({note})</span>}
      </span>
      <span className="text-xs font-medium tabular-nums text-emerald-900">
        ₹
        {amount.toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </span>
    </div>
  );
}

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
  /**
   * Last server rejection, kept visible until the next submit.
   * The outstanding-balance gate reports an amount owed, and a toast that
   * vanishes after a few seconds is the wrong place for a figure the admin has
   * to collect against.
   */
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ─── Delivery Charge State (Req 8.1–8.8) ──────────────────────────────────
  const [deliveryCharge, setDeliveryCharge] = useState<number | null>(null);
  const [deliveryChargeInput, setDeliveryChargeInput] = useState<string>("");
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [ratePerKm, setRatePerKm] = useState<number | null>(null);
  const [deliveryChargeError, setDeliveryChargeError] = useState<string | null>(null);
  const [isCalculatingDelivery, setIsCalculatingDelivery] = useState(false);
  /** Tracks the system-calculated delivery charge for admin override audit (Req 12.4) */
  const [autoCalculatedDeliveryCharge, setAutoCalculatedDeliveryCharge] = useState<number | null>(null);

  // ─── Miscellaneous charge + payment collection ────────────────────────────
  // meal-subscription-partial-payment: parity with the Quick Onboarding wizard,
  // so adding a subscription for an existing customer offers the same options as
  // onboarding a new one. Held in local state alongside the delivery charge
  // rather than in the Zod form, matching how that field is already handled.
  const [miscChargeInput, setMiscChargeInput] = useState<string>("");
  const [miscCharge, setMiscCharge] = useState<number | null>(null);
  const [miscChargeLabel, setMiscChargeLabel] = useState<string>("");
  const [miscChargeError, setMiscChargeError] = useState<string | null>(null);
  const [miscChargeLabelError, setMiscChargeLabelError] = useState<string | null>(null);

  const [customerPaidFullAmount, setCustomerPaidFullAmount] = useState(true);
  const [advanceAmountInput, setAdvanceAmountInput] = useState<string>("");
  const [advanceAmount, setAdvanceAmount] = useState<number | null>(null);
  const [advanceAmountError, setAdvanceAmountError] = useState<string | null>(null);

  /**
   * Snapshot of the figures the admin signed off on, not a boolean.
   * `pricingConfirmed` is derived by comparing it to the live figures, so ANY
   * later edit invalidates the confirmation automatically — including a field
   * added here later whose author forgets to wire up a reset.
   */
  const [confirmedPricingKey, setConfirmedPricingKey] = useState<string | null>(null);

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

  // ─── Amount breakup + payment collection (meal-subscription-partial-payment) ─
  // The plan portion differs by mode: an existing plan's gross price, or the
  // custom plan's base + computed tax.
  const planAmount =
    mode === "existing"
      ? (selectedPlan?.price ?? 0)
      : basePrice !== undefined
        ? parseFloat(
            (basePrice + basePrice * ((taxPercent ?? 0) / 100)).toFixed(2),
          )
        : 0;
  const deliveryAmount = deliveryCharge ?? 0;
  const miscAmount = miscCharge ?? 0;
  const totalPayable = parseFloat(
    (planAmount + deliveryAmount + miscAmount).toFixed(2),
  );

  const hasPlanSelection = mode === "existing" ? Boolean(selectedPlan) : planAmount > 0;
  // Partial payment only means anything once money has actually been collected.
  const isPaymentCollected = paymentStatus === "Payment Collected";
  const showPaymentCollection = isPaymentCollected && hasPlanSelection;

  const advanceAmountValue = advanceAmount ?? 0;
  // Paise arithmetic: subtracting rupees as floats leaves ~1e-13 residue, which
  // would render a settled plan as owing a fraction of a paisa.
  const balanceRemaining =
    Math.round(totalPayable * 100 - advanceAmountValue * 100) / 100;

  // The delivery charge must be ANSWERED, not merely left at its default. A typed
  // 0 is a valid answer ("not charged"); an empty box is an unanswered question,
  // and silently treating both as 0 under-billed whenever the admin just forgot.
  // Derived from the raw input string, since "" already distinguishes blank from 0.
  const deliveryChargeMissing = deliveryChargeInput.trim() === "";

  const advanceAmountMissing =
    showPaymentCollection &&
    !customerPaidFullAmount &&
    (advanceAmount === null || advanceAmount <= 0);

  const hasChargeErrors =
    Boolean(miscChargeError) ||
    Boolean(miscChargeLabelError) ||
    Boolean(advanceAmountError);

  // Every figure being signed off on. Changing any of them yields a different key,
  // which invalidates a prior confirmation without needing a reset effect.
  const pricingKey = [
    mode,
    planId ?? "",
    planAmount,
    deliveryAmount,
    miscAmount,
    miscChargeLabel.trim(),
    customerPaidFullAmount ? "full" : "advance",
    advanceAmount ?? "",
    paymentStatus,
  ].join("|");

  const pricingConfirmed =
    confirmedPricingKey !== null && confirmedPricingKey === pricingKey;

  // Confirmation is only demanded where a part payment is actually on the table.
  const requiresPricingConfirmation =
    showPaymentCollection && !customerPaidFullAmount;
  const canConfirmPricing =
    !hasChargeErrors &&
    !deliveryChargeMissing &&
    !advanceAmountMissing &&
    hasPlanSelection;

  /**
   * Toggles "Customer paid full amount".
   *
   * Clears the advance in the handler rather than an effect: it is a consequence
   * of the click, not a synchronisation with an external system, and doing it in
   * an effect would trip `react-hooks/set-state-in-effect`.
   */
  const handlePaidFullAmountChange = (checked: boolean) => {
    setCustomerPaidFullAmount(checked);
    if (checked) {
      setAdvanceAmountInput("");
      setAdvanceAmount(null);
      setAdvanceAmountError(null);
    }
  };

  const handleMiscChargeInput = (raw: string) => {
    setMiscChargeInput(raw);
    const amountError = validateMiscChargeAmount(raw);
    setMiscChargeError(amountError);
    const next = amountError !== null || raw.trim() === "" ? null : Number(raw);
    setMiscCharge(next);
    // The name becomes mandatory the moment an amount is charged.
    setMiscChargeLabelError(validateMiscChargeLabel(miscChargeLabel, next));
  };

  const handleMiscChargeLabelInput = (raw: string) => {
    setMiscChargeLabel(raw);
    setMiscChargeLabelError(validateMiscChargeLabel(raw, miscCharge));
  };

  const handleAdvanceAmountInput = (raw: string) => {
    setAdvanceAmountInput(raw);

    if (raw.trim() === "") {
      setAdvanceAmount(null);
      setAdvanceAmountError(null);
      return;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setAdvanceAmount(null);
      setAdvanceAmountError("Advance amount must be a valid number");
      return;
    }
    if (parsed <= 0) {
      setAdvanceAmount(null);
      setAdvanceAmountError("Advance amount must be greater than ₹0");
      return;
    }
    const decimals = raw.split(".")[1];
    if (decimals && decimals.length > 2) {
      setAdvanceAmount(null);
      setAdvanceAmountError("Advance amount cannot have more than 2 decimal places");
      return;
    }
    if (Math.round(parsed * 100) > Math.round(totalPayable * 100)) {
      setAdvanceAmount(null);
      setAdvanceAmountError(
        `Advance cannot exceed the total payable of ₹${totalPayable.toFixed(2)}`,
      );
      return;
    }

    setAdvanceAmount(parsed);
    setAdvanceAmountError(null);
  };

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
      // Drop the "N km × ₹R/km" note too. Left behind, it kept describing a
      // distance-derived charge next to a ₹0.00 line in the breakup — a figure
      // the customer would be quoted from.
      setDistanceKm(null);
      setRatePerKm(null);
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
    // The submit button is already disabled in these cases; this catches a submit
    // arriving by any other route (Enter key, a stale render) so the server never
    // has to reject it after the fact.
    if (deliveryChargeMissing) {
      toast.error("Enter the delivery charge (enter 0 if delivery is free).");
      return;
    }
    if (hasChargeErrors) {
      toast.error(
        miscChargeLabelError ??
          miscChargeError ??
          advanceAmountError ??
          "Correct the charge details before creating the subscription.",
      );
      return;
    }
    if (advanceAmountMissing) {
      toast.error("Enter the advance amount collected from the customer.");
      return;
    }
    if (requiresPricingConfirmation && !pricingConfirmed) {
      toast.error("Confirm the pricing before creating the subscription.");
      return;
    }

    startTransition(async () => {
      const isCustom = values.mode === "custom";

      const commonPaymentFields = {
        paymentStatus: values.paymentStatus,
        paymentReference: values.paymentReference || undefined,
        paymentNotes: values.paymentNotes || undefined,
      };

      /**
       * Miscellaneous charge + payment collection, identical for both modes
       * (meal-subscription-partial-payment).
       *
       * `customerPaidFullAmount` is forced true unless payment was actually
       * collected, so a "Payment Pending" subscription can never arrive at the
       * server claiming a partial collection.
       */
      const extraChargeAndPaymentFields = {
        miscCharge: miscCharge ?? 0,
        miscChargeLabel:
          miscCharge && miscCharge > 0 ? miscChargeLabel.trim() : undefined,
        customerPaidFullAmount: showPaymentCollection
          ? customerPaidFullAmount
          : true,
        advanceAmountPaid:
          showPaymentCollection && !customerPaidFullAmount
            ? (advanceAmount ?? 0)
            : undefined,
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
            ...extraChargeAndPaymentFields,
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
            ...extraChargeAndPaymentFields,
          };

      const res = await submitAction(payload, isCustom);

      if (res.success) {
        setSubmitError(null);
        toast.success("Subscription created successfully!");
        // `reset` only clears react-hook-form fields. The charge and payment
        // figures live in local state, so they must be cleared explicitly —
        // otherwise the next subscription would inherit the previous one's
        // miscellaneous charge and advance.
        setMiscChargeInput("");
        setMiscCharge(null);
        setMiscChargeLabel("");
        setMiscChargeError(null);
        setMiscChargeLabelError(null);
        setCustomerPaidFullAmount(true);
        setAdvanceAmountInput("");
        setAdvanceAmount(null);
        setAdvanceAmountError(null);
        setConfirmedPricingKey(null);
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
        const message = res.error ?? "Failed to create subscription.";
        // Kept alongside the toast, not instead of it: a toast disappears, and a
        // rejection like an outstanding balance names an amount the admin needs
        // to read, act on, and possibly quote to the customer.
        setSubmitError(message);
        toast.error(message);
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
                <Label
                  htmlFor="addSubDeliveryCharge"
                  className="text-xs text-muted-foreground"
                >
                  Delivery Charge (₹) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="addSubDeliveryCharge"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  className="h-9"
                  aria-invalid={
                    Boolean(deliveryChargeError) || deliveryChargeMissing
                  }
                  aria-describedby="addSubDeliveryCharge-help"
                  value={deliveryChargeInput}
                  onChange={(e) => handleDeliveryChargeInput(e.target.value)}
                />
              </div>
            </div>

            <p
              id="addSubDeliveryCharge-help"
              className="text-xs text-muted-foreground"
            >
              Required. Press Calculate, or type the amount. Enter 0 if delivery is
              not being charged.
            </p>

            {deliveryChargeError && (
              <p className="text-xs text-destructive">{deliveryChargeError}</p>
            )}

            {!deliveryChargeError && deliveryChargeMissing && (
              <p className="text-xs text-destructive">
                Delivery charge is required. Enter 0 if not charged.
              </p>
            )}

            {distanceKm !== null && ratePerKm !== null && (
              <p className="text-xs text-muted-foreground">
                Distance: {distanceKm.toFixed(2)} km × ₹{ratePerKm.toFixed(2)}/km
              </p>
            )}

            {/* ── Miscellaneous charge: admin-named, optional ──
                meal-subscription-partial-payment. Applies to BOTH modes; the
                admin-entered name is what the customer's invoice prints. */}
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-semibold">
                  Miscellaneous Charges
                </Label>
                <span className="text-xs text-muted-foreground">Optional</span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
                <div className="space-y-1">
                  <Label
                    htmlFor="addSubMiscChargeLabel"
                    className="text-xs text-muted-foreground"
                  >
                    Charge name
                  </Label>
                  <Input
                    id="addSubMiscChargeLabel"
                    type="text"
                    placeholder="e.g. Additional product charges"
                    maxLength={MISC_CHARGE_LABEL_MAX_LENGTH}
                    className="h-9"
                    aria-invalid={Boolean(miscChargeLabelError)}
                    value={miscChargeLabel}
                    onChange={(e) => handleMiscChargeLabelInput(e.target.value)}
                  />
                </div>

                <div className="space-y-1 sm:w-40">
                  <Label
                    htmlFor="addSubMiscCharge"
                    className="text-xs text-muted-foreground"
                  >
                    Amount (₹)
                  </Label>
                  <Input
                    id="addSubMiscCharge"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    className="h-9"
                    aria-invalid={Boolean(miscChargeError)}
                    value={miscChargeInput}
                    onChange={(e) => handleMiscChargeInput(e.target.value)}
                  />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                This name is printed on the customer&apos;s invoice exactly as typed.
              </p>

              {miscChargeLabelError && (
                <p className="text-xs text-destructive">{miscChargeLabelError}</p>
              )}
              {miscChargeError && (
                <p className="text-xs text-destructive">{miscChargeError}</p>
              )}
            </div>

            {/* ── Amount breakup ── */}
            {hasPlanSelection && (
              <div className="space-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3">
                <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-emerald-600">
                  Amount breakup
                </p>
                <AmountRow
                  label={
                    mode === "existing" && selectedPlan
                      ? `${selectedPlan.name} (${selectedPlan.duration_days} days)`
                      : "Custom plan (base + tax)"
                  }
                  amount={planAmount}
                />
                <AmountRow
                  label="Delivery charges"
                  amount={deliveryAmount}
                  note={
                    distanceKm !== null && ratePerKm !== null
                      ? `${distanceKm.toFixed(2)} km × ₹${ratePerKm.toFixed(2)}/km`
                      : undefined
                  }
                />
                {miscAmount > 0 && (
                  <AmountRow
                    label={miscChargeLabel.trim() || "Miscellaneous charges"}
                    amount={miscAmount}
                  />
                )}
                <div className="flex items-baseline justify-between border-t border-emerald-200 pt-1.5">
                  <span className="text-sm font-semibold text-emerald-900">
                    Total Payable
                  </span>
                  <span className="text-sm font-bold tabular-nums text-emerald-900">
                    ₹
                    {totalPayable.toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>

                {showPaymentCollection && !customerPaidFullAmount && advanceAmount !== null && (
                  <div className="mt-1 space-y-1 border-t border-emerald-200 pt-1.5">
                    <AmountRow label="Advance collected now" amount={advanceAmount} />
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-xs font-bold text-amber-700">
                        Balance due
                      </span>
                      <span className="text-xs font-bold tabular-nums text-amber-700">
                        ₹
                        {balanceRemaining.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── How much was actually collected ──
                Only once Payment Status is "Payment Collected": a part payment of
                nothing is just the existing Pending case. */}
            {showPaymentCollection && (
              <div className="space-y-3 border-t pt-4">
                <label className="flex cursor-pointer items-start gap-2 select-none">
                  <Checkbox
                    id="addSubCustomerPaidFullAmount"
                    checked={customerPaidFullAmount}
                    onCheckedChange={(checked) =>
                      handlePaidFullAmountChange(checked === true)
                    }
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold">
                      Customer paid full amount
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Uncheck if the customer paid only an advance and will settle the
                      balance later.
                    </span>
                  </span>
                </label>

                {!customerPaidFullAmount && (
                  <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                    <div className="space-y-1 sm:max-w-xs">
                      <Label
                        htmlFor="addSubAdvanceAmount"
                        className="text-xs font-medium text-amber-800"
                      >
                        Advance amount paid (₹){" "}
                        <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="addSubAdvanceAmount"
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        className="h-9 bg-background"
                        aria-invalid={Boolean(advanceAmountError)}
                        value={advanceAmountInput}
                        onChange={(e) => handleAdvanceAmountInput(e.target.value)}
                      />
                    </div>

                    {advanceAmountError && (
                      <p className="text-xs text-destructive">{advanceAmountError}</p>
                    )}

                    <div className="flex items-baseline justify-between gap-3 border-t border-amber-200 pt-2">
                      <span className="text-xs font-semibold text-amber-900">
                        Balance remaining
                      </span>
                      <span className="text-sm font-bold tabular-nums text-amber-900">
                        ₹
                        {(advanceAmount === null ? totalPayable : balanceRemaining)
                          .toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                      </span>
                    </div>

                    {/* Confirmation gate — only for a part payment, where the
                        figures carry a consequence the admin should sign off on. */}
                    <div className="flex flex-col gap-2 border-t border-amber-200 pt-2 sm:flex-row sm:items-center sm:justify-between">
                      {pricingConfirmed ? (
                        <p className="text-xs font-semibold text-emerald-700">
                          ✓ Pricing confirmed
                        </p>
                      ) : (
                        <p className="text-xs text-amber-800">
                          Review the amounts, then confirm to enable creation.
                        </p>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant={pricingConfirmed ? "outline" : "default"}
                        disabled={pricingConfirmed || !canConfirmPricing}
                        onClick={() => setConfirmedPricingKey(pricingKey)}
                      >
                        {pricingConfirmed
                          ? "Pricing confirmed"
                          : "I have confirmed the pricing"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
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

          {/* Persistent rejection reason. The outstanding-balance gate
              (meal-subscription-partial-payment, Phase 5.4) names an amount the
              admin has to act on, which a transient toast loses. */}
          {submitError && (
            <Alert
              role="alert"
              className="border-destructive/30 bg-destructive/5 text-destructive"
            >
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-destructive">
                {submitError}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              A unique subscription code will be auto-generated.
            </p>
            <Button
              type="submit"
              disabled={
                isPending ||
                addresses.length === 0 ||
                (showAutomationAlert && !automationOverrideAcknowledged) ||
                // meal-subscription-partial-payment: a charge the admin typed must
                // be valid, the delivery charge must be answered, an advance must be
                // entered, and a part payment must be signed off — otherwise the
                // server would reject after the fact.
                hasChargeErrors ||
                deliveryChargeMissing ||
                advanceAmountMissing ||
                (requiresPricingConfirmation && !pricingConfirmed)
              }
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
