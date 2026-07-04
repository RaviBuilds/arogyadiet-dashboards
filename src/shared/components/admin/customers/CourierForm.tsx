"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Loader2,
  Package,
  Truck,
  Pencil,
  CheckCircle2,
  ExternalLink,
  Clock,
} from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Badge } from "@/shared/components/ui/badge";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/shared/components/ui/form";
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
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

import { saveShippingInfoAction } from "@/actions/admin-actions/shippingActions";
import type { ShippingInfo, CourierPartner } from "@/types/kitShipping";
import { getCourierOptions, getCourierDisplayName } from "@/types/kitShipping";

/**
 * Courier Form Component
 *
 * Client Component for managing shipping information for KIT orders.
 * Two-mode UI:
 * - View mode: displays saved shipping info in a clean read-only card
 * - Edit mode: shows form inputs for courier partner, tracking number, URL
 *
 * Requirements: 6.2, 6.3, 6.4, 6.5
 */

interface CourierFormProps {
  customerId: string;
  subscriptionId: string;
  existingShippingInfo: ShippingInfo | null;
}

// Validation schema
const courierFormSchema = z
  .object({
    courier_partner: z.enum(["OTHER", "APSRTC", "TGSRTC", "DTDC"]),
    tracking_number: z
      .string()
      .trim()
      .min(1, "Tracking number is required")
      .max(100, "Tracking number must be 100 characters or less"),
    tracking_url: z
      .string()
      .trim()
      .url("Please enter a valid URL")
      .optional()
      .or(z.literal("")),
  })
  .refine(
    (data) => {
      if (data.courier_partner === "OTHER") {
        return data.tracking_url && data.tracking_url.trim() !== "";
      }
      return true;
    },
    {
      message: 'Tracking URL is required when using "Other shipping" courier.',
      path: ["tracking_url"],
    }
  );

type CourierFormInput = z.infer<typeof courierFormSchema>;

export function CourierForm({
  customerId,
  subscriptionId,
  existingShippingInfo,
}: CourierFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(!existingShippingInfo);

  const form = useForm<CourierFormInput>({
    resolver: zodResolver(courierFormSchema),
    defaultValues: {
      courier_partner: existingShippingInfo?.courier_partner ?? undefined,
      tracking_number: existingShippingInfo?.tracking_number ?? "",
      tracking_url: existingShippingInfo?.tracking_url ?? "",
    },
  });

  const selectedCourier = form.watch("courier_partner");

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await saveShippingInfoAction({
        customer_profile_id: customerId,
        subscription_id: subscriptionId,
        courier_partner: values.courier_partner as CourierPartner,
        tracking_number: values.tracking_number,
        tracking_url: values.tracking_url || undefined,
      });

      if (result.success) {
        toast.success("Shipping information saved successfully.");
        setIsEditing(false);
        router.refresh();
      } else {
        toast.error(result.error);
        if (result.error.toLowerCase().includes("tracking url")) {
          form.setError("tracking_url", { message: result.error });
        } else if (result.error.toLowerCase().includes("tracking number")) {
          form.setError("tracking_number", { message: result.error });
        } else if (result.error.toLowerCase().includes("courier")) {
          form.setError("courier_partner", { message: result.error });
        }
      }
    });
  });

  const handleCancel = () => {
    form.reset({
      courier_partner: existingShippingInfo?.courier_partner ?? undefined,
      tracking_number: existingShippingInfo?.tracking_number ?? "",
      tracking_url: existingShippingInfo?.tracking_url ?? "",
    });
    setIsEditing(false);
  };

  const courierOptions = getCourierOptions();

  // ── VIEW MODE ──
  if (!isEditing && existingShippingInfo) {
    return (
      <Card className="overflow-hidden border-slate-200">
        <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <CardTitle className="text-base">Shipping Information</CardTitle>
                <CardDescription className="text-xs">
                  Courier and tracking details for this KIT order
                </CardDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(true)}
              className="gap-1.5 text-sm font-medium"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* Courier Partner */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Courier Partner
              </p>
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-slate-400" />
                <span className="text-sm font-semibold text-slate-900">
                  {getCourierDisplayName(existingShippingInfo.courier_partner)}
                </span>
              </div>
            </div>

            {/* Tracking Number */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Tracking Number
              </p>
              <p className="text-sm font-mono font-semibold text-slate-900">
                {existingShippingInfo.tracking_number}
              </p>
            </div>

            {/* Tracking URL (if present) */}
            {existingShippingInfo.tracking_url && (
              <div className="space-y-1.5 sm:col-span-2">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Tracking URL
                </p>
                <a
                  href={existingShippingInfo.tracking_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  {existingShippingInfo.tracking_url}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            )}

            {/* Shipped At */}
            {existingShippingInfo.shipped_at && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Shipped On
                </p>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-slate-400" />
                  <span className="text-sm text-slate-700">
                    {new Date(existingShippingInfo.shipped_at).toLocaleDateString(
                      "en-IN",
                      { day: "2-digit", month: "short", year: "numeric" }
                    )}
                  </span>
                </div>
              </div>
            )}

            {/* Delivered At */}
            {existingShippingInfo.delivered_at && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Delivered On
                </p>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm text-slate-700">
                    {new Date(existingShippingInfo.delivered_at).toLocaleDateString(
                      "en-IN",
                      { day: "2-digit", month: "short", year: "numeric" }
                    )}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Status badge */}
          <div className="mt-6 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
            <Package className="h-4 w-4 text-emerald-600" />
            <span className="text-xs font-medium text-emerald-700">
              Shipping information recorded
            </span>
            {existingShippingInfo.delivered_at ? (
              <Badge className="ml-auto border-0 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                Delivered
              </Badge>
            ) : (
              <Badge className="ml-auto border-0 bg-blue-100 text-blue-700 hover:bg-blue-100">
                Shipped
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── EDIT MODE ──
  return (
    <Card className="overflow-hidden border-slate-200">
      <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Truck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base">
              {existingShippingInfo
                ? "Edit Shipping Information"
                : "Courier Tracking Information"}
            </CardTitle>
            <CardDescription className="text-xs">
              {existingShippingInfo
                ? "Update courier and tracking details"
                : "Enter shipping details and tracking information for this KIT order"}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            {/* Courier Partner Dropdown */}
            <FormField
              control={form.control}
              name="courier_partner"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Courier Partner</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={isPending}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select courier partner" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {courierOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Choose the courier service used for delivery
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Tracking Number Input */}
            <FormField
              control={form.control}
              name="tracking_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tracking Number</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. 1234567890"
                      {...field}
                      disabled={isPending}
                    />
                  </FormControl>
                  <FormDescription>
                    Enter the tracking number provided by the courier
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Conditional Tracking URL Field */}
            {selectedCourier === "OTHER" && (
              <FormField
                control={form.control}
                name="tracking_url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tracking URL</FormLabel>
                    <FormControl>
                      <Input
                        type="url"
                        placeholder="https://courier-website.com/track/..."
                        {...field}
                        disabled={isPending}
                      />
                    </FormControl>
                    <FormDescription>
                      Provide the tracking page URL for "Other shipping" courier
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-3 pt-2">
              {existingShippingInfo && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={isPending}
                >
                  Cancel
                </Button>
              )}
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Package className="mr-2 h-4 w-4" />
                    Save Shipping Information
                  </>
                )}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
