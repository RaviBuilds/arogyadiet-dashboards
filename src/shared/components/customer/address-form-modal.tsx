"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveAddressAction } from "@/actions/addressActions";
import { addressSchema } from "@/validations/addressSchema";
import type { AddressFormValues } from "@/validations/addressSchema";
import type { Address } from "@/services/addressService";

interface AddressFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialData?: Address | null;
}

export function AddressFormModal({
  isOpen,
  onClose,
  initialData,
}: AddressFormModalProps) {
  const [isPending, setIsPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<AddressFormValues>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      id: initialData?.id || undefined,
      tag: (initialData?.tag as "Home" | "Work" | "Other") || "Home",
      street_1: initialData?.street_1 || "",
      street_2: initialData?.street_2 || "",
      landmark: initialData?.landmark || "",
      city: initialData?.city || "Hyderabad",
      state: initialData?.state || "Telangana",
      pincode: initialData?.pincode || "",
      is_primary:initialData?.is_primary || false,
    },
  });

  // Ensure form resets properly when switching between different addresses
  useEffect(() => {
    if (isOpen) {
      form.reset({
        id: initialData?.id || undefined,
        tag: (initialData?.tag as "Home" | "Work" | "Other") || "Home",
        street_1: initialData?.street_1 || "",
        street_2: initialData?.street_2 || "",
        landmark: initialData?.landmark || "",
        city: initialData?.city || "Hyderabad",
        state: initialData?.state || "Telangana",
        pincode: initialData?.pincode || "",
        is_primary: initialData?.is_primary || false,
      });
    }
  }, [isOpen, initialData, form]);

  async function onSubmit(data: AddressFormValues) {
    setIsPending(true);
    setServerError(null);

    const result = await saveAddressAction(data);

    if (result?.error) {
      setServerError(result.error);
      setIsPending(false);
    } else {
      setIsPending(false);
      form.reset();
      onClose();
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {initialData ? "Edit Address" : "Add Delivery Address"}
          </DialogTitle>
          <DialogDescription>
            Enter the details for your daily diet deliveries.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Tag</label>
              <Select
                onValueChange={(val: string) =>
                  form.setValue("tag", val as "Home" | "Work" | "Other")
                }
                defaultValue={form.getValues("tag")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a tag" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Home">Home</SelectItem>
                  <SelectItem value="Work">Work</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Pincode</label>
              <Input placeholder="500028" {...form.register("pincode")} />
              {form.formState.errors.pincode && (
                <p className="text-xs text-red-500">
                  {form.formState.errors.pincode.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Flat / House No / Building
            </label>
            <Input
              placeholder="Apt 4B, Emerald Heights"
              {...form.register("street_1")}
            />
            {form.formState.errors.street_1 && (
              <p className="text-xs text-red-500">
                {form.formState.errors.street_1.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Area / Street / Sector (Optional)
            </label>
            <Input placeholder="Jubilee Hills" {...form.register("street_2")} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Landmark (Optional)</label>
            <Input
              placeholder="Near Apollo Hospital"
              {...form.register("landmark")}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                City
              </label>
              <Input disabled {...form.register("city")} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                State
              </label>
              <Input disabled {...form.register("state")} />
            </div>
          </div>

          <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm mt-4">
            <div className="space-y-0.5">
              <label className="text-sm font-medium">
                Set as default address
              </label>
              <p className="text-xs text-muted-foreground">
                Your diet meals will be delivered here by default.
              </p>
            </div>
            <Switch
              checked={form.watch("is_primary")}
              onCheckedChange={(checked) =>
                form.setValue("is_primary", checked)
              }
            />
          </div>

          {serverError && (
            <div className="text-sm text-red-500 text-center font-medium bg-red-50 p-2 rounded">
              {serverError}
            </div>
          )}

          <div className="pt-4 flex justify-end space-x-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save Address"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
