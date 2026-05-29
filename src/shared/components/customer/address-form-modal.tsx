"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
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

const AddressPickerMap = dynamic(
  () =>
    import("./address-picker-map").then((module) => module.AddressPickerMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-[220px] w-full bg-zinc-100 animate-pulse rounded-lg flex items-center justify-center text-xs text-zinc-400 font-medium">
        Loading map...
      </div>
    ),
  },
);

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

  // NEW: State to allow skipping location detection
  const [skipLocation, setSkipLocation] = useState(false);

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

      // Reset our custom UI states
      setSkipLocation(false);
      setServerError(null);
      setLocationErrorMsg("");

      if (initialData?.lat && initialData?.lng) {
        setLocationStatus("success");
        return;
      }

      setLocationStatus("idle");

      // Silently attempt geolocation for new addresses without stored coords.
      if (!navigator.geolocation) return;

      navigator.geolocation.getCurrentPosition(
        (position) => {
          form.setValue("lat", position.coords.latitude, { shouldDirty: true });
          form.setValue("lng", position.coords.longitude, { shouldDirty: true });
          setLocationStatus("success");
        },
        () => {
          // Fail silently — map falls back to Hyderabad default center.
        },
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 },
      );
    }
  }, [isOpen, initialData, form]);

  const handleCoordinatesChange = useCallback(
    (lat: number, lng: number) => {
      form.setValue("lat", lat, { shouldDirty: true });
      form.setValue("lng", lng, { shouldDirty: true });
      setLocationStatus("success");
      setServerError(null);
    },
    [form],
  );

  const handleDetectLocation = () => {
    setLocationStatus("loading");
    setLocationErrorMsg("");
    setSkipLocation(false); // Uncheck skip if they try to detect

    if (!navigator.geolocation) {
      setLocationStatus("error");
      setLocationErrorMsg("Geolocation is not supported by your browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        form.setValue("lat", position.coords.latitude, { shouldDirty: true });
        form.setValue("lng", position.coords.longitude, { shouldDirty: true });
        setLocationStatus("success");
        setServerError(null); // Clear any previous errors
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
    // UPDATED CHECK: Allow save if they explicitly opted to skip
    if (
      !skipLocation &&
      !data.lat &&
      !data.lng &&
      locationStatus !== "success"
    ) {
      setServerError(
        "Please pin your location on the map, detect your location, OR check the skip box below.",
      );
      return;
    }

    setIsPending(true);
    setServerError(null);

    const payload: AddressFormValues = {
      ...data,
      lat:
        data.lat != null && skipLocation
          ? null
          : data.lat != null
            ? Number(data.lat)
            : null,
      lng:
        data.lng != null && skipLocation
          ? null
          : data.lng != null
            ? Number(data.lng)
            : null,
    };

    const result = await saveAddressAction(payload);

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
          {/* GPS Location Banner with Fallback */}
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
                  disabled={locationStatus === "loading" || skipLocation}
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

            {!skipLocation && (
              <AddressPickerMap
                lat={form.watch("lat") ?? null}
                lng={form.watch("lng") ?? null}
                disabled={skipLocation}
                onCoordinatesChange={handleCoordinatesChange}
              />
            )}

            {locationStatus === "error" && !skipLocation && (
              <p className="text-xs font-medium text-red-500 bg-red-50 p-2 rounded">
                {locationErrorMsg}
              </p>
            )}

            {/* THE FALLBACK OPTION */}
            {locationStatus !== "success" && (
              <label className="flex items-start gap-2 mt-2 pt-3 border-t border-zinc-200 border-dashed cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded border-zinc-300 text-primary focus:ring-primary h-4 w-4 mt-0.5"
                  checked={skipLocation}
                  onChange={(e) => {
                    setSkipLocation(e.target.checked);
                    if (e.target.checked) setServerError(null); // Clear error if they choose to skip
                  }}
                />
                <span className="text-xs font-medium text-zinc-600 leading-tight">
                  I am not currently at this address.
                  <br />
                  <span className="text-[10px] text-zinc-400 font-normal">
                    Skip location detection for now.
                  </span>
                </span>
              </label>
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
