"use client";

// src/shared/components/master/core-clinics/KitchenManager.tsx
// Client leaf for Kitchen CRUD within the master-portal Core Clinic Management
// surface (core-clinic-architecture, Task 11.1). React Hook Form + Zod drives
// create/edit; a valid City association is required (Req 2.6). Mutations call
// the master kitchen Server Actions, surface the ActionResult error/field on
// failure (Req 14.3), and refresh the RSC tree on success. Delete surfaces the
// dependency-guarded rejection message (Req 14.6).
//
// SCHEMA NOTE: a master-specific `kitchenFormSchema` is declared here (the
// shared `@/validations/clinic` module has no kitchen schema). It mirrors the
// kitchen Server Action bounds: name 1..200 and a required `city_id`.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { CookingPot, Plus, Pencil, Trash2 } from "lucide-react";

import {
  createKitchen,
  updateKitchen,
  deleteKitchen,
} from "@/actions/master-actions/kitchenActions";
import type { Business, City, Kitchen } from "@/types/clinic";

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

// Master-specific kitchen form schema (Req 2.4, 2.5, 2.8, 14.7): a name, a
// required Business, and a required City — and explicitly NO geo/address fields.
const kitchenFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Kitchen name is required")
    .max(200, "Kitchen name cannot exceed 200 characters"),
  business_id: z.string().min(1, "A business association is required"),
  city_id: z.string().min(1, "A city association is required"),
});

type KitchenFormInput = z.infer<typeof kitchenFormSchema>;

interface KitchenManagerProps {
  kitchens: Kitchen[];
  businesses: Business[];
  cities: City[];
}

export function KitchenManager({ kitchens, businesses, cities }: KitchenManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Kitchen | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Kitchen | null>(null);

  const businessNameById = new Map(businesses.map((b) => [b.id, b.name]));
  const cityNameById = new Map(cities.map((c) => [c.id, c.name]));

  // Default the Business when exactly one exists (the common Core case).
  const defaultBusinessId = businesses.length === 1 ? businesses[0].id : "";

  const createForm = useForm<KitchenFormInput>({
    resolver: zodResolver(kitchenFormSchema),
    defaultValues: { name: "", business_id: defaultBusinessId, city_id: "" },
  });

  const editForm = useForm<KitchenFormInput>({
    resolver: zodResolver(kitchenFormSchema),
    defaultValues: { name: "", business_id: defaultBusinessId, city_id: "" },
  });

  const openCreate = () => {
    createForm.reset({ name: "", business_id: defaultBusinessId, city_id: "" });
    setCreateOpen(true);
  };

  const openEdit = (kitchen: Kitchen) => {
    editForm.reset({
      name: kitchen.name,
      business_id: kitchen.business_id ?? "",
      city_id: kitchen.city_id ?? "",
    });
    setEditTarget(kitchen);
  };

  const applyFieldError = (
    form: typeof createForm,
    field: string | undefined,
    error: string
  ) => {
    if (field === "name" || field === "business_id" || field === "city_id") {
      form.setError(field, { message: error });
    }
    toast.error(error);
  };

  const onCreate = createForm.handleSubmit((values) => {
    startTransition(async () => {
      const result = await createKitchen({
        name: values.name,
        business_id: values.business_id,
        city_id: values.city_id,
      });
      if (result.success) {
        toast.success(`Kitchen "${values.name}" created.`);
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
      const result = await updateKitchen(editTarget.id, {
        name: values.name,
        business_id: values.business_id,
        city_id: values.city_id,
      });
      if (result.success) {
        toast.success("Kitchen updated.");
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
      const result = await deleteKitchen(deleteTarget.id);
      if (result.success) {
        toast.success("Kitchen deleted.");
        setDeleteTarget(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const noBusinesses = businesses.length === 0;
  const noCities = cities.length === 0;
  const createDisabled = noBusinesses || noCities;
  const createDisabledReason = noBusinesses
    ? "Add a business first"
    : noCities
      ? "Add a city first"
      : undefined;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <CookingPot className="h-4 w-4 text-emerald-600" />
          Kitchens ({kitchens.length})
        </CardTitle>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={openCreate}
          disabled={createDisabled}
          title={createDisabledReason}
        >
          <Plus className="h-4 w-4" />
          Add Kitchen
        </Button>
      </CardHeader>
      <CardContent>
        {kitchens.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No kitchens yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {kitchens.map((kitchen) => (
              <li
                key={kitchen.id}
                className="flex items-center justify-between py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">
                    {kitchen.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    Business:{" "}
                    {kitchen.business_id
                      ? businessNameById.get(kitchen.business_id) ?? "Unknown"
                      : "— Unassigned"}
                    {" · City: "}
                    {kitchen.city_id
                      ? cityNameById.get(kitchen.city_id) ?? "Unknown"
                      : "— Unassigned"}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    onClick={() => openEdit(kitchen)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setDeleteTarget(kitchen)}
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Kitchen</DialogTitle>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={onCreate} className="space-y-4">
              <KitchenFields form={createForm} businesses={businesses} cities={cities} />
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={isPending}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Saving..." : "Create Kitchen"}
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Kitchen</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={onEdit} className="space-y-4">
              <KitchenFields form={editForm} businesses={businesses} cities={cities} />
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
            <DialogTitle className="text-destructive">Delete Kitchen</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete{" "}
            <strong className="text-foreground">{deleteTarget?.name}</strong>? A
            kitchen referenced by one or more clinics cannot be deleted.
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

function KitchenFields({
  form,
  businesses,
  cities,
}: {
  form: ReturnType<typeof useForm<KitchenFormInput>>;
  businesses: Business[];
  cities: City[];
}) {
  return (
    <>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Kitchen name</FormLabel>
            <FormControl>
              <Input placeholder="e.g. Central Kitchen" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="business_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Business</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select a business" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {businesses.map((business) => (
                  <SelectItem key={business.id} value={business.id}>
                    {business.name}
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
        name="city_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>City</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select a city" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {cities.map((city) => (
                  <SelectItem key={city.id} value={city.id}>
                    {city.name}
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
