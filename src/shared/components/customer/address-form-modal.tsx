"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Switch } from "@/shared/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { MapPin, Loader2, CheckCircle2, Navigation, Home } from "lucide-react";
import { saveAddressAction } from "@/actions/addressActions";
import { getServiceAreaPincodesAction } from "@/actions/pincodeActions";
import { createAddressSchema } from "@/validations/addressSchema";
import type { AddressFormValues } from "@/validations/addressSchema";
import type { Address } from "@/services/addressService";
import { dispatchNotificationsRefresh } from "@/lib/notifications/refresh";

const AddressPickerMap = dynamic(
  () =>
    import("./address-picker-map").then((module) => module.AddressPickerMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[220px] w-full items-center justify-center rounded-xl bg-slate-100 text-xs font-medium text-slate-400 animate-pulse">
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

/**
 * Small numbered eyebrow used to visually group the dialog into a "guided
 * setup" feel (Location → Address Details → Delivery Preferences) without
 * turning it into an actual multi-step wizard — same section-label pattern
 * used elsewhere in profile-ui (uppercase, tracked, slate-400).
 */
function FormGroupLabel({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
        {step}
      </span>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
        {children}
      </p>
    </div>
  );
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
  const [serviceAreaPincodes, setServiceAreaPincodes] = useState<string[]>([]);
  const addressSchema = useMemo(
    () => createAddressSchema(serviceAreaPincodes),
    [serviceAreaPincodes],
  );

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
    if (!isOpen) return;

    let cancelled = false;
    getServiceAreaPincodesAction()
      .then((pincodes) => {
        if (cancelled) return;
        setServiceAreaPincodes(pincodes);
        form.trigger("pincode");
      })
      .catch((error) => {
        console.error("Failed to load service area pincodes:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, form]);

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
      dispatchNotificationsRefresh();
      if (onSuccess) onSuccess();
      else onClose();
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
            <Home className="h-4 w-4 text-primary" />
            {initialData ? "Edit Address" : "Add Delivery Address"}
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            Enter the details for your daily diet deliveries.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 py-2">
          {/* Group 1 — Location */}
          <div className="space-y-3">
            <FormGroupLabel step={1}>Location</FormGroupLabel>

            <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                    <MapPin className="h-4 w-4 text-primary" /> Delivery
                    Coordinates
                  </h4>
                  <p className="mt-0.5 text-xs text-slate-500">
                    We need your exact location for accurate routing.
                  </p>
                </div>

                {locationStatus === "success" ? (
                  <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Captured
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 border-primary/20 bg-primary/5 text-xs font-semibold text-primary hover:bg-primary/10"
                    onClick={handleDetectLocation}
                    disabled={locationStatus === "loading" || skipLocation}
                  >
                    {locationStatus === "loading" ? (
                      <>
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                        Detecting...
                      </>
                    ) : (
                      <>
                        <Navigation className="mr-1.5 h-3 w-3" /> Detect
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
                <p className="rounded-lg bg-red-50 p-2 text-xs font-medium text-red-500">
                  {locationErrorMsg}
                </p>
              )}

              {/* THE FALLBACK OPTION */}
              {locationStatus !== "success" && (
                <label className="mt-1 flex items-start gap-2 border-t border-dashed border-slate-200 pt-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                    checked={skipLocation}
                    onChange={(e) => {
                      setSkipLocation(e.target.checked);
                      if (e.target.checked) setServerError(null); // Clear error if they choose to skip
                    }}
                  />
                  <span className="text-xs font-medium leading-tight text-slate-600">
                    I am not currently at this address.
                    <br />
                    <span className="text-[10px] font-normal text-slate-400">
                      Skip location detection for now.
                    </span>
                  </span>
                </label>
              )}
            </div>
          </div>

          {/* Group 2 — Address Details */}
          <div className="space-y-3">
            <FormGroupLabel step={2}>Address Details</FormGroupLabel>

            <div className="space-y-4 rounded-2xl border border-slate-200 p-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600">Tag</Label>
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
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600">Pincode</Label>
                  <Input placeholder="500028" {...form.register("pincode")} />
                  {form.formState.errors.pincode && (
                    <p className="text-xs text-red-500">
                      {form.formState.errors.pincode.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">
                  Flat / House No / Building
                </Label>
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

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">
                  Area / Street / Sector (Optional)
                </Label>
                <Input placeholder="Jubilee Hills" {...form.register("street_2")} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">
                  Landmark (Optional)
                </Label>
                <Input
                  placeholder="Near Apollo Hospital"
                  {...form.register("landmark")}
                />
              </div>
            </div>
          </div>

          {/* Group 3 — Delivery Preferences */}
          <div className="space-y-3">
            <FormGroupLabel step={3}>Delivery Preferences</FormGroupLabel>

            <div className="flex flex-row items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium text-slate-800">
                  Set as default address
                </Label>
                <p className="text-xs text-slate-500">
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
          </div>

          {serverError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-center text-sm font-medium text-red-500">
              {serverError}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="font-semibold active:scale-[0.98]"
            >
              {isPending ? "Saving..." : "Save Address"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
