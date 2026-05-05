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
import { MapPin, Loader2, CheckCircle2, Navigation } from "lucide-react";
import { saveAddressAction } from "@/actions/addressActions";
import { addressSchema } from "@/validations/addressSchema";
import type { AddressFormValues } from "@/validations/addressSchema";
import type { Address } from "@/services/addressService";

interface AddressFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialData?: Address | null;
}

export function AddressFormModal({
  isOpen,
  onClose,
  initialData,
  onSuccess,
}: AddressFormModalProps) {
  const [isPending, setIsPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // States for GPS Location Tracking
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [locationErrorMsg, setLocationErrorMsg] = useState("");

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
      is_primary: initialData?.is_primary || false,
      lat: initialData?.lat || null,
      lng: initialData?.lng || null,
    },
  });

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
        lat: initialData?.lat || null,
        lng: initialData?.lng || null,
      });
      // If editing an address that already has coordinates, show success state
      if (initialData?.lat && initialData?.lng) {
        setLocationStatus("success");
      } else {
        setLocationStatus("idle");
      }
    }
  }, [isOpen, initialData, form]);

  // --- HTML5 Geolocation Function ---
  const handleDetectLocation = () => {
    setLocationStatus("loading");
    setLocationErrorMsg("");

    if (!navigator.geolocation) {
      setLocationStatus("error");
      setLocationErrorMsg("Geolocation is not supported by your browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        // Automatically fill the hidden lat/lng fields
        form.setValue("lat", position.coords.latitude, { shouldDirty: true });
        form.setValue("lng", position.coords.longitude, { shouldDirty: true });
        setLocationStatus("success");
      },
      (error) => {
        setLocationStatus("error");
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setLocationErrorMsg(
              "Location permission denied. Please enable it in your browser.",
            );
            break;
          case error.POSITION_UNAVAILABLE:
            setLocationErrorMsg("Location information is unavailable.");
            break;
          case error.TIMEOUT:
            setLocationErrorMsg("The request to get location timed out.");
            break;
          default:
            setLocationErrorMsg("An unknown error occurred.");
            break;
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  async function onSubmit(data: AddressFormValues) {
    // Safety check: ensure coordinates are captured!
    if (!data.lat || !data.lng) {
      setServerError(
        "Please click 'Detect My Location' so the rider can find you.",
      );
      return;
    }

    setIsPending(true);
    setServerError(null);

    const result = await saveAddressAction(data);

    if (result?.error) {
      setServerError(result.error);
      setIsPending(false);
    } else {
      setIsPending(false);
      form.reset();
      if (onSuccess) onSuccess();
      else onClose();
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {initialData ? "Edit Address" : "Add Delivery Address"}
          </DialogTitle>
          <DialogDescription>
            Enter the details for your daily diet deliveries.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
          {/* NEW: GPS Location Banner */}
          <div className="bg-zinc-50 border rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="text-sm font-bold text-zinc-900 flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-primary" /> Delivery
                  Coordinates
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  We need your exact location for accurate routing.
                </p>
              </div>

              {locationStatus === "success" ? (
                <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Captured
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800 border-blue-200"
                  onClick={handleDetectLocation}
                  disabled={locationStatus === "loading"}
                >
                  {locationStatus === "loading" ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />{" "}
                      Detecting...
                    </>
                  ) : (
                    <>
                      <Navigation className="h-3 w-3 mr-1.5" /> Detect Location
                    </>
                  )}
                </Button>
              )}
            </div>

            {locationStatus === "error" && (
              <p className="text-xs font-medium text-red-500 bg-red-50 p-2 rounded">
                {locationErrorMsg}
              </p>
            )}
          </div>

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

          <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm mt-4 bg-white">
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
            <div className="text-sm text-red-500 text-center font-medium bg-red-50 p-2 rounded border border-red-200">
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
            <Button type="submit" disabled={isPending} className="font-bold">
              {isPending ? "Saving..." : "Save Address"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
