"use client";

// src/shared/components/admin/customers/QuickOnboardingForm.tsx
// UI/UX refresh — all data logic and validation unchanged.

import { useMemo, useState, useTransition } from "react";
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
  ONBOARDING_CUTOFF_HOUR_IST,
} from "@/lib/onboarding/cutoff";
import { istHourOf } from "@/lib/dates/ist";
import { onboardCustomerAction, checkMobileUniqueAction } from "@/actions/admin-actions/onboardingActions";
import { cn } from "@/lib/utils";
import type { KitProduct } from "@/types/kitProduct";
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
  clinics: { id: string; name: string }[];
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
  paymentStatus: z.enum(["PAID", "PENDING"]),
  cutoffAcknowledged: z.boolean().default(false),
});

type DetailsFormValues = z.input<typeof detailsSchema>;

const STEPS = ["Details", "Category & Plan", "Address", "Payment & Review"] as const;
type StepIndex = 0 | 1 | 2 | 3;

const STEP_ICONS = [User, Utensils, MapPin, CreditCard] as const;

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
  clinics,
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
  const [selectedClinicId, setSelectedClinicId] = useState<string>("");

  const {
    register,
    control,
    handleSubmit,
    trigger,
    setError,
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
      paymentStatus: "PENDING",
      cutoffAcknowledged: false,
    },
  });

  const values = useWatch({ control });
  const paymentStatus = values.paymentStatus;
  const cutoffAcknowledged = values.cutoffAcknowledged;
  const isTestEmail = values.isTestEmail;
  const primaryCategory = values.primaryCategory;
  const selectedPlanId = values.planId;
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;
  const selectedKitProductId = values.kitProductId;
  const selectedKitProduct = kitProducts.find((k) => k.id === selectedKitProductId) ?? null;
  const addressResolved = Boolean(addressValidity?.canSave);

  const canOnboard =
    !isSubmitting &&
    paymentStatus === "PAID" &&
    (!isAfterCutoff || cutoffAcknowledged) &&
    addressResolved;

  const goNext = async () => {
    const fields = STEP_FIELDS[step];
    
    // For step 1, filter fields based on category selection
    let fieldsToValidate = fields;
    if (step === 1) {
      const category = values.primaryCategory;
      if (category === "KIT") {
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

    if (step === 2) {
      setAddressTouched(true);
      if (!addressResolved) return;
    }
    if (!valid) return;
    setStep((prev) => Math.min(prev + 1, STEPS.length - 1) as StepIndex);
  };

  const goBack = () => setStep((prev) => Math.max(prev - 1, 0) as StepIndex);

  const applyServerFieldErrors = (fieldErrors?: Record<string, string>) => {
    if (!fieldErrors) return;
    let jumpToAddress = false;
    let jumpToDetails = false;
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
      setError(key as keyof DetailsFormValues, { type: "server", message });
    }
    if (jumpToAddress) setStep(2);
    else if (jumpToDetails) setStep(0);
  };

  const onSubmit = (values: DetailsFormValues) => {
    setAddressServerError(null);
    setTempPinError(null);

    if (!addressResolved) {
      setAddressTouched(true);
      setStep(2);
      toast.error("Complete the address before onboarding.");
      return;
    }

    if (!isValidPinFormat(tempPin)) {
      setTempPinError("Temporary PIN must be exactly 6 digits.");
      setStep(0);
      toast.error("Enter a valid 6-digit temporary PIN.");
      return;
    }

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
      clinicId: selectedClinicId && selectedClinicId !== "none" ? selectedClinicId : undefined,
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
      <Stepper current={step} />

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
            Step {step + 1} of {STEPS.length}
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

              <Field label="Clinic" htmlFor="clinicId" hint="Optional — required for KIT customers">
                <Select value={selectedClinicId} onValueChange={setSelectedClinicId}>
                  <SelectTrigger id="clinicId" aria-label="Clinic" className="h-9">
                    <SelectValue placeholder="Select clinic" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No clinic</SelectItem>
                    {clinics.map((clinic) => (
                      <SelectItem key={clinic.id} value={clinic.id}>
                        {clinic.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

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

              {primaryCategory !== "KIT" && (
                <Field label="Subscription start date" htmlFor="startDate" error={errors.startDate?.message} required>
                  <Input
                    id="startDate"
                    type="date"
                    min={earliest}
                    aria-invalid={Boolean(errors.startDate)}
                    className="h-9 max-w-xs"
                    {...register("startDate")}
                  />
                  <p className="text-xs text-slate-500">Earliest selectable start date is {earliest}.</p>
                </Field>
              )}

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

              {isAfterCutoff && (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Past the 5 PM cutoff</AlertTitle>
                  <AlertDescription>
                    It is past the 5:00 PM cutoff. Please contact the operations admin to confirm whether
                    the delivery automation can be re-run, and select only the next-day or day-after start date.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* ── STEP 3: Address ── */}
          {step === 2 && (
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
                      </>
                    )}
                    
                    <ReviewRow label="Start date" value={values.startDate} />
                    <ReviewRow
                      label="Payment"
                      value={paymentStatus === "PAID" ? "✓ Paid" : "Pending"}
                      highlight={paymentStatus === "PAID"}
                    />
                    <ReviewRow
                      label="Address"
                      value={
                        addressResolved
                          ? `${address.flatNumber}, ${address.area}, ${address.city} - ${address.pincode}`
                          : "Incomplete"
                      }
                      span
                    />
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

              {/* Cutoff acknowledgment */}
              {isAfterCutoff && (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Cutoff acknowledgment required</AlertTitle>
                  <AlertDescription>
                    <label className="mt-2 flex cursor-pointer items-start gap-2">
                      <Controller
                        control={control}
                        name="cutoffAcknowledged"
                        render={({ field }) => (
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(checked) =>
                              field.onChange(checked === true)
                            }
                            aria-label="Acknowledge cutoff"
                          />
                        )}
                      />
                      <span>
                        I have confirmed with the operations admin that the automation
                        can be re-run, and I have selected only the next-day or day-after start date.
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
          {STEPS.map((_, i) => (
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

        {step < STEPS.length - 1 ? (
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

function Stepper({ current }: { current: number }) {
  return (
    <nav aria-label="Onboarding steps">
      <ol className="flex items-center gap-0">
        {STEPS.map((label, index) => {
          const state =
            index === current ? "active" : index < current ? "done" : "todo";
          const Icon = STEP_ICONS[index];
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
              {index < STEPS.length - 1 && (
                <div className="relative mx-2 h-0.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={cn(
                      "absolute inset-y-0 left-0 transition-all duration-500",
                      index < current ? "w-full bg-emerald-500" : "w-0 bg-primary",
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
