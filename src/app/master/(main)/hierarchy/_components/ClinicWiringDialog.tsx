"use client";

// src/app/master/(main)/hierarchy/_components/ClinicWiringDialog.tsx
// Client leaf for the Master Hierarchy UI that WIRES a Clinic to a Franchise
// (create) or edits an existing franchise Clinic's geo (edit), and assigns
// served pincodes to that Clinic
// (multi-tenant-franchise spec — Task 13.5, Requirements 6.4, 6.5, 15.2, 15.3).
//
// React Hook Form + Zod (`franchiseClinicSchema`) drives the geo form — name,
// full address, latitude (-90..90), longitude (-180..180), and the preset/hidden
// `franchise_id`. Mutations call the master clinic-wiring Server Actions, surface
// the ActionResult error on the offending field (Req 6.5), and refresh the RSC
// tree on success. The pincode section calls `assignPincodeToFranchiseClinic`
// and surfaces overlap conflicts through the PincodeConflictBanner (Req 15.2,
// 15.3). The geo input pattern mirrors the core-clinic `ClinicManager`.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { MapPin } from "lucide-react";

import {
  wireClinicToFranchise,
  updateFranchiseClinic,
  assignPincodeToFranchiseClinic,
} from "@/actions/master-actions/clinicWiringActions";
import {
  franchiseClinicSchema,
  type FranchiseClinicSchemaInput,
} from "@/validations/franchise";
import type { ClinicMasterSchemaInput } from "@/validations/clinic";
import { ClinicLocationPicker } from "@/shared/components/master/core-business/ClinicLocationPicker";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/shared/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";

import { PincodeConflictBanner } from "./PincodeConflictBanner";

/** The existing franchise Clinic shape supplied in edit mode. */
export interface ExistingFranchiseClinic {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  franchise_id: string;
}

type ClinicWiringDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
} & (
  | { mode: "create"; franchiseId: string; clinic?: never }
  | { mode: "edit"; clinic: ExistingFranchiseClinic; franchiseId?: never }
);

type ClinicFormField = keyof FranchiseClinicSchemaInput;

const KNOWN_FIELDS: ClinicFormField[] = [
  "name",
  "address",
  "latitude",
  "longitude",
  "franchise_id",
];

export function ClinicWiringDialog(props: ClinicWiringDialogProps) {
  const { open, onOpenChange, mode } = props;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // The owning Franchise (preset in create, carried by the clinic in edit) and
  // the Clinic id (only present in edit — pincode assignment requires it).
  const franchiseId =
    mode === "create" ? props.franchiseId : props.clinic.franchise_id;
  const clinicId = mode === "edit" ? props.clinic.id : null;

  const form = useForm<FranchiseClinicSchemaInput>({
    resolver: zodResolver(franchiseClinicSchema),
    defaultValues:
      mode === "edit"
        ? {
            name: props.clinic.name,
            address: props.clinic.address,
            latitude: props.clinic.latitude,
            longitude: props.clinic.longitude,
            franchise_id: props.clinic.franchise_id,
          }
        : {
            name: "",
            address: "",
            // latitude/longitude left undefined so the numeric inputs start
            // blank; the schema rejects missing values (Req 6.5).
            latitude: undefined as unknown as number,
            longitude: undefined as unknown as number,
            franchise_id: franchiseId,
          },
  });

  // Pincode-assignment state (edit mode only).
  const [pincode, setPincode] = useState("");
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [isAssigning, startAssignTransition] = useTransition();

  const applyFieldError = (field: string | undefined, error: string) => {
    if (field && (KNOWN_FIELDS as string[]).includes(field)) {
      form.setError(field as ClinicFormField, { message: error });
    }
    toast.error(error);
  };

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result =
        mode === "edit" && clinicId
          ? await updateFranchiseClinic(clinicId, values)
          : await wireClinicToFranchise(values);

      if (result.success) {
        toast.success(
          mode === "edit"
            ? "Clinic updated."
            : `Clinic "${values.name}" wired to franchise.`
        );
        onOpenChange(false);
        router.refresh();
      } else {
        applyFieldError(result.field, result.error);
      }
    });
  });

  const canAssignPincode = mode === "edit" && !!clinicId;

  const onAssignPincode = () => {
    if (!canAssignPincode || !clinicId) return;
    const trimmed = pincode.trim();
    startAssignTransition(async () => {
      const result = await assignPincodeToFranchiseClinic(trimmed, clinicId);
      if (result.success) {
        setConflictMessage(null);
        setPincode("");
        const { reassignedCount, riderWarnings } = result.data;
        toast.success(
          `Pincode ${trimmed} assigned. ${reassignedCount} customer(s) reassigned.`
        );
        for (const warning of riderWarnings) {
          toast.warning(warning.message);
        }
        router.refresh();
      } else {
        // Surface the overlap-conflict text (which names the pincode + every
        // mapped entity) through the banner (Req 15.2, 15.3).
        setConflictMessage(result.error);
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Edit Franchise Clinic" : "Wire Clinic to Franchise"}
          </DialogTitle>
          <DialogDescription>
            The clinic carries the geographic routing origin. Latitude and
            longitude live only on the clinic.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            {/* franchise_id is preset/hidden — it is never edited here. */}
            <input type="hidden" {...form.register("franchise_id")} />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Clinic name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Madhapur Clinic" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input placeholder="Full address" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* Pin the clinic location on the map — writes latitude/longitude
                into the same form fields the numeric inputs below validate. */}
            <ClinicLocationPicker
              form={form as unknown as UseFormReturn<ClinicMasterSchemaInput>}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="latitude"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Latitude</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="any"
                        placeholder="-90 to 90"
                        value={
                          field.value === undefined ||
                          Number.isNaN(field.value)
                            ? ""
                            : field.value
                        }
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === ""
                              ? undefined
                              : e.target.valueAsNumber
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="longitude"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Longitude</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="any"
                        placeholder="-180 to 180"
                        value={
                          field.value === undefined ||
                          Number.isNaN(field.value)
                            ? ""
                            : field.value
                        }
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === ""
                              ? undefined
                              : e.target.valueAsNumber
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isPending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={isPending}>
                {isPending
                  ? "Saving..."
                  : mode === "edit"
                    ? "Save Changes"
                    : "Wire Clinic"}
              </Button>
            </DialogFooter>
          </form>
        </Form>

        {/* Served pincodes — assignment is only possible once the Clinic exists
            (edit mode), since a pincode is wired to a persisted Clinic id. */}
        <div className="space-y-3 border-t pt-4">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
              <MapPin className="h-4 w-4 text-emerald-600" />
              Served pincodes
            </h3>
            <p className="text-xs text-muted-foreground">
              {canAssignPincode
                ? "Assign a 6-digit pincode this clinic serves."
                : "Save the clinic first to assign served pincodes."}
            </p>
          </div>

          <PincodeConflictBanner
            message={conflictMessage}
            onDismiss={() => setConflictMessage(null)}
          />

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label
                htmlFor="served-pincode"
                className="text-xs text-muted-foreground"
              >
                Pincode
              </label>
              <Input
                id="served-pincode"
                inputMode="numeric"
                maxLength={6}
                placeholder="6-digit pincode"
                value={pincode}
                disabled={!canAssignPincode || isAssigning}
                onChange={(e) =>
                  setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                className="mt-0.5"
              />
            </div>
            <Button
              type="button"
              onClick={onAssignPincode}
              disabled={
                !canAssignPincode || isAssigning || pincode.trim().length !== 6
              }
            >
              {isAssigning ? "Assigning..." : "Assign pincode"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ClinicWiringDialog;
