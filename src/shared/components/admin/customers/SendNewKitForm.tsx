"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Loader2,
  Package,
  Truck,
  MapPin,
  CreditCard,
  Utensils,
  Calendar,
  Plus,
} from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import { Label } from "@/shared/components/ui/label";
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
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/shared/components/ui/radio-group";

import {
  sendNewKitSchema,
  COURIER_PARTNERS,
  MEAL_PREFERENCES,
} from "@/validations/kitLifecycleSchema";
import { sendNewKitAction } from "@/actions/admin-actions/kitLifecycleActions";
import type { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KitProductOption {
  id: string;
  name: string;
  base_price: number;
}

interface CustomerAddress {
  id: string;
  tag: string;
  street_1: string;
  city: string;
  state: string;
  pincode: string;
}

interface SendNewKitFormProps {
  customerProfileId: string;
  kitProducts: KitProductOption[];
  addresses: CustomerAddress[];
  onSuccess?: () => void;
}

type FormValues = z.input<typeof sendNewKitSchema>;

// ---------------------------------------------------------------------------
// Courier partner display labels
// ---------------------------------------------------------------------------

const COURIER_DISPLAY: Record<string, string> = {
  OTHER: "Other shipping",
  APSRTC: "APSRTC Logistics",
  TGSRTC: "TGSRTC Logistics",
  DTDC: "DTDC",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Send New KIT — Multi-section workflow form.
 *
 * Sections: KIT Product, KIT Duration, Meal Preference, Address, Shipping, Payment.
 * Uses React Hook Form with Zod validation (sendNewKitSchema).
 * On submit: calls sendNewKitAction server action.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12
 */
export function SendNewKitForm({
  customerProfileId,
  kitProducts,
  addresses,
  onSuccess,
}: SendNewKitFormProps) {
  const [isPending, startTransition] = useTransition();
  const [showNewAddress, setShowNewAddress] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(sendNewKitSchema),
    defaultValues: {
      kitProductId: undefined,
      kitDurationDays: undefined,
      mealPreference: undefined,
      addressId: undefined,
      newAddress: undefined,
      courierPartner: undefined,
      trackingNumber: "",
      trackingUrl: undefined,
    },
    mode: "onChange",
  });

  const selectedCourier = form.watch("courierPartner");

  // We track "Mark as Paid" outside of Zod since it's a UI gate, not schema data
  const [isPaid, setIsPaid] = useState(false);

  // Check if form is valid for submission
  const isFormValid = form.formState.isValid && isPaid;

  const onSubmit = form.handleSubmit((values) => {
    if (!isPaid) {
      toast.error("Please mark the payment as paid before submitting.");
      return;
    }

    startTransition(async () => {
      const result = await sendNewKitAction(customerProfileId, values);

      if (result.success) {
        toast.success("New KIT order created successfully!");
        form.reset();
        setIsPaid(false);
        setShowNewAddress(false);
        onSuccess?.();
      } else {
        toast.error(result.error || "Failed to create KIT order.");
        // Preserve form on error (Req 4.11)
        if (result.fieldErrors) {
          Object.entries(result.fieldErrors).forEach(([field, message]) => {
            form.setError(field as keyof FormValues, { message });
          });
        }
      }
    });
  });

  const handleAddressSelection = (value: string) => {
    if (value === "NEW") {
      setShowNewAddress(true);
      // Set a placeholder UUID for Zod validation — will be replaced on server
      form.setValue("addressId", "00000000-0000-0000-0000-000000000000", {
        shouldValidate: true,
      });
    } else {
      setShowNewAddress(false);
      form.setValue("newAddress", undefined);
      form.setValue("addressId", value, { shouldValidate: true });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Send New KIT</h2>
        <p className="text-sm text-muted-foreground">
          Configure and send a new KIT order for this customer.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={onSubmit} className="space-y-6">
          {/* ─── KIT Product Section ─── */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4 text-primary" />
                KIT Product
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="kitProductId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Select KIT Product</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isPending}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose a KIT product" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {kitProducts.map((product) => (
                          <SelectItem key={product.id} value={product.id}>
                            {product.name} — ₹
                            {product.base_price.toLocaleString("en-IN")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Active KIT products with name and price
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* ─── KIT Duration Section ─── */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Calendar className="h-4 w-4 text-primary" />
                KIT Duration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="kitDurationDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duration (days)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={365}
                        placeholder="e.g. 30"
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        value={
                          field.value != null
                            ? String(field.value)
                            : ""
                        }
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === ""
                              ? undefined
                              : Number(e.target.value)
                          )
                        }
                        disabled={isPending}
                      />
                    </FormControl>
                    <FormDescription>
                      Number of tracking days (1–365)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* ─── Meal Preference Section ─── */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Utensils className="h-4 w-4 text-primary" />
                Meal Preference
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="mealPreference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Select Meal Preference</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        value={field.value}
                        className="flex gap-4"
                        disabled={isPending}
                      >
                        {MEAL_PREFERENCES.map((pref) => (
                          <div
                            key={pref}
                            className="flex items-center space-x-2"
                          >
                            <RadioGroupItem value={pref} id={`meal-${pref}`} />
                            <Label htmlFor={`meal-${pref}`}>{pref}</Label>
                          </div>
                        ))}
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* ─── Address Section ─── */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-4 w-4 text-primary" />
                Delivery Address
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="addressId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Select Address</FormLabel>
                    <Select
                      onValueChange={handleAddressSelection}
                      value={showNewAddress ? "NEW" : field.value}
                      disabled={isPending}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose an address" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {addresses.map((addr) => (
                          <SelectItem key={addr.id} value={addr.id}>
                            {addr.tag} — {addr.street_1}, {addr.city},{" "}
                            {addr.pincode}
                          </SelectItem>
                        ))}
                        <SelectItem value="NEW">
                          <span className="flex items-center gap-1">
                            <Plus className="h-3 w-3" />
                            Add new address
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Inline new address fields */}
              {showNewAddress && (
                <div className="rounded-lg border border-dashed p-4 space-y-4 bg-muted/30">
                  <p className="text-sm font-medium text-muted-foreground">
                    New Address Details
                  </p>
                  <FormField
                    control={form.control}
                    name="newAddress.addressLine"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Address Line</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Street address (min 5 characters)"
                            {...field}
                            disabled={isPending}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="newAddress.city"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>City</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="City"
                              {...field}
                              disabled={isPending}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="newAddress.state"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>State</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="State"
                              {...field}
                              disabled={isPending}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="newAddress.pinCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>PIN Code</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="6-digit PIN"
                              maxLength={6}
                              {...field}
                              disabled={isPending}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ─── Shipping Section ─── */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Truck className="h-4 w-4 text-primary" />
                Shipping Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="courierPartner"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Courier Partner</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isPending}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select courier partner" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {COURIER_PARTNERS.map((partner) => (
                          <SelectItem key={partner} value={partner}>
                            {COURIER_DISPLAY[partner]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="trackingNumber"
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
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Tracking URL — only shown when "OTHER" is selected (Req 4.7) */}
              {selectedCourier === "OTHER" && (
                <FormField
                  control={form.control}
                  name="trackingUrl"
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
                        Required when using "Other shipping" courier
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </CardContent>
          </Card>

          {/* ─── Payment Section ─── */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="h-4 w-4 text-primary" />
                Payment Confirmation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label htmlFor="mark-as-paid" className="text-sm font-medium">
                    Mark as Paid
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Payment must be confirmed before sending the KIT
                  </p>
                </div>
                <Switch
                  id="mark-as-paid"
                  checked={isPaid}
                  onCheckedChange={setIsPaid}
                  disabled={isPending}
                />
              </div>
            </CardContent>
          </Card>

          {/* ─── Submit Button ─── */}
          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              size="lg"
              disabled={!isFormValid || isPending}
              className="gap-2"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending KIT…
                </>
              ) : (
                <>
                  <Package className="h-4 w-4" />
                  Send KIT
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
