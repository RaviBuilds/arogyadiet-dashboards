"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Package, Truck } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
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
import { getCourierOptions } from "@/types/kitShipping";

/**
 * Courier Form Component
 * 
 * Client Component for managing shipping information for KIT orders.
 * Features:
 * - Courier partner dropdown with exactly 4 options
 * - Tracking number input
 * - Conditional tracking URL field (shown only for "Other shipping")
 * - React Hook Form with Zod validation
 * - Server Action integration for persistence
 * 
 * Requirements: 6.2, 6.3, 6.4, 6.5
 * Task: 13.2
 */

interface CourierFormProps {
  customerId: string;
  subscriptionId: string;
  existingShippingInfo: ShippingInfo | null;
}

// Validation schema matching server-side validation in shippingActions.ts
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
      // Validate tracking URL required when courier = 'OTHER' (Requirement 6.4)
      if (data.courier_partner === "OTHER") {
        return data.tracking_url && data.tracking_url.trim() !== "";
      }
      return true;
    },
    {
      message: 'Tracking URL is required when using "Other shipping" courier.',
      path: ["tracking_url"], // Set error on tracking_url field
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

  const form = useForm<CourierFormInput>({
    resolver: zodResolver(courierFormSchema),
    defaultValues: {
      courier_partner: existingShippingInfo?.courier_partner ?? undefined,
      tracking_number: existingShippingInfo?.tracking_number ?? "",
      tracking_url: existingShippingInfo?.tracking_url ?? "",
    },
  });

  // Watch courier_partner field to conditionally show tracking URL field (Requirement 6.3)
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
        router.refresh();
      } else {
        // Show server-side validation error (Requirement 6.5)
        toast.error(result.error);

        // Set form errors based on error message content
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

  // Get courier options for dropdown (Requirement 6.2)
  const courierOptions = getCourierOptions();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Truck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>Courier Tracking Information</CardTitle>
            <CardDescription>
              Manage shipping details and tracking information for this KIT order
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            {/* Courier Partner Dropdown - Requirement 6.2 */}
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

            {/* Conditional Tracking URL Field - Requirement 6.3, 6.4 */}
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

            {/* Save Button */}
            <div className="flex justify-end gap-3">
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
