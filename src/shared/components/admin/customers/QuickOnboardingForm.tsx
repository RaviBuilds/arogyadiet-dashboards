"use client";

// src/shared/components/admin/customers/QuickOnboardingForm.tsx
//
// Admin Quick_Onboarding_Form wizard (Task 9.2). A four-step client wizard:
//   1. Details        — name, mobile, gender, diet, allergies (Req 4.1-4.3)
//   2. Category/Plan   — exactly one Primary_Category (default MEAL), a plan,
//                        and a subscription start date (Req 4.4, 13.2)
//   3. Address         — map-based Address_Capture (Req 4.5, 5)
//   4. Payment/Review  — mark-payment-collected control setting Payment_Status,
//                        Test_Email field + checkbox, and a review before submit
//                        (Req 8.5, 10.2)
//
// The 5 PM (17:00 IST) cutoff (Req 7) restricts the start-date picker to the
// earliest selectable date; at/after the cutoff a warning is shown and the
// "Onboard Customer" button is gated behind an acknowledgment checkbox.
//
// Validation uses React Hook Form + Zod (the repo convention). Scalar fields are
// bound with a zod resolver over the shared onboarding schema (address handled
// by AddressCaptureMap); on submit the payload is sent to onboardCustomerAction,
// which re-validates server-side and returns dotted `fieldErrors`
// (e.g. `address.pincode`) that are rendered inline while entered values are
// retained (Req 4.6).
//
// Requirements: 4.1-4.6, 7.1-7.6, 8.5, 10.2, 13.2, 15.2/15.3/15.6-15.11

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
} from "lucide-react";

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
import { Card, CardContent } from "@/shared/components/ui/card";

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
import { onboardCustomerAction } from "@/actions/admin-actions/onboardingActions";

/** A subscription plan option for the Category/Plan step (Req 4.4). */
export interface OnboardingPlan {
  id: string;
  name: string;
  price: number;
  durationDays: number;
}

export interface QuickOnboardingFormProps {
  /** Active subscription plans, loaded by the RSC shell. */
  plans: OnboardingPlan[];
  /** The franchise's serviceable pincodes for the Address_Capture gate (Req 5.6). */
  serviceAreaPincodes: string[];
}

// ---------------------------------------------------------------------------
// Scalar-field schema (address is validated by AddressCaptureMap separately).
// Empty email is coerced to undefined so an untouched optional field validates.
// ---------------------------------------------------------------------------

const detailsSchema = z.object({
  fullName: z
    .string()
    .min(1, "Name is required.")
    .max(100, "Name must be at most 100 characters."),
  mobile: z
    .string()
    .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number."),
  gender: z.enum(["Male", "Female", "Other"], {
    message: "Select a gender.",
  }),
  dietaryPreference: z.enum(["Veg", "Non-Veg"], {
    message: "Select a diet preference.",
  }),
  allergies: z
    .string()
    .max(500, "Allergies must be at most 500 characters.")
    .optional(),
  email: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z
      .string()
      .max(254, "Email must be at most 254 characters.")
      .email("Enter a valid email address.")
      .optional(),
  ),
  isTestEmail: z.boolean().default(false),
  primaryCategory: z.enum(CUSTOMER_CATEGORIES),
  planId: z.string().uuid("Select a subscription plan."),
  startDate: z.string().min(1, "Start date is required."),
  paymentStatus: z.enum(["PAID", "PENDING"]),
  cutoffAcknowledged: z.boolean().default(false),
});

type DetailsFormValues = z.input<typeof detailsSchema>;

const STEPS = ["Details", "Category & Plan", "Address", "Payment & Review"] as const;
type StepIndex = 0 | 1 | 2 | 3;

/** Fields validated before advancing past each step. */
const STEP_FIELDS: Record<number, (keyof DetailsFormValues)[]> = {
  0: ["fullName", "mobile", "gender", "dietaryPreference", "allergies"],
  1: ["primaryCategory", "planId", "startDate"],
  2: [],
  3: ["email", "paymentStatus"],
};

export function QuickOnboardingForm({
  plans,
  serviceAreaPincodes,
}: QuickOnboardingFormProps) {
  const router = useRouter();
  const [isSubmitting, startTransition] = useTransition();
  const [step, setStep] = useState<StepIndex>(0);

  // Capture the instant the wizard mounted so cutoff evaluation is stable for
  // the session; the server re-checks against its own clock on submit (Req 7.7).
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
  const [addressServerError, setAddressServerError] = useState<string | null>(
    null,
  );
  const [addressTouched, setAddressTouched] = useState(false);

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
      primaryCategory: "MEAL", // Req: default Primary_Category is MEAL.
      planId: undefined,
      startDate: earliest, // Restrict earliest selectable date (Req 7.5/7.6).
      paymentStatus: "PENDING",
      cutoffAcknowledged: false,
    },
  });

  const values = useWatch({ control });
  const paymentStatus = values.paymentStatus;
  const cutoffAcknowledged = values.cutoffAcknowledged;
  const isTestEmail = values.isTestEmail;
  const selectedPlanId = values.planId;
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;

  const addressResolved = Boolean(addressValidity?.canSave);

  // The "Onboard Customer" gate (Req 7.2/7.3/7.4, 8.1, 5.6/5.8).
  const canOnboard =
    !isSubmitting &&
    paymentStatus === "PAID" &&
    (!isAfterCutoff || cutoffAcknowledged) &&
    addressResolved;

  const goNext = async () => {
    const fields = STEP_FIELDS[step];
    const valid = fields.length === 0 ? true : await trigger(fields);
    if (step === 2) {
      // Address step: gate on the AddressCaptureMap validity (Req 5.6/5.8).
      setAddressTouched(true);
      if (!addressResolved) return;
    }
    if (!valid) return;
    setStep((prev) => Math.min(prev + 1, STEPS.length - 1) as StepIndex);
  };

  const goBack = () =>
    setStep((prev) => Math.max(prev - 1, 0) as StepIndex);

  const applyServerFieldErrors = (fieldErrors?: Record<string, string>) => {
    if (!fieldErrors) return;
    let jumpToAddress = false;
    for (const [key, message] of Object.entries(fieldErrors)) {
      if (key.startsWith("address")) {
        setAddressServerError(message);
        jumpToAddress = true;
        continue;
      }
      setError(key as keyof DetailsFormValues, {
        type: "server",
        message,
      });
    }
    if (jumpToAddress) setStep(2);
  };

  const onSubmit = (values: DetailsFormValues) => {
    setAddressServerError(null);

    if (!addressResolved) {
      setAddressTouched(true);
      setStep(2);
      toast.error("Complete the address before onboarding.");
      return;
    }

    // Assemble the payload for the server action. lat/lng are guaranteed present
    // because addressResolved implies the AddressCaptureMap reported canSave.
    const payload = {
      ...values,
      allergies:
        values.allergies && values.allergies.trim() !== ""
          ? values.allergies
          : undefined,
      address: {
        tag: address.tag,
        searchText: address.searchText,
        flatNumber: address.flatNumber,
        floorNumber: address.floorNumber,
        area: address.area,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        lat: address.lat,
        lng: address.lng,
      },
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
      <Stepper current={step} />

      <Card>
        <CardContent className="pt-6">
          {/* ── STEP 1: Details ── */}
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <Field label="Full name" htmlFor="fullName" error={errors.fullName?.message}>
                <Input
                  id="fullName"
                  placeholder="e.g. Rahul Sharma"
                  maxLength={100}
                  aria-invalid={Boolean(errors.fullName)}
                  {...register("fullName")}
                />
              </Field>

              <Field label="Mobile number" htmlFor="mobile" error={errors.mobile?.message}>
                <Input
                  id="mobile"
                  inputMode="numeric"
                  placeholder="10-digit mobile"
                  maxLength={10}
                  aria-invalid={Boolean(errors.mobile)}
                  {...register("mobile")}
                />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Gender" htmlFor="gender" error={errors.gender?.message}>
                  <Controller
                    control={control}
                    name="gender"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger
                          id="gender"
                          aria-label="Gender"
                          aria-invalid={Boolean(errors.gender)}
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

                <Field label="Diet preference" error={errors.dietaryPreference?.message}>
                  <Controller
                    control={control}
                    name="dietaryPreference"
                    render={({ field }) => (
                      <RadioGroup
                        className="flex gap-3"
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        {(["Veg", "Non-Veg"] as const).map((pref) => (
                          <label
                            key={pref}
                            className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm has-data-checked:border-primary has-data-checked:bg-primary/5"
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

              <Field
                label="Allergies (optional)"
                htmlFor="allergies"
                error={errors.allergies?.message}
              >
                <Textarea
                  id="allergies"
                  rows={2}
                  maxLength={500}
                  placeholder="e.g. No peanuts, no dairy..."
                  {...register("allergies")}
                />
              </Field>
            </div>
          )}

          {/* ── STEP 2: Category & Plan ── */}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <Field label="Primary category" error={errors.primaryCategory?.message}>
                <Controller
                  control={control}
                  name="primaryCategory"
                  render={({ field }) => (
                    <RadioGroup
                      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      {CUSTOMER_CATEGORIES.map((category) => (
                        <label
                          key={category}
                          className="flex cursor-pointer items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm has-data-checked:border-primary has-data-checked:bg-primary/5"
                        >
                          <RadioGroupItem value={category} aria-label={category} />
                          {category === "MEAL"
                            ? "Meal"
                            : category === "KIT"
                              ? "Kit"
                              : "Accommodation"}
                        </label>
                      ))}
                    </RadioGroup>
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  Exactly one category is selected at onboarding. Others can be
                  added later as paid add-ons.
                </p>
              </Field>

              <Field label="Subscription plan" htmlFor="planId" error={errors.planId?.message}>
                <Controller
                  control={control}
                  name="planId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger
                        id="planId"
                        aria-label="Subscription plan"
                        aria-invalid={Boolean(errors.planId)}
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
                              {plan.durationDays
                                ? ` (${plan.durationDays} days)`
                                : ""}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <Field
                label="Subscription start date"
                htmlFor="startDate"
                error={errors.startDate?.message}
              >
                <Input
                  id="startDate"
                  type="date"
                  min={earliest}
                  aria-invalid={Boolean(errors.startDate)}
                  {...register("startDate")}
                />
                <p className="text-xs text-muted-foreground">
                  Earliest selectable start date is {earliest}.
                </p>
              </Field>

              {/* Req 7.1: at/after the 5 PM IST cutoff, warn and require ack. */}
              {isAfterCutoff && (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Past the 5 PM cutoff</AlertTitle>
                  <AlertDescription>
                    It is past the 5:00 PM cutoff. Please contact the operations
                    admin to confirm whether the delivery automation can be
                    re-run for this customer, and select only the next-day date
                    or the day-after date as the subscription start date.
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
                <p className="text-xs text-destructive">
                  Complete the address: select a serviceable location on the map
                  and enter the flat number.
                </p>
              )}
            </div>
          )}

          {/* ── STEP 4: Payment & Review ── */}
          {step === 3 && (
            <div className="flex flex-col gap-5">
              {/* Req 10.2: optional email + Test_Email checkbox. */}
              <Field
                label="Email (optional)"
                htmlFor="email"
                error={errors.email?.message as string | undefined}
              >
                <Input
                  id="email"
                  type="email"
                  placeholder="customer@example.com (leave blank if none)"
                  maxLength={254}
                  aria-invalid={Boolean(errors.email)}
                  {...register("email")}
                />
                <label className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
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
                  <p className="text-xs text-muted-foreground">
                    The customer can replace this with a real email later.
                  </p>
                )}
              </Field>

              {/* Req 8.5: manual mark-payment-collected control setting Payment_Status. */}
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="text-sm font-medium">Payment collected at counter</p>
                  <p className="text-xs text-muted-foreground">
                    Onboarding requires payment to be marked PAID (Req 8.1).
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
              <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                <p className="mb-2 font-semibold">Review</p>
                <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  <ReviewRow label="Name" value={values.fullName} />
                  <ReviewRow label="Mobile" value={values.mobile} />
                  <ReviewRow label="Gender" value={values.gender} />
                  <ReviewRow label="Diet" value={values.dietaryPreference} />
                  <ReviewRow label="Category" value={values.primaryCategory} />
                  <ReviewRow
                    label="Plan"
                    value={
                      selectedPlan
                        ? `${selectedPlan.name} (₹${selectedPlan.price.toLocaleString("en-IN")})`
                        : "—"
                    }
                  />
                  <ReviewRow label="Start date" value={values.startDate} />
                  <ReviewRow
                    label="Payment"
                    value={paymentStatus === "PAID" ? "Paid" : "Pending"}
                  />
                  <ReviewRow
                    label="Address"
                    value={
                      addressResolved
                        ? `${address.flatNumber}, ${address.area}, ${address.city} - ${address.pincode}`
                        : "Incomplete"
                    }
                  />
                </dl>
              </div>

              {/* Req 7.1-7.4: cutoff acknowledgment gate. */}
              {isAfterCutoff && (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Cutoff acknowledgment required</AlertTitle>
                  <AlertDescription>
                    <label className="mt-2 flex items-start gap-2">
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
                        I have confirmed with the operations admin that the
                        automation can be re-run, and I have selected only the
                        next-day or day-after start date.
                      </span>
                    </label>
                  </AlertDescription>
                </Alert>
              )}

              {paymentStatus !== "PAID" && (
                <p className="text-xs text-destructive">
                  Payment must be marked PAID before onboarding can proceed.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={goBack}
          disabled={step === 0 || isSubmitting}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back
        </Button>

        {step < STEPS.length - 1 ? (
          <Button type="button" onClick={goNext} disabled={isSubmitting}>
            Next
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        ) : (
          <Button type="submit" disabled={!canOnboard}>
            {isSubmitting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
            )}
            Onboard Customer
          </Button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {STEPS.map((label, index) => {
        const state =
          index === current ? "active" : index < current ? "done" : "todo";
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors ${
                state === "active"
                  ? "border-primary bg-primary text-primary-foreground"
                  : state === "done"
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-muted-foreground/30 text-muted-foreground"
              }`}
            >
              {state === "done" ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span
              className={`text-xs font-medium ${
                state === "active" ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {label}
            </span>
            {index < STEPS.length - 1 && (
              <span className="hidden h-px w-6 bg-muted-foreground/20 sm:block" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between gap-3 sm:block">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value || "—"}</dd>
    </div>
  );
}

export default QuickOnboardingForm;
