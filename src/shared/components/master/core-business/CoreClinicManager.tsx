"use client";

// src/shared/components/master/core-business/CoreClinicManager.tsx
// Client leaf for Core Clinic CRUD + kitchen reassignment within the additive
// master-portal "Core Business" section (core-clinic-architecture, Task 14.1).
//
// Core Clinics carry the full address + latitude + longitude — the Clinic is the
// sole rider pickup / routing origin, so geo lives on the Clinic and never on
// the Kitchen (Req 21.5, 3.11). React Hook Form + Zod (`clinicMasterSchema`,
// name 1..200 / address 1..500) drives create/edit (Req 21.5, 21.6). Created
// clinics default `franchise_id = NULL` (Core Clinic) in the Server Action.
//
// REASSIGNMENT (Req 2.13, 2.14): a per-clinic "Reassign kitchen" control calls
// `reassignClinicKitchen`. The same-city rule is enforced server-side; a
// cross-city target is rejected and the existing `kitchen_id` is left unchanged,
// with the same-city error surfaced to the user.
//
// Mutations surface the ActionResult error/field on failure (Req 21.6) and
// refresh the RSC tree on success. Delete surfaces the dependency-guarded
// rejection message.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Hospital, Plus, Pencil, Trash2, ArrowLeftRight } from "lucide-react";

import {
  createClinic,
  updateClinic,
  deleteClinic,
} from "@/actions/master-actions/clinicActions";
import { reassignClinicKitchen } from "@/actions/master-actions/kitchenActions";
import {
  clinicMasterSchema,
  type ClinicMasterSchemaInput,
} from "@/validations/clinic";
import type { Clinic, Kitchen } from "@/types/clinic";

import { ClinicLocationPicker } from "./ClinicLocationPicker";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

interface CoreClinicManagerProps {
  clinics: Clinic[];
  kitchens: Kitchen[];
}

type ClinicFormField = keyof ClinicMasterSchemaInput;

const EMPTY_CLINIC: ClinicMasterSchemaInput = {
  name: "",
  address: "",
  // latitude/longitude intentionally left undefined so the numeric inputs start
  // blank; the schema rejects missing values (Req 21.6).
  latitude: undefined as unknown as number,
  longitude: undefined as unknown as number,
  kitchen_id: "",
};

export function CoreClinicManager({ clinics, kitchens }: CoreClinicManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Clinic | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Clinic | null>(null);
  const [reassignTarget, setReassignTarget] = useState<Clinic | null>(null);
  const [reassignKitchenId, setReassignKitchenId] = useState<string>("");

  const kitchenNameById = new Map(kitchens.map((k) => [k.id, k.name]));

  const createForm = useForm<ClinicMasterSchemaInput>({
    resolver: zodResolver(clinicMasterSchema),
    defaultValues: EMPTY_CLINIC,
  });

  const editForm = useForm<ClinicMasterSchemaInput>({
    resolver: zodResolver(clinicMasterSchema),
    defaultValues: EMPTY_CLINIC,
  });

  const openCreate = () => {
    createForm.reset(EMPTY_CLINIC);
    setCreateOpen(true);
  };

  const openEdit = (clinic: Clinic) => {
    editForm.reset({
      name: clinic.name,
      address: clinic.address,
      latitude: clinic.latitude,
      longitude: clinic.longitude,
      kitchen_id: clinic.kitchen_id,
    });
    setEditTarget(clinic);
  };

  const openReassign = (clinic: Clinic) => {
    setReassignKitchenId(clinic.kitchen_id);
    setReassignTarget(clinic);
  };

  const applyFieldError = (
    form: ReturnType<typeof useForm<ClinicMasterSchemaInput>>,
    field: string | undefined,
    error: string
  ) => {
    const known: ClinicFormField[] = [
      "name",
      "address",
      "latitude",
      "longitude",
      "kitchen_id",
    ];
    if (field && (known as string[]).includes(field)) {
      form.setError(field as ClinicFormField, { message: error });
    }
    toast.error(error);
  };

  const onCreate = createForm.handleSubmit((values) => {
    startTransition(async () => {
      const result = await createClinic(values);
      if (result.success) {
        toast.success(`Clinic "${values.name}" created.`);
        setCreateOpen(false);
        router.refresh();
      } else {
        applyFieldError(createForm, result.field, result.error);
      }
    });
  });

  const onEdit = editForm.handleSubmit((values) => {
    if (!editTarget) return;
    startTransition(async () => {
      const result = await updateClinic(editTarget.id, values);
      if (result.success) {
        toast.success("Clinic updated.");
        setEditTarget(null);
        router.refresh();
      } else {
        applyFieldError(editForm, result.field, result.error);
      }
    });
  });

  const onDelete = () => {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result = await deleteClinic(deleteTarget.id);
      if (result.success) {
        toast.success("Clinic deleted.");
        setDeleteTarget(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const onReassign = () => {
    if (!reassignTarget) return;
    if (!reassignKitchenId) {
      toast.error("Select a kitchen to reassign to.");
      return;
    }
    if (reassignKitchenId === reassignTarget.kitchen_id) {
      toast.error("The clinic is already assigned to that kitchen.");
      return;
    }
    startTransition(async () => {
      // Same-city rule enforced server-side (Req 2.13, 2.14): a cross-city
      // target is rejected and the existing kitchen_id is left unchanged.
      const result = await reassignClinicKitchen(
        reassignTarget.id,
        reassignKitchenId
      );
      if (result.success) {
        toast.success("Clinic reassigned to the new kitchen.");
        setReassignTarget(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const noKitchens = kitchens.length === 0;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Hospital className="h-4 w-4 text-emerald-600" />
          Core Clinics ({clinics.length})
        </CardTitle>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={openCreate}
          disabled={noKitchens}
          title={noKitchens ? "Add a kitchen first" : undefined}
        >
          <Plus className="h-4 w-4" />
          Add Clinic
        </Button>
      </CardHeader>
      <CardContent>
        {clinics.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No core clinics yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {clinics.map((clinic) => (
              <li
                key={clinic.id}
                className="flex items-start justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">
                    {clinic.name}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {clinic.address}
                  </p>
                  <p className="text-xs text-slate-400">
                    {clinic.latitude}, {clinic.longitude} · Kitchen:{" "}
                    {kitchenNameById.get(clinic.kitchen_id) ?? "Unknown"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    title="Reassign kitchen"
                    onClick={() => openReassign(clinic)}
                  >
                    <ArrowLeftRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    title="Edit clinic"
                    onClick={() => openEdit(clinic)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    title="Delete clinic"
                    onClick={() => setDeleteTarget(clinic)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Core Clinic</DialogTitle>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={onCreate} className="space-y-4">
              <CoreClinicFields form={createForm} kitchens={kitchens} />
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={isPending}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Saving..." : "Create Clinic"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => !open && setEditTarget(null)}
      >
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Core Clinic</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={onEdit} className="space-y-4">
              <CoreClinicFields form={editForm} kitchens={kitchens} />
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={isPending}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Reassign kitchen */}
      <Dialog
        open={reassignTarget !== null}
        onOpenChange={(open) => !open && setReassignTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reassign Kitchen</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Move{" "}
              <strong className="text-foreground">{reassignTarget?.name}</strong>{" "}
              to a different kitchen. The target kitchen must belong to the same
              city as the clinic.
            </p>
            <Select value={reassignKitchenId} onValueChange={setReassignKitchenId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a kitchen" />
              </SelectTrigger>
              <SelectContent>
                {kitchens.map((kitchen) => (
                  <SelectItem key={kitchen.id} value={kitchen.id}>
                    {kitchen.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={onReassign} disabled={isPending}>
              {isPending ? "Reassigning..." : "Reassign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete Clinic</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete{" "}
            <strong className="text-foreground">{deleteTarget?.name}</strong>? A
            clinic referenced by service areas, riders, customers, or workload
            snapshots cannot be deleted.
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={onDelete}
              disabled={isPending}
            >
              {isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function CoreClinicFields({
  form,
  kitchens,
}: {
  form: ReturnType<typeof useForm<ClinicMasterSchemaInput>>;
  kitchens: Kitchen[];
}) {
  return (
    <>
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
              <Textarea
                placeholder="Full address (up to 500 characters)"
                rows={2}
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <ClinicLocationPicker form={form} />
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
                    field.value === undefined || Number.isNaN(field.value)
                      ? ""
                      : field.value
                  }
                  onChange={(e) =>
                    field.onChange(
                      e.target.value === "" ? undefined : e.target.valueAsNumber
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
                    field.value === undefined || Number.isNaN(field.value)
                      ? ""
                      : field.value
                  }
                  onChange={(e) =>
                    field.onChange(
                      e.target.value === "" ? undefined : e.target.valueAsNumber
                    )
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="kitchen_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Kitchen</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select a kitchen" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {kitchens.map((kitchen) => (
                  <SelectItem key={kitchen.id} value={kitchen.id}>
                    {kitchen.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
