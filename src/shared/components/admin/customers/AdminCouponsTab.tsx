"use client";

import React, { useEffect, useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  CalendarIcon,
  Loader2,
  Plus,
  Tag,
  Trash2,
  TicketPercent,
} from "lucide-react";

import {
  createCoupon,
  createGlobalCoupon,
  deleteCoupon,
  deleteGlobalCoupon,
  listGlobalCoupons,
} from "@/actions/admin-actions/adminCouponActions";
import { cn } from "@/lib/utils";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Badge } from "@/shared/components/ui/badge";
import { Separator } from "@/shared/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { Calendar } from "@/shared/components/ui/calendar";
import { ConfirmDeleteModal } from "../core/ConfirmDeleteModal";
import {
  getFlatDiscountForPlan,
  normalizeFlatDiscountsByPlan,
} from "@/lib/coupons/couponPlanDiscounts";

// ─── types ───────────────────────────────────────────────────────────────────

export type CouponSubscriptionPlan = {
  id: string;
  name: string;
  duration_days: number;
  is_active?: boolean;
};

export type CouponRow = {
  id: string;
  code: string;
  discount_type: "FLAT" | "PERCENTAGE";
  discount_value_30_days: number;
  discount_value_60_days: number;
  discount_value_90_days: number;
  flat_discounts_by_plan?: Record<string, number> | null;
  discount_value: number;
  max_uses: number;
  times_used: number;
  expires_at: string | null;
  created_at: string;
};

interface AdminCouponsTabProps {
  initialCoupons: CouponRow[];
  subscriptionPlans: CouponSubscriptionPlan[];
  variant?: "customer" | "global";
  customerProfileId?: string;
  /** For the global variant: "core" | franchise UUID. Scopes coupons to an entity. */
  franchiseScope?: string;
  /** Injectable per-customer create action. Defaults to admin createCoupon. */
  createCouponAction?: typeof createCoupon;
  /** Injectable per-customer delete action. Defaults to admin deleteCoupon. */
  deleteCouponAction?: typeof deleteCoupon;
  /** Injectable global list action. Defaults to admin listGlobalCoupons. */
  listGlobalCouponsAction?: typeof listGlobalCoupons;
  /** Injectable global create action. Defaults to admin createGlobalCoupon. */
  createGlobalCouponAction?: typeof createGlobalCoupon;
  /** Injectable global delete action. Defaults to admin deleteGlobalCoupon. */
  deleteGlobalCouponAction?: typeof deleteGlobalCoupon;
}

function buildDefaultFlatDiscounts(
  plans: CouponSubscriptionPlan[],
): Record<string, number> {
  return Object.fromEntries(plans.map((plan) => [plan.id, 0]));
}

function getCouponFlatDiscountLines(
  coupon: CouponRow,
  plans: CouponSubscriptionPlan[],
) {
  const byPlan = normalizeFlatDiscountsByPlan(coupon.flat_discounts_by_plan);
  const planIds = new Set([
    ...plans.map((plan) => plan.id),
    ...Object.keys(byPlan),
  ]);

  return Array.from(planIds)
    .map((planId) => {
      const plan = plans.find((item) => item.id === planId);
      const amount = getFlatDiscountForPlan(
        coupon,
        planId,
        plan?.duration_days,
      );
      if (amount <= 0) return null;

      const label = plan
        ? `${plan.name} (${plan.duration_days}d)`
        : `Plan ${planId.slice(0, 8)}`;

      return { planId, label, amount };
    })
    .filter(Boolean) as Array<{ planId: string; label: string; amount: number }>;
}

// ─── form schema ─────────────────────────────────────────────────────────────

const formSchema = z
  .object({
    code: z
      .string()
      .min(3, "At least 3 characters")
      .max(30, "Max 30 characters")
      .regex(/^[A-Z0-9_-]+$/, "Uppercase letters, numbers, - and _ only"),
    discountType: z.enum(["FLAT", "PERCENTAGE"]),
    flatDiscountsByPlan: z.record(z.string(), z.number().min(0)).optional(),
    discountValue: z.number().min(0).max(100).optional(),
    maxUses: z.number().int().min(1, "At least 1"),
    expiresAt: z.date().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.discountType === "FLAT") {
      const hasAny = Object.values(d.flatDiscountsByPlan ?? {}).some(
        (value) => value > 0,
      );
      if (!hasAny) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "At least one discount amount must be > 0",
          path: ["flatDiscountsByPlan"],
        });
      }
    }
    if (d.discountType === "PERCENTAGE") {
      if (!d.discountValue || d.discountValue <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Percentage must be > 0",
          path: ["discountValue"],
        });
      }
    }
  });

type FormValues = z.infer<typeof formSchema>;

// ─── component ───────────────────────────────────────────────────────────────

export function AdminCouponsTab({
  customerProfileId,
  initialCoupons,
  subscriptionPlans,
  variant = "customer",
  franchiseScope = "core",
  createCouponAction = createCoupon,
  deleteCouponAction = deleteCoupon,
  listGlobalCouponsAction = listGlobalCoupons,
  createGlobalCouponAction = createGlobalCoupon,
  deleteGlobalCouponAction = deleteGlobalCoupon,
}: AdminCouponsTabProps) {
  const isGlobal = variant === "global";
  const activePlans = subscriptionPlans.filter((plan) => plan.is_active !== false);
  const [coupons, setCoupons] = useState<CouponRow[]>(initialCoupons);
  const [isPending, startTransition] = useTransition();
  const [isExpiryOpen, setIsExpiryOpen] = useState(false);
  const [deleteState, setDeleteState] = useState<{
    isOpen: boolean;
    couponId: string;
    code: string;
  }>({ isOpen: false, couponId: "", code: "" });

  // Reload coupons whenever the franchise scope changes (global variant only).
  useEffect(() => {
    if (!isGlobal) return;
    let cancelled = false;
    listGlobalCouponsAction(franchiseScope).then((res) => {
      if (!cancelled && res.success) {
        setCoupons(res.data as CouponRow[]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [franchiseScope, isGlobal, listGlobalCouponsAction]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      code: "",
      discountType: "FLAT",
      flatDiscountsByPlan: buildDefaultFlatDiscounts(activePlans),
      discountValue: 0,
      maxUses: 1,
    },
  });

  const { control, watch, handleSubmit, reset, setValue, formState } = form;
  const { errors } = formState;
  const discountType = watch("discountType");

  const onSubmit = (values: FormValues) => {
    startTransition(async () => {
      const payload = {
        code: values.code,
        discountType: values.discountType,
        flatDiscountsByPlan: values.flatDiscountsByPlan ?? {},
        discountValue: values.discountValue ?? 0,
        maxUses: values.maxUses,
        expiresAt: values.expiresAt
          ? format(values.expiresAt, "yyyy-MM-dd")
          : undefined,
      };

      const res = isGlobal
        ? await createGlobalCouponAction(payload, franchiseScope)
        : await createCouponAction({
            ...payload,
            customerProfileId: customerProfileId!,
          });

      if (res.success) {
        toast.success(
          isGlobal
            ? "Global discount coupon created successfully!"
            : "Coupon created successfully!",
        );
        reset({
          code: "",
          discountType: "FLAT",
          flatDiscountsByPlan: buildDefaultFlatDiscounts(activePlans),
          discountValue: 0,
          maxUses: 1,
        });
        if (isGlobal) {
          // Refresh the scoped list in place (preserves the selected franchise).
          const refreshed = await listGlobalCouponsAction(franchiseScope);
          if (refreshed.success) setCoupons(refreshed.data as CouponRow[]);
        } else {
          window.location.reload();
        }
      } else {
        toast.error(res.error ?? "Failed to create coupon.");
      }
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const res = isGlobal
        ? await deleteGlobalCouponAction(deleteState.couponId)
        : await deleteCouponAction(deleteState.couponId, customerProfileId!);
      if (res.success) {
        toast.success("Coupon deleted.");
        setCoupons((prev) =>
          prev.filter((c) => c.id !== deleteState.couponId),
        );
        setDeleteState({ isOpen: false, couponId: "", code: "" });
      } else {
        toast.error(res.error ?? "Failed to delete coupon.");
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* ── Existing Coupons ── */}
      <Card className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <CardHeader className="space-y-0 border-b border-slate-200 bg-slate-50/50 p-6 pb-4">
          <div className="flex items-center gap-2">
            <TicketPercent className="h-5 w-5 text-emerald-600" />
            <CardTitle className="text-lg font-semibold tracking-tight text-slate-900">
              {isGlobal ? "Active Global Coupons" : "Active Coupons"}
            </CardTitle>
          </div>
          <CardDescription className="mt-1 text-sm text-slate-500">
            {isGlobal
              ? "Discount codes available to all customers during subscription checkout."
              : "Discount codes assigned to this customer."}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {coupons.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              <Tag className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No coupons yet. Create one below.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="border-b border-slate-200 bg-slate-50/50 text-xs font-medium uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Code</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Discount</th>
                    <th className="px-5 py-3">Uses</th>
                    <th className="px-5 py-3">Expires</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {coupons.map((coupon) => {
                    const isExpired =
                      coupon.expires_at &&
                      new Date(coupon.expires_at) < new Date();
                    const isExhausted =
                      coupon.times_used >= coupon.max_uses;

                    return (
                      <tr
                        key={coupon.id}
                        className="transition-colors duration-200 hover:bg-slate-50"
                      >
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-sm tracking-wide">
                              {coupon.code}
                            </span>
                            {(isExpired || isExhausted) && (
                              <Badge variant="secondary" className="text-xs">
                                {isExhausted ? "Exhausted" : "Expired"}
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs font-semibold",
                              coupon.discount_type === "FLAT"
                                ? "border-blue-200 text-blue-700 bg-blue-50"
                                : "border-purple-200 text-purple-700 bg-purple-50",
                            )}
                          >
                            {coupon.discount_type}
                          </Badge>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap text-sm">
                          {coupon.discount_type === "PERCENTAGE" ? (
                            <span className="font-semibold">
                              {coupon.discount_value}% off
                            </span>
                          ) : (
                            <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                              {getCouponFlatDiscountLines(
                                coupon,
                                subscriptionPlans,
                              ).map((line) => (
                                <span key={line.planId}>
                                  {line.label}: ₹{line.amount}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap text-sm">
                          <span
                            className={cn(
                              "font-medium",
                              isExhausted && "text-destructive",
                            )}
                          >
                            {coupon.times_used}
                          </span>
                          <span className="text-muted-foreground">
                            {" "}
                            / {coupon.max_uses}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap text-sm text-muted-foreground">
                          {coupon.expires_at ? (
                            <span
                              className={cn(isExpired && "text-destructive")}
                            >
                              {format(
                                new Date(coupon.expires_at),
                                "dd MMM yyyy",
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">
                              No expiry
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() =>
                              setDeleteState({
                                isOpen: true,
                                couponId: coupon.id,
                                code: coupon.code,
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Create Coupon Form ── */}
      <Card className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <CardHeader className="space-y-0 border-b border-slate-200 bg-slate-50/50 p-6 pb-4">
          <div className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-emerald-600" />
            <CardTitle className="text-lg font-semibold tracking-tight text-slate-900">
              {isGlobal ? "Create Global Discount" : "Create New Coupon"}
            </CardTitle>
          </div>
          <CardDescription className="mt-1 text-sm text-slate-500">
            {isGlobal
              ? "Applies to all customers during subscription checkout."
              : "Coupons are linked to this customer and applied during their checkout."}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Row 1: Code + Type + Max Uses */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>
                  Coupon Code{" "}
                  <span className="text-muted-foreground font-normal text-xs">
                    (uppercase)
                  </span>
                </Label>
                <Controller
                  control={control}
                  name="code"
                  render={({ field }) => (
                    <Input
                      {...field}
                      placeholder="e.g. SAVE500"
                      className="h-10 font-mono uppercase"
                      onChange={(e) =>
                        field.onChange(e.target.value.toUpperCase())
                      }
                    />
                  )}
                />
                {errors.code && (
                  <p className="text-xs text-destructive">
                    {errors.code.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Discount Type</Label>
                <Controller
                  control={control}
                  name="discountType"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(val) => {
                        field.onChange(val);
                        setValue(
                          "flatDiscountsByPlan",
                          buildDefaultFlatDiscounts(activePlans),
                        );
                        setValue("discountValue", 0);
                      }}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FLAT">Flat (₹ amount)</SelectItem>
                        <SelectItem value="PERCENTAGE">Percentage (%)</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-2">
                <Label>Max Uses</Label>
                <Controller
                  control={control}
                  name="maxUses"
                  render={({ field }) => (
                    <Input
                      type="number"
                      min="1"
                      className="h-10"
                      value={field.value ?? ""}
                      onChange={(e) =>
                        field.onChange(parseInt(e.target.value, 10) || 1)
                      }
                    />
                  )}
                />
                {errors.maxUses && (
                  <p className="text-xs text-destructive">
                    {errors.maxUses.message}
                  </p>
                )}
              </div>
            </div>

            {/* Row 2: Discount Values (conditional on type) */}
            {discountType === "FLAT" ? (
              <div className="space-y-2">
                <Label>
                  Flat Discount by Plan{" "}
                  <span className="text-muted-foreground font-normal text-xs">
                    (enter 0 to skip a plan)
                  </span>
                </Label>
                {activePlans.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No active subscription plans available.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {activePlans.map((plan) => (
                      <div key={plan.id} className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">
                          {plan.name} ({plan.duration_days} days)
                        </Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0"
                          className="h-10"
                          value={
                            watch("flatDiscountsByPlan")?.[plan.id] ?? ""
                          }
                          onChange={(e) => {
                            const current = watch("flatDiscountsByPlan") ?? {};
                            setValue("flatDiscountsByPlan", {
                              ...current,
                              [plan.id]:
                                e.target.value === ""
                                  ? 0
                                  : parseFloat(e.target.value),
                            });
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
                {errors.flatDiscountsByPlan?.message && (
                  <p className="text-xs text-destructive">
                    {String(errors.flatDiscountsByPlan.message)}
                  </p>
                )}
              </div>
            ) : (
              <div className="max-w-xs space-y-2">
                <Label>Discount Percentage (%)</Label>
                <Controller
                  control={control}
                  name="discountValue"
                  render={({ field }) => (
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      placeholder="e.g. 10"
                      className="h-10"
                      value={field.value ?? ""}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value === ""
                            ? 0
                            : parseFloat(e.target.value),
                        )
                      }
                    />
                  )}
                />
                {errors.discountValue && (
                  <p className="text-xs text-destructive">
                    {errors.discountValue.message}
                  </p>
                )}
              </div>
            )}

            {/* Row 3: Expiry date */}
            <div className="max-w-xs space-y-2">
              <Label>
                Expiry Date{" "}
                <span className="text-muted-foreground font-normal text-xs">
                  (optional)
                </span>
              </Label>
              <Controller
                control={control}
                name="expiresAt"
                render={({ field }) => (
                  <Popover open={isExpiryOpen} onOpenChange={setIsExpiryOpen}>
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
                        {field.value
                          ? format(field.value, "PPP")
                          : "No expiry (never expires)"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        defaultMonth={field.value ?? new Date()}
                        onSelect={(date) => {
                          field.onChange(date);
                          setIsExpiryOpen(false);
                        }}
                        disabled={(date) => date < new Date()}
                      />
                      {field.value && (
                        <div className="p-2 border-t">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full text-muted-foreground"
                            onClick={() => {
                              field.onChange(undefined);
                              setIsExpiryOpen(false);
                            }}
                          >
                            Clear expiry
                          </Button>
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>
                )}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">
                {isGlobal
                  ? "This code can be used by any customer when purchasing a subscription."
                  : "The coupon will only work for this customer during checkout."}
              </p>
              <Button
                type="submit"
                disabled={isPending}
                className="transition-all duration-200"
              >
                {isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Create Coupon
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      <ConfirmDeleteModal
        isOpen={deleteState.isOpen}
        onClose={() =>
          setDeleteState({ isOpen: false, couponId: "", code: "" })
        }
        onConfirm={handleDelete}
        title="Delete Coupon"
        description={`Are you sure you want to delete coupon "${deleteState.code}"? This cannot be undone.`}
        isPending={isPending}
      />
    </div>
  );
}
