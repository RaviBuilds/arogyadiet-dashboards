"use client";

// src/shared/components/admin/customers/QuickOnboardingForm.tsx
// UI/UX refresh — all data logic and validation unchanged.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  User,
  Utensils,
  MapPin,
  CreditCard,
  Check,
  Sparkles,
  Eye,
  EyeOff,
  Truck,
} from "lucide-react";

import { TempPinField } from "@/shared/components/admin/TempPinField";
import { isValidPinFormat } from "@/lib/pin/pinUtils";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { Checkbox } from "@/shared/components/ui/checkbox";
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
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/shared/components/ui/alert";

import {
  AddressCaptureMap,
  emptyAddressCaptureValue,
  type AddressCaptureValidity,
  type AddressCaptureValue,
} from "@/shared/components/address/AddressCaptureMap";
import { CUSTOMER_CATEGORIES } from "@/lib/onboarding/category";
import {
  earliestStartDate,
  getPastDateRange,
  pastDayStatusBoundary,
  ONBOARDING_CUTOFF_HOUR_IST,
} from "@/lib/onboarding/cutoff";
import { istHourOf, istDateStringOf, addDaysToISODate } from "@/lib/dates/ist";
import {
  backdatedStayRange,
  forwardStayRange,
  describeBackdatedStayOutcome,
} from "@/lib/accommodation/backdatedStay";
import { PastDayStatusPopup } from "@/shared/components/admin/customers/PastDayStatusPopup";
import { onboardCustomerAction, checkMobileUniqueAction } from "@/actions/admin-actions/onboardingActions";
import { onboardAccommodationCustomerAction } from "@/actions/accommodationOnboardingActions";
import { calculateDeliveryChargeForAddressAction } from "@/actions/admin-actions/deliveryChargeActions";
import { resolveClinicForPincodeAction, getFranchiseDietitianAction } from "@/actions/pincodeActions";
import { listDietitiansForClinic } from "@/actions/admin-actions/dietitianAssignmentActions";
import { listActiveDietitiansForAdmin } from "@/actions/admin-actions/customerHealthLogActions";
import {
  COMPLETE_ADDRESS_TO_LOAD_DIETITIANS,
  NO_DIETITIAN_FOR_CLINIC,
} from "@/lib/dietitian/messages";
import { cn } from "@/lib/utils";
import type { KitProduct } from "@/types/kitProduct";
import type { DietitianAccount } from "@/types/dietitian";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";

/** A subscription plan option for the Category/Plan step (Req 4.4). */
export interface OnboardingPlan {
  id: string;
  name: string;
  price: number;
  durationDays: number;
}

export interface QuickOnboardingFormProps {
  plans: OnboardingPlan[];
  kitProducts: KitProduct[];
  serviceAreaPincodes: string[];
  /**
   * Whether this wizard is rendered inside the Franchise Portal
   * (dietitian-management, Req 7.6). A Franchise session shows its single
   * active Dietitian as read-only text for MEAL onboarding instead of an
   * editable dropdown.
   */
  isFranchiseSession?: boolean;
  /** The acting Franchise's id, required when `isFranchiseSession` is true, to resolve its single Dietitian. */
  franchiseId?: string | null;
}

const detailsSchema = z.object({
  fullName: z
    .string()
    .min(1, "Name is required.")
    .max(100, "Name must be at most 100 characters."),
  mobile: z
    .string()
    .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number."),
  gender: z.enum(["Male", "Female", "Other"], { message: "Select a gender." }),
  dietaryPreference: z.enum(["Veg", "Non-Veg"], {
    message: "Select a diet preference.",
  }),
  allergies: z
    .string()
    .max(500, "Allergies must be at most 500 characters.")
    .optional(),
  email: z
    .string()
    .max(254, "Email must be at most 254 characters.")
    .refine(
      (v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      "Enter a valid email address.",
    )
    .optional()
    .or(z.literal("")),
  isTestEmail: z.boolean().default(false),
  primaryCategory: z.enum(CUSTOMER_CATEGORIES),
  planId: z.string().uuid("Select a subscription plan.").optional(),
  kitProductId: z.string().uuid("Select a KIT product.").optional(),
  kitDurationDays: z.coerce.number().int("Kit duration must be a whole number.").positive("Kit duration must be at least 1 day.").optional(),
  startDate: z.string().min(1, "Start date is required."),
  initialMealPreference: z.enum(["VEG", "EGG", "CHICKEN"], {
    message: "Select an initial meal preference.",
  }),
  // Accommodation-specific fields (Req 1.1–1.9, 2.1–2.8)
  totalNights: z.coerce.number().int().min(1, "Must be at least 1 night.").max(365, "Cannot exceed 365 nights.").optional(),
  // Backdated_Stay_Toggle — unlocks Past_Stay_Start selection (Req 1.1, 1.3)
  backdatedStayEnabled: z.boolean().default(false),
  stayType: z.enum(["AC Villa", "Village Style Hut"]).optional(),
  occupancyType: z.enum(["Single", "Double"]).optional(),
  // Total_Stay_Amount inclusive of 18% GST (Req 4.2). Replaces the single
  // `paymentAmount` field for ACCOMMODATION onboarding.
  totalStayAmount: z.coerce.number().min(1, "Total stay amount must be at least ₹1.").max(9999999, "Total stay amount cannot exceed ₹99,99,999.").optional(),
  // Advance_Amount collected at onboarding; 0 means "no advance" (Req 4.3).
  advanceAmountPaid: z.coerce.number().min(0, "Advance amount cannot be negative.").max(9999999, "Advance amount cannot exceed ₹99,99,999.").optional(),
  isSharedPayment: z.boolean().default(false),
  paymentHostMobile: z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number.").optional().or(z.literal("")),
  paymentStatus: z.enum(["PAID", "PENDING"]),
  cutoffAcknowledged: z.boolean().default(false),
  pastDateEnabled: z.boolean().default(false),
  pastDayStatuses: z.array(z.any()).optional().default([]),
  automationOverrideAcknowledged: z.boolean().default(false),
  dietitianId: z.string().uuid("Select a valid dietitian.").optional(),
}).superRefine((data, ctx) => {
  // Client-side rejection of advance > total with the pinned field message
  // (Req 4.4), mirroring the server's `accommodationOnboardingSchema`.
  if (
    !data.isSharedPayment &&
    data.totalStayAmount != null &&
    data.advanceAmountPaid != null &&
    data.advanceAmountPaid > data.totalStayAmount
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["advanceAmountPaid"],
      message: "Advance amount cannot exceed the total stay amount.",
    });
  }
});

type DetailsFormValues = z.input<typeof detailsSchema>;

const STEPS = ["Details", "Category & Plan", "Address", "Payment & Review"] as const;
const ACCOMMODATION_STEPS = ["Details", "Category & Plan", "Payment & Review"] as const;
type StepIndex = 0 | 1 | 2 | 3;

const STEP_ICONS = [User, Utensils, MapPin, CreditCard] as const;
const ACCOMMODATION_STEP_ICONS = [User, Utensils, CreditCard] as const;

const STEP_FIELDS: Record<number, (keyof DetailsFormValues)[]> = {
  0: ["fullName", "mobile", "gender", "dietaryPreference", "allergies"],
  1: ["primaryCategory", "planId", "kitProductId", "kitDurationDays", "startDate", "initialMealPreference"],
  2: [],
  3: ["email", "paymentStatus"],
};

export function QuickOnboardingForm({
  plans,
  kitProducts,
  serviceAreaPincodes,
  isFranchiseSession = false,
  franchiseId = null,
}: QuickOnboardingFormProps) {
  const router = useRouter();
  const [isSubmitting, startTransition] = useTransition();
  const [step, setStep] = useState<StepIndex>(0);

  const now = useMemo(() => new Date(), []);
  const earliest = useMemo(() => earliestStartDate(now), [now]);
  const isAfterCutoff = useMemo(
    () => istHourOf(now) >= ONBOARDING_CUTOFF_HOUR_IST,
    [now],
  );
  const istToday = useMemo(() => istDateStringOf(now), [now]);
  const pastDateRange = useMemo(() => getPastDateRange(istToday), [istToday]);

  const [showPastDayPopup, setShowPastDayPopup] = useState(false);

  const [address, setAddress] = useState<AddressCaptureValue>(
    emptyAddressCaptureValue,
  );
  const [addressValidity, setAddressValidity] =
    useState<AddressCaptureValidity | null>(null);
  const [addressServerError, setAddressServerError] = useState<string | null>(null);
  const [addressTouched, setAddressTouched] = useState(false);

  const [tempPin, setTempPin] = useState("");
  const [tempPinError, setTempPinError] = useState<string | null>(null);
  const [showPin, setShowPin] = useState(false);

  // ─── Delivery Charge State (Req 7.1–7.7) ──────────────────────────────────
  const [deliveryCharge, setDeliveryCharge] = useState<number | null>(null);
  const [deliveryChargeInput, setDeliveryChargeInput] = useState<string>("");
  const [calculatedDeliveryCharge, setCalculatedDeliveryCharge] = useState<number | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [ratePerKm, setRatePerKm] = useState<number | null>(null);
  const [deliveryChargeError, setDeliveryChargeError] = useState<string | null>(null);
  const [isCalculatingDelivery, setIsCalculatingDelivery] = useState(false);

  // ─── Dietitian Dropdown State (dietitian-management, Req 7.1–7.6, 9.1–9.5) ─
  // MEAL (Core session): scoped to the resolved Clinic, loaded once the
  // address step resolves a Clinic.
  const [mealDietitians, setMealDietitians] = useState<DietitianAccount[]>([]);
  // The last Clinic we resolved+loaded Dietitians for. Kept in a ref (not state)
  // so updating it inside the load effect does not re-trigger the effect and
  // cancel the in-flight `listDietitiansForClinic` call before it resolves.
  const mealDietitianClinicIdRef = useRef<string | null>(null);
  const [isLoadingMealDietitians, setIsLoadingMealDietitians] = useState(false);
  // Franchise session (Req 7.6): read-only single Dietitian, resolved once
  // from the acting Franchise rather than the address's Clinic.
  const [franchiseDietitianName, setFranchiseDietitianName] = useState<string | null>(null);
  // ACCOMMODATION: unscoped list of every active Dietitian (Req 9.2).
  const [accommodationDietitians, setAccommodationDietitians] = useState<DietitianAccount[]>([]);
  const [isLoadingAccommodationDietitians, setIsLoadingAccommodationDietitians] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    trigger,
    setError,
    setValue,
    formState: { errors },
  } = useForm<DetailsFormValues>({
    resolver: zodResolver(detailsSchema),
    mode: "onTouched",
    defaultValues: {
      fullName: "",
      mobile: "",
      gender: undefined,
      dietaryPreference: undefined,
      allergies: "",
      email: "",
      isTestEmail: false,
      primaryCategory: "MEAL",
      planId: undefined,
      kitProductId: undefined,
      kitDurationDays: undefined,
      startDate: earliest,
      initialMealPreference: undefined,
      // Accommodation-specific defaults
      totalNights: undefined,
      backdatedStayEnabled: false,
      stayType: undefined,
      occupancyType: undefined,
      totalStayAmount: undefined,
      advanceAmountPaid: undefined,
      isSharedPayment: false,
      paymentHostMobile: "",
      paymentStatus: "PENDING",
      cutoffAcknowledged: false,
      pastDateEnabled: false,
      pastDayStatuses: [],
      automationOverrideAcknowledged: false,
      dietitianId: undefined,
    },
  });

  const values = useWatch({ control });
  const paymentStatus = values.paymentStatus;
  const cutoffAcknowledged = values.cutoffAcknowledged;
  const isTestEmail = values.isTestEmail;
  const primaryCategory = values.primaryCategory;
  const pastDateEnabled = values.pastDateEnabled;
  const startDate = values.startDate;
  const automationOverrideAcknowledged = values.automationOverrideAcknowledged;
  const selectedPlanId = values.planId;
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;
  const selectedKitProductId = values.kitProductId;
  const selectedKitProduct = kitProducts.find((k) => k.id === selectedKitProductId) ?? null;
  const addressResolved = Boolean(addressValidity?.canSave);

  // Accommodation-specific derived state (Req 1.1, 1.9, 2.1, 2.8, 3.1)
  const isAccommodation = primaryCategory === "ACCOMMODATION";
  const isSharedPayment = values.isSharedPayment ?? false;
  const backdatedStayEnabled = values.backdatedStayEnabled ?? false;

  // Backdated_Stay_Toggle date range + completion alert (Req 1.2, 1.3, 2.1, 2.3, 2.5)
  const accommodationForwardRange = useMemo(
    () => forwardStayRange(istToday),
    [istToday],
  );
  const accommodationBackdatedRange = useMemo(
    () => backdatedStayRange(istToday),
    [istToday],
  );
  const backdatedStayOutcome = useMemo(() => {
    if (
      !isAccommodation ||
      !backdatedStayEnabled ||
      !values.startDate ||
      !values.totalNights ||
      Number(values.totalNights) <= 0
    ) {
      return null;
    }
    return describeBackdatedStayOutcome(
      values.startDate,
      Number(values.totalNights),
      istToday,
    );
  }, [isAccommodation, backdatedStayEnabled, values.startDate, values.totalNights, istToday]);

  // Determine active steps based on category
  const activeSteps = isAccommodation ? ACCOMMODATION_STEPS : STEPS;
  const activeStepIcons = isAccommodation ? ACCOMMODATION_STEP_ICONS : STEP_ICONS;

  // Req 5.8: Evaluate once at component mount — isAfterCutoff is already memoized at render time.
  // Tomorrow's date in IST for comparison (Req 5.2, 5.7).
  const tomorrowIST = useMemo(() => addDaysToISODate(istToday, 1), [istToday]);

  // Req 5.2: Show automation override checkbox when after cutoff AND start date is tomorrow.
  const showAutomationOverride = isAfterCutoff && startDate === tomorrowIST;

  // Req 5.4, 5.5: Disable Onboard CTA when override checkbox visible but unchecked.
  const canOnboard =
    !isSubmitting &&
    paymentStatus === "PAID" &&
    (!showAutomationOverride || automationOverrideAcknowledged) &&
    (isAccommodation || addressResolved);

  // Req 5.7: When start date changes away from tomorrow, reset the acknowledgment field.
  useEffect(() => {
    if (!showAutomationOverride && automationOverrideAcknowledged) {
      setValue("automationOverrideAcknowledged", false);
    }
  }, [showAutomationOverride, automationOverrideAcknowledged, setValue]);

  // Auto-select the first KIT product when switching to KIT category (like plans for MEAL).
  useEffect(() => {
    if (primaryCategory === "KIT" && kitProducts.length > 0 && !selectedKitProductId) {
      setValue("kitProductId", kitProducts[0].id);
    }
  }, [primaryCategory, kitProducts, selectedKitProductId, setValue]);

  // Auto-select the first plan when switching to MEAL category.
  useEffect(() => {
    if (primaryCategory === "MEAL" && plans.length > 0 && !selectedPlanId) {
      setValue("planId", plans[0].id);
    }
  }, [primaryCategory, plans, selectedPlanId, setValue]);

  // ─── Dietitian dropdown: Meal onboarding, Core session (Req 7.1–7.5) ─────
  // Resolve the Clinic from the address pincode and (re)load the Dietitian
  // options whenever the resolved Clinic changes. Franchise sessions skip
  // this entirely — they show a read-only single Dietitian instead (Req 7.6).
  const dietitianId = values.dietitianId;
  useEffect(() => {
    if (isFranchiseSession || primaryCategory !== "MEAL") return;

    let cancelled = false;

    async function loadMealDietitians() {
      const pincode = address.pincode;
      if (!pincode) {
        if (cancelled) return;
        setMealDietitians([]);
        mealDietitianClinicIdRef.current = null;
        return;
      }

      setIsLoadingMealDietitians(true);
      try {
        const { clinicId } = await resolveClinicForPincodeAction(pincode);
        if (cancelled) return;
        if (clinicId === mealDietitianClinicIdRef.current) {
          // Same clinic as last resolution — nothing to reload.
          setIsLoadingMealDietitians(false);
          return;
        }
        mealDietitianClinicIdRef.current = clinicId;
        if (!clinicId) {
          setMealDietitians([]);
          setValue("dietitianId", undefined);
          setIsLoadingMealDietitians(false);
          return;
        }
        const result = await listDietitiansForClinic(clinicId);
        if (cancelled) return;
        const options = result.success ? result.data : [];
        setMealDietitians(options);
        // Req 7.3: clear a previously selected Dietitian not linked to the new Clinic.
        // Req 7.4: pre-select when the Clinic has exactly one active Dietitian.
        if (dietitianId && !options.some((d) => d.id === dietitianId)) {
          setValue("dietitianId", undefined);
        }
        if (options.length === 1) {
          setValue("dietitianId", options[0].id);
        }
        setIsLoadingMealDietitians(false);
      } catch {
        if (!cancelled) setIsLoadingMealDietitians(false);
      }
    }

    void loadMealDietitians();

    return () => {
      cancelled = true;
    };
    // dietitianId intentionally omitted — read fresh from `values` inside the
    // effect body to avoid re-running the clinic resolution on every selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address.pincode, primaryCategory, isFranchiseSession, setValue]);

  // ─── Dietitian display: Meal onboarding, Franchise session (Req 7.6) ────
  // Resolve the Franchise's single active Dietitian once and show it as
  // read-only text; the value still flows into the submitted payload.
  useEffect(() => {
    if (!isFranchiseSession || primaryCategory !== "MEAL" || !franchiseId) return;
    let cancelled = false;
    getFranchiseDietitianAction(franchiseId).then((result) => {
      if (cancelled) return;
      setFranchiseDietitianName(result.dietitianName);
      setValue("dietitianId", result.dietitianId ?? undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [isFranchiseSession, primaryCategory, franchiseId, setValue]);

  // ─── Dietitian dropdown: Accommodation onboarding (Req 9.1, 9.2) ─────────
  // Unscoped list of every active Dietitian, loaded once when the category
  // switches to ACCOMMODATION.
  useEffect(() => {
    if (primaryCategory !== "ACCOMMODATION") return;
    if (accommodationDietitians.length > 0) return;
    let cancelled = false;

    async function loadAccommodationDietitians() {
      setIsLoadingAccommodationDietitians(true);
      const result = await listActiveDietitiansForAdmin();
      if (cancelled) return;
      setAccommodationDietitians(result.success ? result.data : []);
      setIsLoadingAccommodationDietitians(false);
    }

    void loadAccommodationDietitians();

    return () => {
      cancelled = true;
    };
  }, [primaryCategory, accommodationDietitians.length]);

  // Reset start date to today when switching to ACCOMMODATION (no 5PM cutoff rule — Req 1.2)
  useEffect(() => {
    if (primaryCategory === "ACCOMMODATION") {
      setValue("startDate", istToday);
    }
  }, [primaryCategory, istToday, setValue]);

  // ─── Delivery Charge Helpers (Req 7.1–7.7) ────────────────────────────────

  /**
   * Validates and sets the delivery charge from manual input (Req 7.6, 7.7).
   * Rejects non-numeric, negative, > 999,999.99, > 2 decimal places
   */
  const handleDeliveryChargeInput = (rawValue: string) => {
    setDeliveryChargeInput(rawValue);

    if (rawValue === "") {
      setDeliveryCharge(null);
      setDeliveryChargeError(null);
      return;
    }

    const parsed = Number(rawValue);
    if (isNaN(parsed) || !isFinite(parsed)) {
      setDeliveryChargeError("Delivery charge must be a valid number");
      return;
    }

    if (parsed < 0) {
      setDeliveryChargeError("Delivery charge cannot be negative");
      return;
    }

    if (parsed > 999999.99) {
      setDeliveryChargeError("Delivery charge cannot exceed ₹999,999.99");
      return;
    }

    // Check for > 2 decimal places
    const decimalParts = rawValue.split(".");
    if (decimalParts.length === 2 && decimalParts[1].length > 2) {
      setDeliveryChargeError("Delivery charge cannot have more than 2 decimal places");
      return;
    }

    setDeliveryCharge(parsed);
    setDeliveryChargeError(null);
  };

  /**
   * Triggers the delivery charge calculation using the address data (Req 7.2).
   * Uses the address-based variant since the customer does not exist yet.
   */
  const handleCalculateDeliveryCharge = async () => {
    if (!selectedPlan) {
      setDeliveryChargeError("Please select a plan first");
      return;
    }

    if (!addressResolved || !address.pincode) {
      setDeliveryChargeError("Please complete the address step first (pincode required)");
      return;
    }

    setIsCalculatingDelivery(true);
    setDeliveryChargeError(null);

    try {
      const result = await calculateDeliveryChargeForAddressAction({
        address: {
          pincode: address.pincode,
          lat: address.lat,
          lng: address.lng,
        },
        planDays: selectedPlan.durationDays,
      });

      if (!result.success) {
        setDeliveryChargeError(result.error);
        setDistanceKm(null);
        setRatePerKm(null);
        return;
      }

      const outcome = result.outcome;

      if (outcome.ok) {
        // Success — auto-fill the delivery charge (Req 7.2, 7.3)
        setDeliveryCharge(outcome.totalDeliveryCharge);
        setDeliveryChargeInput(outcome.totalDeliveryCharge.toFixed(2));
        setCalculatedDeliveryCharge(outcome.totalDeliveryCharge);
        setDistanceKm(outcome.distanceKm);
        setRatePerKm(outcome.ratePerKm);
        setDeliveryChargeError(null);
      } else {
        // Failure — show user-friendly message, allow manual entry (Req 7.5)
        let message = "Unable to calculate delivery charge";
        switch (outcome.reason) {
          case "missing_pincode":
            message = "Address pincode is missing. Please update the address.";
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

  const goNext = async () => {
    const fields = STEP_FIELDS[step];
    
    // For step 1, filter fields based on category selection
    let fieldsToValidate = fields;
    if (step === 1) {
      const category = values.primaryCategory;
      if (category === "ACCOMMODATION") {
        // ACCOMMODATION category: validate accommodation-specific fields, skip planId and KIT fields
        fieldsToValidate = ["primaryCategory", "startDate", "initialMealPreference", "totalNights", "stayType", "occupancyType"];
        // Conditionally validate payment fields
        if (!values.isSharedPayment) {
          fieldsToValidate = [...fieldsToValidate, "totalStayAmount", "advanceAmountPaid"];
        } else {
          fieldsToValidate = [...fieldsToValidate, "paymentHostMobile"];
        }
      } else if (category === "KIT") {
        // KIT category: validate kitProductId and kitDurationDays, skip planId
        fieldsToValidate = ["primaryCategory", "kitProductId", "kitDurationDays", "startDate", "initialMealPreference"];
      } else if (category === "MEAL") {
        // MEAL category: validate planId, skip KIT fields
        fieldsToValidate = ["primaryCategory", "planId", "startDate", "initialMealPreference"];
      }
    }
    
    const valid = fieldsToValidate.length === 0 ? true : await trigger(fieldsToValidate);

    // Step 1 gate: Temp PIN is mandatory (managed outside Zod schema).
    if (step === 0) {
      if (!isValidPinFormat(tempPin)) {
        setTempPinError("Temporary PIN is required (exactly 6 digits).");
        return;
      }
      // Check mobile uniqueness against the database before proceeding
      const mobileValue = values.mobile;
      if (mobileValue && /^[6-9]\d{9}$/.test(mobileValue)) {
        const mobileCheck = await checkMobileUniqueAction(mobileValue);
        if (!mobileCheck.available) {
          setError("mobile", { type: "server", message: mobileCheck.message });
          toast.error(mobileCheck.message);
          return;
        }
      }
    }

    if (step === 2 && !isAccommodation) {
      setAddressTouched(true);
      if (!addressResolved) return;
    }
    if (!valid) return;

    // Intercept step 1 → step 2 advance when past date mode is active (Req 1.5, 3.1, 3.2)
    // Only for MEAL/KIT categories
    if (step === 1 && !isAccommodation && pastDateEnabled && values.startDate && values.startDate < istToday) {
      setShowPastDayPopup(true);
      return;
    }

    // ACCOMMODATION: skip address step (Req 3.1) — jump from step 1 directly to step 3
    if (step === 1 && isAccommodation) {
      setStep(3);
      return;
    }

    setStep((prev) => Math.min(prev + 1, STEPS.length - 1) as StepIndex);
  };

  const goBack = () => {
    // ACCOMMODATION: skip address step going backwards (Req 3.1)
    if (step === 3 && isAccommodation) {
      setStep(1);
      return;
    }
    setStep((prev) => Math.max(prev - 1, 0) as StepIndex);
  };

  const applyServerFieldErrors = (fieldErrors?: Record<string, string>) => {
    if (!fieldErrors) return;
    let jumpToAddress = false;
    let jumpToDetails = false;
    let jumpToPlan = false;
    for (const [key, message] of Object.entries(fieldErrors)) {
      if (key.startsWith("address")) {
        setAddressServerError(message);
        jumpToAddress = true;
        continue;
      }
      if (key === "tempPin") {
        setTempPinError(message);
        jumpToDetails = true;
        continue;
      }
      // Dotted paths like "pastDayStatuses.2.mealType" refer to array entries
      // within the popup which is already closed at submission time — show as
      // individual toast notifications since they can't map to inline fields.
      if (key.startsWith("pastDayStatuses.") && key.includes(".")) {
        toast.error(message);
        jumpToPlan = true;
        continue;
      }
      // Top-level past-date fields navigate back to step 1 (Category & Plan)
      if (key === "pastDateEnabled" || key === "pastDayStatuses" || key === "startDate") {
        jumpToPlan = true;
      }
      setError(key as keyof DetailsFormValues, { type: "server", message });
    }
    if (jumpToAddress) setStep(2);
    else if (jumpToPlan) setStep(1);
    else if (jumpToDetails) setStep(0);
  };

  const onSubmit = (values: DetailsFormValues) => {
    setAddressServerError(null);
    setTempPinError(null);

    // ACCOMMODATION: skip address validation (Req 3.1)
    if (!isAccommodation) {
      if (!addressResolved) {
        setAddressTouched(true);
        setStep(2);
        toast.error("Complete the address before onboarding.");
        return;
      }
    }

    if (!isValidPinFormat(tempPin)) {
      setTempPinError("Temporary PIN must be exactly 6 digits.");
      setStep(0);
      toast.error("Enter a valid 6-digit temporary PIN.");
      return;
    }

    // ACCOMMODATION flow: call onboardAccommodationCustomerAction (Req 1.9, 3.1)
    if (isAccommodation) {
      const accommodationPayload = {
        fullName: values.fullName,
        mobile: values.mobile,
        gender: values.gender as "Male" | "Female" | "Other",
        dietaryPreference: values.dietaryPreference as "Veg" | "Non-Veg",
        allergies: values.allergies && values.allergies.trim() !== "" ? values.allergies : undefined,
        email: values.email && values.email.trim() !== "" ? values.email : undefined,
        startDate: values.startDate,
        totalNights: Number(values.totalNights),
        backdatedStayEnabled: values.backdatedStayEnabled ?? false,
        stayType: values.stayType as "AC Villa" | "Village Style Hut",
        occupancyType: values.occupancyType as "Single" | "Double",
        mealPreference: values.initialMealPreference as "VEG" | "EGG" | "CHICKEN",
        totalStayAmount: values.isSharedPayment ? undefined : Number(values.totalStayAmount) || undefined,
        advanceAmountPaid: values.isSharedPayment ? undefined : Number(values.advanceAmountPaid) || 0,
        isSharedPayment: values.isSharedPayment ?? false,
        paymentHostMobile: values.isSharedPayment ? (values.paymentHostMobile || undefined) : undefined,
        tempPin,
        dietitianUserId: values.dietitianId || undefined,
      };

      startTransition(async () => {
        const result = await onboardAccommodationCustomerAction(accommodationPayload);
        if ("success" in result && result.success) {
          toast.success("Accommodation customer onboarded successfully.");
          router.push("/customers");
          router.refresh();
          return;
        }
        if ("error" in result) {
          toast.error(result.error);
          applyServerFieldErrors(result.fieldErrors);
        }
      });
      return;
    }

    // MEAL / KIT flow: existing behavior
    const payload = {
      ...values,
      email:
        values.email && values.email.trim() !== "" ? values.email : undefined,
      allergies:
        values.allergies && values.allergies.trim() !== ""
          ? values.allergies
          : undefined,
      kitProductId: values.primaryCategory === "KIT" ? values.kitProductId : undefined,
      kitDurationDays: values.primaryCategory === "KIT" ? values.kitDurationDays : undefined,
      planId: values.primaryCategory === "MEAL" ? values.planId : undefined,
      // Dietitian_Link dropdown only applies to Core MEAL onboarding (Req 7.1);
      // KIT customers are linked to a Dietitian post-onboarding (Req 8).
      dietitianId: values.primaryCategory === "MEAL" ? values.dietitianId : undefined,
      address: {
        tag: address.tag,
        searchText: address.searchText,
        flatNumber: address.flatNumber,
        floorNumber: address.floorNumber,
        streetAddress: address.streetAddress,
        area: address.area,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        lat: address.lat,
        lng: address.lng,
      },
      tempPin,
      deliveryCharge: deliveryCharge ?? 0,
      calculatedDeliveryCharge: calculatedDeliveryCharge,
    };

    startTransition(async () => {
      const result = await onboardCustomerAction(payload);
      if (result.success) {
        toast.success("Customer onboarded successfully.");
        router.push("/customers");
        router.refresh();
        return;
      }
      toast.error(result.error);
      applyServerFieldErrors(result.fieldErrors);
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
      {/* ── Progress Stepper ── */}
      <Stepper current={step} steps={activeSteps} icons={activeStepIcons} isAccommodation={isAccommodation} />

      {/* ── Step panel ── */}
      <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">

        {/* Step header stripe */}
        <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-6 py-4">
          {(() => {
            const Icon = STEP_ICONS[step];
            return (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </span>
            );
          })()}
          <div>
            <p className="text-sm font-semibold text-slate-900">{STEPS[step]}</p>
            <p className="text-xs text-slate-500">{STEP_SUBTITLES[step]}</p>
          </div>
          <span className="ml-auto text-xs font-medium text-slate-400">
            Step {isAccommodation ? (step === 3 ? 3 : step + 1) : step + 1} of {activeSteps.length}
          </span>
        </div>

        {/* Step content */}
        <div className="p-6">

          {/* ── STEP 1: Details ── */}
          {step === 0 && (
            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="Full name" htmlFor="fullName" error={errors.fullName?.message} required>
                  <Input
                    id="fullName"
                    placeholder="e.g. Rahul Sharma"
                    maxLength={100}
                    aria-invalid={Boolean(errors.fullName)}
                    className="h-9"
                    {...register("fullName")}
                  />
                </Field>

                <Field label="Mobile number" htmlFor="mobile" error={errors.mobile?.message} required>
                  <Input
                    id="mobile"
                    inputMode="numeric"
                    placeholder="10-digit mobile"
                    maxLength={10}
                    aria-invalid={Boolean(errors.mobile)}
                    className="h-9"
                    {...register("mobile")}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="Gender" htmlFor="gender" error={errors.gender?.message} required>
                  <Controller
                    control={control}
                    name="gender"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger
                          id="gender"
                          aria-label="Gender"
                          aria-invalid={Boolean(errors.gender)}
                          className="h-9"
                        >
                          <SelectValue placeholder="Select gender" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Male">Male</SelectItem>
                          <SelectItem value="Female">Female</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>

                <Field label="Diet preference" error={errors.dietaryPreference?.message} required>
                  <Controller
                    control={control}
                    name="dietaryPreference"
                    render={({ field }) => (
                      <RadioGroup
                        className="flex gap-3 h-9 items-center"
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        {(["Veg", "Non-Veg"] as const).map((pref) => (
                          <label
                            key={pref}
                            className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-input bg-white px-3 py-2 text-sm font-medium transition-all duration-150 hover:border-slate-300 hover:bg-slate-50 has-data-checked:border-primary has-data-checked:bg-primary/5 has-data-checked:text-primary"
                          >
                            <RadioGroupItem value={pref} aria-label={pref} />
                            {pref}
                          </label>
                        ))}
                      </RadioGroup>
                    )}
                  />
                </Field>
              </div>

              <Field label="Allergies" htmlFor="allergies" error={errors.allergies?.message} hint="Optional">
                <Textarea
                  id="allergies"
                  rows={2}
                  maxLength={500}
                  placeholder="e.g. No peanuts, no dairy..."
                  className="resize-none"
                  {...register("allergies")}
                />
              </Field>

              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
                <TempPinField
                  value={tempPin}
                  onChange={(val) => {
                    setTempPin(val);
                    if (tempPinError) setTempPinError(null);
                  }}
                  error={tempPinError ?? undefined}
                  disabled={isSubmitting}
                />
              </div>
            </div>
          )}

          {/* ── STEP 2: Category & Plan ── */}
          {step === 1 && (
            <div className="flex flex-col gap-6">
              <Field label="Primary category" error={errors.primaryCategory?.message} required>
                <Controller
                  control={control}
                  name="primaryCategory"
                  render={({ field }) => (
                    <RadioGroup
                      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      {CUSTOMER_CATEGORIES.map((category) => {
                        const label =
                          category === "MEAL"
                            ? "Meal"
                            : category === "KIT"
                              ? "Kit"
                              : "Accommodation";
                        const isSelected = field.value === category;
                        return (
                          <label
                            key={category}
                            className={cn(
                              "flex cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3 text-sm font-medium transition-all duration-150 hover:border-slate-300 hover:bg-slate-50",
                              isSelected
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-slate-200 bg-white text-slate-700",
                            )}
                          >
                            <RadioGroupItem value={category} aria-label={label} />
                            {label}
                          </label>
                        );
                      })}
                    </RadioGroup>
                  )}
                />
                <p className="text-xs text-slate-500 mt-1">
                  Exactly one category is selected at onboarding. Others can be added later as paid add-ons.
                </p>
              </Field>

              {/* Conditional rendering based on primaryCategory */}
              {primaryCategory === "KIT" ? (
                <>
                  {/* KIT Product dropdown */}
                  <Field label="KIT Product" htmlFor="kitProductId" error={errors.kitProductId?.message} required>
                    <Controller
                      control={control}
                      name="kitProductId"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger
                            id="kitProductId"
                            aria-label="KIT Product"
                            aria-invalid={Boolean(errors.kitProductId)}
                            className="h-9"
                          >
                            <SelectValue placeholder="Select a KIT product" />
                          </SelectTrigger>
                          <SelectContent>
                            {kitProducts.length === 0 ? (
                              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                No active KIT products available.
                              </div>
                            ) : (
                              kitProducts.map((product) => (
                                <SelectItem key={product.id} value={product.id}>
                                  {product.name} - ₹{product.base_price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {/* Selected KIT product preview */}
                    {selectedKitProduct && (
                      <div className="mt-2 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                        <Sparkles className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        <p className="text-xs text-emerald-800 font-medium">
                          {selectedKitProduct.name} · Total: ₹{selectedKitProduct.base_price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (incl. 5% tax)
                        </p>
                      </div>
                    )}
                  </Field>

                  {/* Kit Duration (Days) field */}
                  <Field label="Kit Duration (Days)" htmlFor="kitDurationDays" error={errors.kitDurationDays?.message} required>
                    <Input
                      id="kitDurationDays"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      placeholder="e.g. 30"
                      aria-invalid={Boolean(errors.kitDurationDays)}
                      className="h-9 max-w-xs"
                      {...register("kitDurationDays", { valueAsNumber: true })}
                    />
                    <p className="text-xs text-slate-500">
                      Enter the number of days this KIT package will last.
                    </p>
                  </Field>
                </>
              ) : primaryCategory === "ACCOMMODATION" ? (
                <>
                  {/* ── ACCOMMODATION-SPECIFIC FIELDS (Req 1.1–1.9, 2.1–2.8) ── */}

                  {/* Stay Start Date — no 5 PM cutoff for accommodation (Req 1.2) */}
                  <Field label="Stay start date" htmlFor="startDate" error={errors.startDate?.message} required>
                    <Input
                      id="startDate"
                      type="date"
                      min={backdatedStayEnabled ? accommodationBackdatedRange.min : accommodationForwardRange.min}
                      max={backdatedStayEnabled ? accommodationBackdatedRange.max : accommodationForwardRange.max}
                      aria-invalid={Boolean(errors.startDate)}
                      className="h-9 max-w-xs"
                      {...register("startDate")}
                    />
                    <p className="text-xs text-slate-500">
                      {backdatedStayEnabled
                        ? `Select a past date between ${accommodationBackdatedRange.min} and ${accommodationBackdatedRange.max}.`
                        : "Today or any future date up to 365 days. No 5 PM cutoff applies."}
                    </p>

                    {/* Backdated_Stay_Toggle — Req 1.1, 1.2, 1.3, 1.4, 1.5 */}
                    <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm text-slate-600 select-none">
                      <Controller
                        control={control}
                        name="backdatedStayEnabled"
                        render={({ field }) => (
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(checked) => {
                              const enabled = checked === true;
                              field.onChange(enabled);
                              // Toggling either direction clears the current
                              // start date so the admin must re-pick within
                              // the newly active range (Req 1.4).
                              setValue("startDate", "");
                            }}
                          />
                        )}
                      />
                      <span>
                        Backdated stay entry
                        <span className="block text-xs text-slate-500">
                          Enable to record a stay that already started or finished.
                        </span>
                      </span>
                    </label>

                    {/* Backdated stay completion alert — Req 2.1, 2.2, 2.3, 2.4, 2.5 */}
                    {backdatedStayOutcome?.showCompletionAlert && (
                      <Alert variant="destructive" className="mt-3">
                        <AlertTriangle />
                        <AlertTitle>Stay will be created as finished</AlertTitle>
                        <AlertDescription>
                          The computed end date ({backdatedStayOutcome.computedEndDate}) has already
                          passed. This stay will be created with status FINISHED immediately upon
                          submission. You can still submit, or increase total nights to change this.
                        </AlertDescription>
                      </Alert>
                    )}
                  </Field>

                  {/* Total Nights (Req 1.3, 1.4) */}
                  <Field label="Total nights" htmlFor="totalNights" error={errors.totalNights?.message} required>
                    <Input
                      id="totalNights"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="365"
                      placeholder="e.g. 14"
                      aria-invalid={Boolean(errors.totalNights)}
                      className="h-9 max-w-xs"
                      {...register("totalNights", { valueAsNumber: true })}
                    />
                    {values.totalNights !== undefined && Number(values.totalNights) > 0 && Number(values.totalNights) < 7 && (
                      <p className="text-xs text-yellow-600 bg-yellow-50 border border-yellow-200 rounded px-2 py-1 mt-1">
                        ⚠️ Recommended minimum stay is 7 nights for the best wellness experience.
                      </p>
                    )}
                  </Field>

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    {/* Stay Type (Req 1.5) */}
                    <Field label="Stay type" error={errors.stayType?.message} required>
                      <Controller
                        control={control}
                        name="stayType"
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger
                              aria-label="Stay type"
                              aria-invalid={Boolean(errors.stayType)}
                              className="h-9"
                            >
                              <SelectValue placeholder="Select stay type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="AC Villa">AC Villa</SelectItem>
                              <SelectItem value="Village Style Hut">Village Style Hut</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </Field>

                    {/* Occupancy Type (Req 1.6) */}
                    <Field label="Occupancy type" error={errors.occupancyType?.message} required>
                      <Controller
                        control={control}
                        name="occupancyType"
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger
                              aria-label="Occupancy type"
                              aria-invalid={Boolean(errors.occupancyType)}
                              className="h-9"
                            >
                              <SelectValue placeholder="Select occupancy" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Single">Single</SelectItem>
                              <SelectItem value="Double">Double</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </Field>
                  </div>

                  {/* Meal Preference for accommodation (Req 1.8) */}
                  <Field label="Meal preference" error={errors.initialMealPreference?.message} required>
                    <Controller
                      control={control}
                      name="initialMealPreference"
                      render={({ field }) => (
                        <RadioGroup
                          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          {[
                            { value: "VEG", label: "Veg", desc: "Vegetarian meals" },
                            { value: "EGG", label: "Egg", desc: "Eggetarian meals" },
                            { value: "CHICKEN", label: "Chicken", desc: "Non-Veg (Chicken)" },
                          ].map((option) => {
                            const isSelected = field.value === option.value;
                            return (
                              <label
                                key={option.value}
                                className={cn(
                                  "flex cursor-pointer flex-col gap-1 rounded-xl border-2 px-4 py-3 transition-all duration-150 hover:border-slate-300 hover:bg-slate-50",
                                  isSelected
                                    ? "border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-200"
                                    : "border-slate-200 bg-white",
                                )}
                              >
                                <div className="flex items-center gap-2">
                                  <RadioGroupItem value={option.value} aria-label={option.label} />
                                  <span className={cn(
                                    "text-sm font-semibold",
                                    isSelected ? "text-emerald-700" : "text-slate-700"
                                  )}>
                                    {option.label}
                                  </span>
                                </div>
                                <p className={cn(
                                  "text-xs ml-6",
                                  isSelected ? "text-emerald-600" : "text-slate-500"
                                )}>
                                  {option.desc}
                                </p>
                              </label>
                            );
                          })}
                        </RadioGroup>
                      )}
                    />
                  </Field>

                  {/* Shared Payment Checkbox (Req 2.1, 2.8) */}
                  <div className="rounded-xl border border-slate-200 p-4">
                    <label className="flex cursor-pointer items-center gap-3 select-none">
                      <Controller
                        control={control}
                        name="isSharedPayment"
                        render={({ field }) => (
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(checked) => {
                              const enabled = checked === true;
                              field.onChange(enabled);
                              // When toggling shared payment, clear the opposite fields
                              if (enabled) {
                                setValue("totalStayAmount", undefined);
                                setValue("advanceAmountPaid", undefined);
                              } else {
                                setValue("paymentHostMobile", "");
                              }
                            }}
                          />
                        )}
                      />
                      <div>
                        <p className="text-sm font-medium text-slate-700">This is a shared payment</p>
                        <p className="text-xs text-slate-500">Another guest is paying for this customer&apos;s stay</p>
                      </div>
                    </label>

                    {/* Total stay amount + advance paid — shown when NOT shared payment (Req 4.1, 4.2, 4.3) */}
                    {!isSharedPayment && (
                      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Total stay amount (₹)" htmlFor="totalStayAmount" error={errors.totalStayAmount?.message} required>
                          <Input
                            id="totalStayAmount"
                            type="number"
                            inputMode="numeric"
                            min="1"
                            max="9999999"
                            placeholder="e.g. 50000"
                            aria-invalid={Boolean(errors.totalStayAmount)}
                            className="h-9 max-w-xs"
                            {...register("totalStayAmount", { valueAsNumber: true })}
                          />
                          <p className="text-xs text-slate-500">
                            Total amount inclusive of 18% GST (₹1 – ₹99,99,999).
                          </p>
                        </Field>

                        <Field label="Advance amount paid (₹)" htmlFor="advanceAmountPaid" error={errors.advanceAmountPaid?.message} required>
                          <Input
                            id="advanceAmountPaid"
                            type="number"
                            inputMode="numeric"
                            min="0"
                            max={values.totalStayAmount ? Number(values.totalStayAmount) : 9999999}
                            placeholder="e.g. 10000"
                            aria-invalid={Boolean(errors.advanceAmountPaid)}
                            className="h-9 max-w-xs"
                            {...register("advanceAmountPaid", { valueAsNumber: true })}
                          />
                          <p className="text-xs text-slate-500">
                            Amount collected at onboarding (₹0 if none).
                          </p>
                          {values.totalStayAmount != null &&
                            values.advanceAmountPaid != null &&
                            Number(values.advanceAmountPaid) > Number(values.totalStayAmount) && (
                              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mt-1">
                                Advance amount cannot exceed the total stay amount.
                              </p>
                            )}
                        </Field>
                      </div>
                    )}

                    {/* Payment Host Mobile — shown when shared payment is enabled (Req 2.1) */}
                    {isSharedPayment && (
                      <div className="mt-4">
                        <Field label="Payment host mobile" htmlFor="paymentHostMobile" error={errors.paymentHostMobile?.message} required>
                          <Input
                            id="paymentHostMobile"
                            inputMode="numeric"
                            placeholder="10-digit mobile of the paying guest"
                            maxLength={10}
                            aria-invalid={Boolean(errors.paymentHostMobile)}
                            className="h-9 max-w-xs"
                            {...register("paymentHostMobile")}
                          />
                          <p className="text-xs text-slate-500">
                            Must be an existing accommodation customer with an active or pending stay.
                          </p>
                        </Field>
                      </div>
                    )}
                  </div>

                  {/* Dietitian dropdown — Accommodation onboarding (Req 9.1–9.3) */}
                  <Field label="Dietitian" htmlFor="dietitianId" error={errors.dietitianId?.message} hint="Optional">
                    <Controller
                      control={control}
                      name="dietitianId"
                      render={({ field }) => (
                        <Select
                          value={field.value ?? ""}
                          onValueChange={field.onChange}
                          disabled={isLoadingAccommodationDietitians}
                        >
                          <SelectTrigger
                            id="dietitianId"
                            aria-label="Dietitian"
                            className="h-9"
                          >
                            <SelectValue placeholder="Select a dietitian (optional)" />
                          </SelectTrigger>
                          <SelectContent>
                            {accommodationDietitians.map((d) => (
                              <SelectItem key={d.id} value={d.id}>
                                {d.fullName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      Onboarding may continue with no dietitian selected.
                    </p>
                  </Field>
                </>
              ) : (
                <>
                  {/* Subscription Plan dropdown for MEAL category */}
                  <Field label="Subscription plan" htmlFor="planId" error={errors.planId?.message} required>
                    <Controller
                      control={control}
                      name="planId"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger
                            id="planId"
                            aria-label="Subscription plan"
                            aria-invalid={Boolean(errors.planId)}
                            className="h-9"
                          >
                            <SelectValue placeholder="Select a subscription plan" />
                          </SelectTrigger>
                          <SelectContent>
                            {plans.length === 0 ? (
                              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                No active plans available.
                              </div>
                            ) : (
                              plans.map((plan) => (
                                <SelectItem key={plan.id} value={plan.id}>
                                  {plan.name} — ₹{plan.price.toLocaleString("en-IN")}
                                  {plan.durationDays ? ` (${plan.durationDays} days)` : ""}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {/* Selected plan preview */}
                    {selectedPlan && (
                      <div className="mt-2 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                        <Sparkles className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        <p className="text-xs text-emerald-800 font-medium">
                          {selectedPlan.name} · {selectedPlan.durationDays} days · ₹{selectedPlan.price.toLocaleString("en-IN")}
                        </p>
                      </div>
                    )}
                  </Field>
                </>
              )}

              {primaryCategory !== "KIT" && primaryCategory !== "ACCOMMODATION" && (
                <Field label="Subscription start date" htmlFor="startDate" error={errors.startDate?.message} required>
                  {pastDateEnabled ? (
                    <>
                      <Input
                        id="startDate"
                        type="date"
                        min={pastDateRange.start}
                        max={pastDateRange.end}
                        aria-invalid={Boolean(errors.startDate)}
                        className="h-9 max-w-xs"
                        {...register("startDate")}
                      />
                      <p className="text-xs text-slate-500">
                        Select a past date between {pastDateRange.start} and {pastDateRange.end}.
                      </p>
                    </>
                  ) : (
                    <>
                      <Input
                        id="startDate"
                        type="date"
                        min={tomorrowIST}
                        aria-invalid={Boolean(errors.startDate)}
                        className="h-9 max-w-xs"
                        {...register("startDate")}
                      />
                      <p className="text-xs text-slate-500">
                        {isAfterCutoff
                          ? `Earliest start date is ${earliest}. Tomorrow (${tomorrowIST}) requires automation override acknowledgment.`
                          : `Earliest selectable start date is ${earliest}.`}
                      </p>
                    </>
                  )}

                  {/* Past date start date checkbox — Req 1.1, 1.2, 1.3, 1.4 */}
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-600 select-none">
                    <Controller
                      control={control}
                      name="pastDateEnabled"
                      render={({ field }) => (
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={(checked) => {
                            const enabled = checked === true;
                            field.onChange(enabled);
                            if (!enabled) {
                              // Req 1.4: clear selected start date and discard pastDayStatuses
                              setValue("startDate", "");
                              setValue("pastDayStatuses", []);
                            } else {
                              // When enabling past-date mode, clear the start date
                              // so admin must pick a valid past date
                              setValue("startDate", "");
                            }
                          }}
                        />
                      )}
                    />
                    Past date start date
                  </label>
                </Field>
              )}

              {primaryCategory !== "ACCOMMODATION" && (
              <Field label="Initial meal preference" error={errors.initialMealPreference?.message} required>
                <Controller
                  control={control}
                  name="initialMealPreference"
                  render={({ field }) => (
                    <RadioGroup
                      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      {[
                        { value: "VEG", label: "Veg", desc: "Vegetarian meals" },
                        { value: "EGG", label: "Egg", desc: "Eggetarian meals" },
                        { value: "CHICKEN", label: "Chicken", desc: "Non-Veg (Chicken)" },
                      ].map((option) => {
                        const isSelected = field.value === option.value;
                        return (
                          <label
                            key={option.value}
                            className={cn(
                              "flex cursor-pointer flex-col gap-1 rounded-xl border-2 px-4 py-3 transition-all duration-150 hover:border-slate-300 hover:bg-slate-50",
                              isSelected
                                ? "border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-200"
                                : "border-slate-200 bg-white",
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <RadioGroupItem value={option.value} aria-label={option.label} />
                              <span className={cn(
                                "text-sm font-semibold",
                                isSelected ? "text-emerald-700" : "text-slate-700"
                              )}>
                                {option.label}
                              </span>
                            </div>
                            <p className={cn(
                              "text-xs ml-6",
                              isSelected ? "text-emerald-600" : "text-slate-500"
                            )}>
                              {option.desc}
                            </p>
                          </label>
                        );
                      })}
                    </RadioGroup>
                  )}
                />
                <p className="text-xs text-slate-500 mt-1">
                  This sets the default meal type for the entire subscription. Customer can change it later for specific days.
                </p>
              </Field>
              )}

              {!isAccommodation && isAfterCutoff && startDate === tomorrowIST && (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Past the 5 PM cutoff</AlertTitle>
                  <AlertDescription>
                    It is past the 5:00 PM cutoff. You have selected tomorrow as the start date.
                    On the final step you will need to acknowledge that the operations admin will re-run the delivery automation.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* ── STEP 3: Address ── (hidden for ACCOMMODATION) */}
          {step === 2 && !isAccommodation && (
            <div className="flex flex-col gap-4">
              <AddressCaptureMap
                value={address}
                onChange={(next) => {
                  setAddress(next);
                  setAddressServerError(null);
                }}
                serviceAreaPincodes={serviceAreaPincodes}
                customerCategory={primaryCategory}
                onValidityChange={setAddressValidity}
                disabled={isSubmitting}
              />

              {addressServerError && (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Address problem</AlertTitle>
                  <AlertDescription>{addressServerError}</AlertDescription>
                </Alert>
              )}

              {addressTouched && !addressResolved && !addressServerError && (
                <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {primaryCategory === "KIT" 
                    ? "Complete the address: select a location on the map and enter the flat number."
                    : "Complete the address: select a serviceable location on the map and enter the flat number."
                  }
                </p>
              )}

              {/* ── Dietitian dropdown — Meal onboarding (Req 7.1–7.6) ── */}
              {primaryCategory === "MEAL" && (
                <Field label="Dietitian" htmlFor="dietitianId" error={errors.dietitianId?.message} hint="Optional">
                  {isFranchiseSession ? (
                    <p className="flex h-9 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">
                      {franchiseDietitianName ?? "No dietitian is assigned to this franchise"}
                    </p>
                  ) : (
                    <>
                      <Controller
                        control={control}
                        name="dietitianId"
                        render={({ field }) => (
                          <Select
                            value={field.value ?? ""}
                            onValueChange={field.onChange}
                            disabled={!addressResolved || isLoadingMealDietitians}
                          >
                            <SelectTrigger
                              id="dietitianId"
                              aria-label="Dietitian"
                              className="h-9"
                            >
                              <SelectValue
                                placeholder={
                                  !addressResolved
                                    ? COMPLETE_ADDRESS_TO_LOAD_DIETITIANS
                                    : "Select a dietitian (optional)"
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {mealDietitians.map((d) => (
                                <SelectItem key={d.id} value={d.id}>
                                  {d.fullName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                      {addressResolved && !isLoadingMealDietitians && mealDietitians.length === 0 && (
                        <p className="mt-1 text-xs text-slate-500">{NO_DIETITIAN_FOR_CLINIC}</p>
                      )}
                    </>
                  )}
                </Field>
              )}
            </div>
          )}

          {/* ── STEP 4: Payment & Review ── */}
          {step === 3 && (
            <div className="flex flex-col gap-5">
              {/* Email */}
              <Field
                label="Email"
                htmlFor="email"
                hint="Optional"
                error={errors.email?.message as string | undefined}
              >
                <Input
                  id="email"
                  type="email"
                  placeholder="customer@example.com (leave blank if none)"
                  maxLength={254}
                  aria-invalid={Boolean(errors.email)}
                  className="h-9"
                  {...register("email")}
                />
                <label className="mt-1 flex cursor-pointer items-center gap-2 text-sm text-slate-500 select-none">
                  <Controller
                    control={control}
                    name="isTestEmail"
                    render={({ field }) => (
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) =>
                          field.onChange(checked === true)
                        }
                      />
                    )}
                  />
                  This is a placeholder / test email (hidden from the customer)
                </label>
                {isTestEmail && (
                  <p className="text-xs text-slate-400">
                    The customer can replace this with a real email later.
                  </p>
                )}
              </Field>

              {/* Payment toggle */}
              <div className={cn(
                "flex items-center justify-between gap-4 rounded-xl border-2 p-4 transition-all duration-200",
                paymentStatus === "PAID"
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-slate-200 bg-white",
              )}>
                <div className="flex flex-col gap-0.5">
                  <p className={cn(
                    "text-sm font-semibold transition-colors duration-200",
                    paymentStatus === "PAID" ? "text-emerald-800" : "text-slate-800",
                  )}>
                    Payment collected at counter
                  </p>
                  <p className={cn(
                    "text-xs transition-colors duration-200",
                    paymentStatus === "PAID" ? "text-emerald-600" : "text-slate-500",
                  )}>
                    {paymentStatus === "PAID"
                      ? "✓ Marked as paid — onboarding can proceed"
                      : "Onboarding requires payment to be marked PAID"}
                  </p>
                </div>
                <Controller
                  control={control}
                  name="paymentStatus"
                  render={({ field }) => (
                    <Switch
                      checked={field.value === "PAID"}
                      onCheckedChange={(checked) =>
                        field.onChange(checked ? "PAID" : "PENDING")
                      }
                      aria-label="Mark payment collected"
                    />
                  )}
                />
              </div>

              {/* ── Delivery Charge Section (Req 7.1–7.7) ── */}
              {primaryCategory === "MEAL" && (
                <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center gap-2">
                    <Truck className="h-4 w-4 text-slate-500" />
                    <p className="text-sm font-semibold text-slate-800">Delivery Charges</p>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isCalculatingDelivery || !addressResolved}
                      onClick={handleCalculateDeliveryCharge}
                    >
                      {isCalculatingDelivery && (
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      )}
                      Calculate Delivery Charges
                    </Button>

                    <div className="flex-1 max-w-xs space-y-1">
                      <label className="text-xs font-medium text-slate-500">
                        Delivery Charge (₹)
                      </label>
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

                  {selectedPlan && (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                      <p className="text-xs font-medium text-emerald-800">
                        Total Payable: ₹{(selectedPlan.price + (deliveryCharge ?? 0)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      <span className="text-xs text-emerald-600">
                        (Plan ₹{selectedPlan.price.toLocaleString("en-IN")} + Delivery ₹{(deliveryCharge ?? 0).toFixed(2)})
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Review summary */}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-3">
                  <CheckCircle2 className="h-4 w-4 text-slate-500" />
                  <p className="text-sm font-semibold text-slate-800">Review summary</p>
                </div>
                <div className="p-4">
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-2">
                    <ReviewRow label="Name" value={values.fullName} />
                    <ReviewRow label="Mobile" value={values.mobile} />
                    <ReviewRow label="Gender" value={values.gender} />
                    <ReviewRow label="Diet" value={values.dietaryPreference} />
                    <ReviewRow label="Category" value={values.primaryCategory} />
                    
                    {/* Conditional rendering based on category */}
                    {primaryCategory === "KIT" ? (
                      <>
                        {/* KIT Product Information */}
                        <ReviewRow
                          label="KIT Product"
                          value={
                            selectedKitProduct
                              ? selectedKitProduct.name
                              : "—"
                          }
                          span
                        />
                        {selectedKitProduct && (
                          <>
                            <ReviewRow
                              label="Base Price"
                              value={`₹${(selectedKitProduct.base_price / 1.05).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                            />
                            <ReviewRow
                              label="Tax (5%)"
                              value={`₹${(selectedKitProduct.base_price - selectedKitProduct.base_price / 1.05).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                            />
                            <ReviewRow
                              label="Total Price"
                              value={`₹${selectedKitProduct.base_price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                              highlight
                            />
                            <ReviewRow
                              label="Duration"
                              value={values.kitDurationDays ? `${values.kitDurationDays} days` : "—"}
                            />
                          </>
                        )}
                      </>
                    ) : primaryCategory === "ACCOMMODATION" ? (
                      <>
                        {/* Accommodation Information */}
                        <ReviewRow label="Stay type" value={values.stayType} />
                        <ReviewRow label="Occupancy" value={values.occupancyType} />
                        <ReviewRow label="Total nights" value={values.totalNights ? `${values.totalNights} nights` : "—"} />
                        <ReviewRow label="Meal preference" value={values.initialMealPreference} />
                        {isSharedPayment ? (
                          <>
                            <ReviewRow label="Payment" value="Shared payment" />
                            <ReviewRow label="Payment host" value={values.paymentHostMobile || "—"} />
                          </>
                        ) : (
                          <>
                            <ReviewRow
                              label="Total stay amount"
                              value={values.totalStayAmount ? `₹${Number(values.totalStayAmount).toLocaleString("en-IN")}` : "—"}
                              highlight
                            />
                            <ReviewRow
                              label="Advance paid"
                              value={values.advanceAmountPaid != null ? `₹${Number(values.advanceAmountPaid).toLocaleString("en-IN")}` : "₹0"}
                            />
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        {/* MEAL Plan Information */}
                        <ReviewRow
                          label="Plan"
                          value={
                            selectedPlan
                              ? `${selectedPlan.name} (₹${selectedPlan.price.toLocaleString("en-IN")})`
                              : "—"
                          }
                        />
                        {deliveryCharge !== null && deliveryCharge > 0 && (
                          <ReviewRow
                            label="Delivery"
                            value={`₹${deliveryCharge.toFixed(2)}`}
                          />
                        )}
                        {selectedPlan && deliveryCharge !== null && deliveryCharge > 0 && (
                          <ReviewRow
                            label="Total"
                            value={`₹${(selectedPlan.price + deliveryCharge).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                            highlight
                          />
                        )}
                      </>
                    )}
                    
                    <ReviewRow label="Start date" value={values.startDate} />
                    <ReviewRow
                      label="Payment"
                      value={paymentStatus === "PAID" ? "✓ Paid" : "Pending"}
                      highlight={paymentStatus === "PAID"}
                    />
                    {!isAccommodation && (
                    <ReviewRow
                      label="Address"
                      value={
                        addressResolved
                          ? `${address.flatNumber}, ${address.area}, ${address.city} - ${address.pincode}`
                          : "Incomplete"
                      }
                      span
                    />
                    )}
                    {/* Temp PIN with show/hide toggle */}
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Temp PIN</dt>
                      <dd className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800 tabular-nums tracking-widest">
                          {tempPin
                            ? showPin
                              ? tempPin
                              : "••••••"
                            : "Not set"}
                        </span>
                        {tempPin && (
                          <button
                            type="button"
                            onClick={() => setShowPin((v) => !v)}
                            className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={showPin ? "Hide PIN" : "Show PIN"}
                          >
                            {showPin
                              ? <><EyeOff className="h-3.5 w-3.5" />Hide</>
                              : <><Eye className="h-3.5 w-3.5" />Show</>}
                          </button>
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              {/* Automation Override Acknowledgment — Req 5.2, 5.3, 5.4, 5.5, 5.7 */}
              {showAutomationOverride && (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Automation override confirmation</AlertTitle>
                  <AlertDescription>
                    <label className="mt-2 flex cursor-pointer items-start gap-2">
                      <Controller
                        control={control}
                        name="automationOverrideAcknowledged"
                        render={({ field }) => (
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(checked) =>
                              field.onChange(checked === true)
                            }
                            aria-label="Acknowledge automation override"
                          />
                        )}
                      />
                      <span className="text-sm text-red-600">
                        I understand automation needs to run again by operation admin. I have received confirmation from process admin to process this onboarding customer.
                      </span>
                    </label>
                  </AlertDescription>
                </Alert>
              )}

              {paymentStatus !== "PAID" && (
                <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  Payment must be marked PAID before onboarding can proceed.
                </p>
              )}
            </div>
          )}

        </div>{/* /step content */}
      </div>{/* /step panel */}

      {/* ── Navigation ── */}
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={goBack}
          disabled={step === 0 || isSubmitting}
          className="gap-1.5"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="flex items-center gap-1.5">
          {(isAccommodation ? [0, 1, 3] : [0, 1, 2, 3]).map((i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                i === step
                  ? "w-6 bg-primary"
                  : i < step
                    ? "w-1.5 bg-emerald-500"
                    : "w-1.5 bg-slate-200",
              )}
            />
          ))}
        </div>

        {step !== 3 ? (
          <Button type="button" size="sm" onClick={goNext} disabled={isSubmitting} className="gap-1.5">
            Next
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!canOnboard}
                    className="gap-1.5"
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    Onboard Customer
                  </Button>
                </span>
              </TooltipTrigger>
              {paymentStatus !== "PAID" && (
                <TooltipContent>
                  <p>Payment must be marked as PAID before completing onboarding</p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* ── Past Day Status Popup ── (Req 1.5, 3.1, 3.2) */}
      <PastDayStatusPopup
        open={showPastDayPopup}
        startDate={values.startDate ?? ""}
        endDate={pastDayStatusBoundary(now)}
        onConfirm={(entries) => {
          setValue("pastDayStatuses", entries);
          setShowPastDayPopup(false);
          setStep((prev) => Math.min(prev + 1, STEPS.length - 1) as StepIndex);
        }}
        onCancel={() => {
          setShowPastDayPopup(false);
        }}
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_SUBTITLES = [
  "Basic customer information and security PIN",
  "Choose meal category and subscription plan",
  "Map-based delivery address capture",
  "Payment confirmation and final review",
] as const;

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

function Stepper({ current, steps, icons, isAccommodation }: { current: number; steps: readonly string[]; icons: readonly (typeof User)[]; isAccommodation: boolean }) {
  // For accommodation, map internal step indices to display indices
  const stepIndices = isAccommodation ? [0, 1, 3] : Array.from({ length: steps.length }, (_, i) => i);

  return (
    <nav aria-label="Onboarding steps">
      <ol className="flex items-center gap-0">
        {steps.map((label, displayIndex) => {
          const internalIndex = stepIndices[displayIndex];
          const state =
            internalIndex === current ? "active" : internalIndex < current ? "done" : "todo";
          const Icon = icons[displayIndex];
          return (
            <li key={label} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all duration-300 shadow-sm",
                    state === "active"
                      ? "border-primary bg-primary text-primary-foreground shadow-primary/25"
                      : state === "done"
                        ? "border-emerald-500 bg-emerald-500 text-white shadow-emerald-500/25"
                        : "border-slate-200 bg-white text-slate-400",
                  )}
                  aria-current={state === "active" ? "step" : undefined}
                >
                  {state === "done" ? (
                    <Check className="h-4 w-4" strokeWidth={2.5} />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </span>
                <span
                  className={cn(
                    "hidden text-xs font-medium sm:block transition-colors duration-300",
                    state === "active"
                      ? "text-primary"
                      : state === "done"
                        ? "text-emerald-600"
                        : "text-slate-400",
                  )}
                >
                  {label}
                </span>
              </div>

              {/* Connector */}
              {displayIndex < steps.length - 1 && (
                <div className="relative mx-2 h-0.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={cn(
                      "absolute inset-y-0 left-0 transition-all duration-500",
                      internalIndex < current ? "w-full bg-emerald-500" : "w-0 bg-primary",
                    )}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-1.5">
        <Label htmlFor={htmlFor} className="text-sm font-medium text-slate-700">
          {label}
          {required && <span className="ml-0.5 text-destructive">*</span>}
        </Label>
        {hint && (
          <span className="text-xs text-slate-400 font-normal">{hint}</span>
        )}
      </div>
      {children}
      {error && (
        <p className="flex items-center gap-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function ReviewRow({
  label,
  value,
  highlight,
  span,
}: {
  label: string;
  value?: string;
  highlight?: boolean;
  span?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", span && "col-span-2")}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd
        className={cn(
          "text-sm font-semibold",
          highlight ? "text-emerald-700" : "text-slate-800",
        )}
      >
        {value || "—"}
      </dd>
    </div>
  );
}

export default QuickOnboardingForm;
