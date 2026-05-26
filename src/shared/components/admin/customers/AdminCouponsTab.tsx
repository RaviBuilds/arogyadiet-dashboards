"use client";

import React, { useState, useTransition } from "react";
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

import { createCoupon, deleteCoupon } from "@/actions/admin-actions/adminCouponActions";
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

// ─── types ───────────────────────────────────────────────────────────────────

export type CouponRow = {
  id: string;
  code: string;
  discount_type: "FLAT" | "PERCENTAGE";
  discount_value_30_days: number;
  discount_value_60_days: number;
  discount_value_90_days: number;
  discount_value: number;
  max_uses: number;
  times_used: number;
  expires_at: string | null;
  created_at: string;
};

interface AdminCouponsTabProps {
  customerProfileId: string;
  initialCoupons: CouponRow[];
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
    discountValue30Days: z.number().min(0).optional(),
    discountValue60Days: z.number().min(0).optional(),
    discountValue90Days: z.number().min(0).optional(),
    discountValue: z.number().min(0).max(100).optional(),
    maxUses: z.number().int().min(1, "At least 1"),
    expiresAt: z.date().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.discountType === "FLAT") {
      const hasAny =
        (d.discountValue30Days ?? 0) > 0 ||
        (d.discountValue60Days ?? 0) > 0 ||
        (d.discountValue90Days ?? 0) > 0;
      if (!hasAny) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "At least one discount amount must be > 0",
          path: ["discountValue30Days"],
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
}: AdminCouponsTabProps) {
  const [coupons, setCoupons] = useState<CouponRow[]>(initialCoupons);
  const [isPending, startTransition] = useTransition();
  const [isExpiryOpen, setIsExpiryOpen] = useState(false);
  const [deleteState, setDeleteState] = useState<{
    isOpen: boolean;
    couponId: string;
    code: string;
  }>({ isOpen: false, couponId: "", code: "" });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      code: "",
      discountType: "FLAT",
      discountValue30Days: 0,
      discountValue60Days: 0,
      discountValue90Days: 0,
      discountValue: 0,
      maxUses: 1,
    },
  });

  const { control, watch, handleSubmit, reset, setValue, formState } = form;
  const { errors } = formState;
  const discountType = watch("discountType");

  const onSubmit = (values: FormValues) => {
    startTransition(async () => {
      const res = await createCoupon({
        customerProfileId,
        code: values.code,
        discountType: values.discountType,
        discountValue30Days: values.discountValue30Days ?? 0,
        discountValue60Days: values.discountValue60Days ?? 0,
        discountValue90Days: values.discountValue90Days ?? 0,
        discountValue: values.discountValue ?? 0,
        maxUses: values.maxUses,
        expiresAt: values.expiresAt
          ? format(values.expiresAt, "yyyy-MM-dd")
          : undefined,
      });

      if (res.success) {
        toast.success("Coupon created successfully!");
        reset({
          code: "",
          discountType: "FLAT",
          discountValue30Days: 0,
          discountValue60Days: 0,
          discountValue90Days: 0,
          discountValue: 0,
          maxUses: 1,
        });
        // Optimistic: refresh will re-fetch via server component revalidation
        // but we also need a client-side refresh trigger
        window.location.reload();
      } else {
        toast.error(res.error ?? "Failed to create coupon.");
      }
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const res = await deleteCoupon(deleteState.couponId, customerProfileId);
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
      <Card className="overflow-hidden border-border/70 shadow-sm">
        <CardHeader className="space-y-0 border-b bg-muted/20">
          <div className="flex items-center gap-2">
            <TicketPercent className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Active Coupons</CardTitle>
          </div>
          <CardDescription className="mt-1">
            Discount codes assigned to this customer.
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
                <thead className="text-xs text-muted-foreground uppercase bg-muted/30 border-b">
                  <tr>
                    <th className="px-5 py-3 font-bold tracking-wider">Code</th>
                    <th className="px-5 py-3 font-bold tracking-wider">Type</th>
                    <th className="px-5 py-3 font-bold tracking-wider">
                      Discount
                    </th>
                    <th className="px-5 py-3 font-bold tracking-wider">
                      Uses
                    </th>
                    <th className="px-5 py-3 font-bold tracking-wider">
                      Expires
                    </th>
                    <th className="px-5 py-3 font-bold tracking-wider text-right">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {coupons.map((coupon) => {
                    const isExpired =
                      coupon.expires_at &&
                      new Date(coupon.expires_at) < new Date();
                    const isExhausted =
                      coupon.times_used >= coupon.max_uses;

                    return (
                      <tr
                        key={coupon.id}
                        className="hover:bg-muted/20 transition-colors"
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
                              {coupon.discount_value_30_days > 0 && (
                                <span>
                                  30d: ₹{coupon.discount_value_30_days}
                                </span>
                              )}
                              {coupon.discount_value_60_days > 0 && (
                                <span>
                                  60d: ₹{coupon.discount_value_60_days}
                                </span>
                              )}
                              {coupon.discount_value_90_days > 0 && (
                                <span>
                                  90d: ₹{coupon.discount_value_90_days}
                                </span>
                              )}
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
      <Card className="overflow-hidden border-border/70 shadow-sm">
        <CardHeader className="space-y-0 border-b bg-muted/20">
          <div className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Create New Coupon</CardTitle>
          </div>
          <CardDescription className="mt-1">
            Coupons are linked to this customer and applied during their
            checkout.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-5 sm:p-6">
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
                        // Reset discount values on type change
                        setValue("discountValue30Days", 0);
                        setValue("discountValue60Days", 0);
                        setValue("discountValue90Days", 0);
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
                  Flat Discount by Plan Duration{" "}
                  <span className="text-muted-foreground font-normal text-xs">
                    (enter 0 to skip a duration)
                  </span>
                </Label>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {(
                    [
                      {
                        name: "discountValue30Days" as const,
                        label: "30-Day Plan (₹)",
                      },
                      {
                        name: "discountValue60Days" as const,
                        label: "60-Day Plan (₹)",
                      },
                      {
                        name: "discountValue90Days" as const,
                        label: "90-Day Plan (₹)",
                      },
                    ] as const
                  ).map(({ name, label }) => (
                    <div key={name} className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {label}
                      </Label>
                      <Controller
                        control={control}
                        name={name}
                        render={({ field }) => (
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0"
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
                    </div>
                  ))}
                </div>
                {errors.discountValue30Days && (
                  <p className="text-xs text-destructive">
                    {errors.discountValue30Days.message}
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
              <p className="text-xs text-muted-foreground">
                The coupon will only work for this customer during checkout.
              </p>
              <Button type="submit" disabled={isPending}>
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
