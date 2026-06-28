"use client";

// src/shared/components/master/core-clinics/ClinicManager.tsx
// Client leaf for Clinic CRUD within the master-portal Core Clinic Management
// surface (core-clinic-architecture, Task 11.1). React Hook Form + Zod
// (`clinicCreateSchema`) drives create/edit: a clinic requires name, address,
// latitude, longitude, and a kitchen selection (Req 14.2, 14.3). Mutations call
// the master clinic Server Actions, surface the ActionResult error/field on
// failure (Req 14.3), and refresh the RSC tree on success. Delete surfaces the
// dependency-guarded rejection message (Req 14.6).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Hospital, Plus, Pencil, Trash2 } from "lucide-react";

import {
  createClinic,
  updateClinic,
  deleteClinic,
} from "@/actions/master-actions/clinicActions";
import {
  clinicCreateSchema,
  type ClinicCreateSchemaInput,
} from "@/validations/clinic";
import type { Clinic, Kitchen } from "@/types/clinic";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
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

interface ClinicManagerProps {
  clinics: Clinic[];
  kitchens: Kitchen[];
}

type ClinicFormField = keyof ClinicCreateSchemaInput;

const EMPTY_CLINIC: ClinicCreateSchemaInput = {
  name: "",
  address: "",
  // latitude/longitude intentionally left undefined so the numeric inputs start
  // blank; the schema rejects missing values (Req 14.3).
  latitude: undefined as unknown as number,
  longitude: undefined as unknown as number,
  kitchen_id: "",
};

export function ClinicManager({ clinics, kitchens }: ClinicManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Clinic | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Clinic | null>(null);

  const kitchenNameById = new Map(kitchens.map((k) => [k.id, k.name]));

  const createForm = useForm<ClinicCreateSchemaInput>({
    resolver: zodResolver(clinicCreateSchema),
    defaultValues: EMPTY_CLINIC,
  });

  const editForm = useForm<ClinicCreateSchemaInput>({
    resolver: zodResolver(clinicCreateSchema),
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

  const applyFieldError = (
    form: ReturnType<typeof useForm<ClinicCreateSchemaInput>>,
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

  const noKitchens = kitchens.length === 0;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Hospital className="h-4 w-4 text-emerald-600" />
          Clinics ({clinics.length})
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
            No clinics yet.
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
                    onClick={() => openEdit(clinic)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Clinic</DialogTitle>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={onCreate} className="space-y-4">
              <ClinicFields form={createForm} kitchens={kitchens} />
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Clinic</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={onEdit} className="space-y-4">
              <ClinicFields form={editForm} kitchens={kitchens} />
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
            <Button variant="destructive" onClick={onDelete} disabled={isPending}>
              {isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ClinicFields({
  form,
  kitchens,
}: {
  form: ReturnType<typeof useForm<ClinicCreateSchemaInput>>;
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
              <Input placeholder="Full address" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
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
