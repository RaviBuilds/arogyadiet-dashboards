"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { addDays, format, startOfDay } from "date-fns";
import { useRouter } from "next/navigation";
import { CalendarIcon, Clock3, IndianRupee, Loader2, PauseCircle } from "lucide-react";

import { addSubscription } from "@/actions/admin-actions/adminSubscriptionActions";
import { cn } from "@/lib/utils";

import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
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

// ─── types ───────────────────────────────────────────────────────────────────

type SubscriptionPlan = {
  id: string;
  name: string;
  price: number;
  duration_days: number;
  pause_credits: number;
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
}

export function AdminAddSubscriptionForm({
  customerProfileId,
  initialData,
}: AdminAddSubscriptionFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isStartDateOpen, setIsStartDateOpen] = useState(false);
  const [isEndDateOpen, setIsEndDateOpen] = useState(false);

  const { activeSubscription, subscriptionPlans, mealCategories, addresses } =
    initialData;

  const minStartDate = useMemo(
    () => getMinStartDate(activeSubscription?.effective_end_on ?? null),
    [activeSubscription?.effective_end_on],
  );

  const willBePending = activeSubscription !== null;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      mode: "existing",
      startDate: minStartDate,
      paymentStatus: "Payment Pending",
      paymentReference: "",
      paymentNotes: "",
      taxPercent: 0,
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

  const selectedPlan = subscriptionPlans.find((p) => p.id === planId);

  // Auto-fill plan details when plan / startDate changes
  useEffect(() => {
    if (mode === "existing" && selectedPlan && startDate) {
      setValue("basePrice", selectedPlan.price);
      setValue("taxPercent", 0);
      setValue("taxAmount", 0);
      setValue("totalAmount", selectedPlan.price);
      setValue("pauseCredits", selectedPlan.pause_credits);
      setValue("endDate", addDays(startDate, selectedPlan.duration_days - 1));
    }
  }, [mode, selectedPlan, startDate, setValue]);

  // Auto-calculate tax & total in custom mode
  useEffect(() => {
    if (mode === "custom" && basePrice !== undefined && taxPercent !== undefined) {
      const tax = parseFloat((basePrice * (taxPercent / 100)).toFixed(2));
      const total = parseFloat((basePrice + tax).toFixed(2));
      setValue("taxAmount", tax);
      setValue("totalAmount", total);
    }
  }, [mode, basePrice, taxPercent, setValue]);

  const onSubmit = (values: FormValues) => {
    startTransition(async () => {
      const isCustom = values.mode === "custom";

      const commonPaymentFields = {
        paymentStatus: values.paymentStatus,
        paymentReference: values.paymentReference || undefined,
        paymentNotes: values.paymentNotes || undefined,
      };

      const payload = isCustom
        ? {
            customerProfileId,
            mealCategoryId: values.mealCategoryId,
            deliveryAddressId: values.deliveryAddressId,
            ...commonPaymentFields,
            startDate: format(values.startDate, "yyyy-MM-dd"),
            basePrice: values.basePrice!,
            taxPercent: values.taxPercent ?? 0,
            taxAmount: values.taxAmount ?? 0,
            totalAmount: values.totalAmount!,
            pauseCredits: values.pauseCredits!,
            endDate: format(values.endDate!, "yyyy-MM-dd"),
          }
        : {
            customerProfileId,
            mealCategoryId: values.mealCategoryId,
            deliveryAddressId: values.deliveryAddressId,
            ...commonPaymentFields,
            startDate: format(values.startDate, "yyyy-MM-dd"),
            planId: values.planId!,
          };

      const res = await addSubscription(payload, isCustom);

      if (res.success) {
        toast.success("Subscription created successfully!");
        reset({
          mode: "existing",
          startDate: minStartDate,
          paymentStatus: "Payment Pending",
          paymentReference: "",
          paymentNotes: "",
          taxPercent: 0,
        });
        router.refresh();
      } else {
        toast.error(res.error ?? "Failed to create subscription.");
      }
    });
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
                        defaultMonth={field.value ?? minStartDate}
                        selected={field.value}
                        onSelect={(date) => {
                          if (!date) return;
                          field.onChange(date);
                          setIsStartDateOpen(false);
                        }}
                        disabled={(date) => date < minStartDate}
                      />
                    </PopoverContent>
                  </Popover>
                )}
              />
              <p className="text-xs text-muted-foreground">
                Earliest allowed:{" "}
                <span className="font-medium">{format(minStartDate, "PPP")}</span>
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

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              A unique subscription code will be auto-generated.
            </p>
            <Button type="submit" disabled={isPending || addresses.length === 0}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Subscription
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
