"use client";

// src/shared/components/master/core-clinics/CityManager.tsx
// Client leaf for City CRUD within the master-portal Core Clinic Management
// surface (core-clinic-architecture, Task 11.1). React Hook Form + Zod
// (`citySchema`) drives create/edit; mutations call the master city Server
// Actions and surface the ActionResult error/field on failure (Req 14.3),
// refreshing the RSC tree on success. Delete surfaces the dependency-guarded
// rejection message (Req 14.6).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Building, Plus, Pencil, Trash2 } from "lucide-react";

import {
  createCity,
  updateCity,
  deleteCity,
} from "@/actions/master-actions/cityActions";
import { citySchema, type CityInput } from "@/validations/clinic";
import type { City } from "@/types/clinic";

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

interface CityManagerProps {
  cities: City[];
}

export function CityManager({ cities }: CityManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<City | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<City | null>(null);

  const createForm = useForm<CityInput>({
    resolver: zodResolver(citySchema),
    defaultValues: { name: "" },
  });

  const editForm = useForm<CityInput>({
    resolver: zodResolver(citySchema),
    defaultValues: { name: "" },
  });

  const openCreate = () => {
    createForm.reset({ name: "" });
    setCreateOpen(true);
  };

  const openEdit = (city: City) => {
    editForm.reset({ name: city.name });
    setEditTarget(city);
  };

  const onCreate = createForm.handleSubmit((values) => {
    startTransition(async () => {
      const result = await createCity(values);
      if (result.success) {
        toast.success(`City "${values.name}" created.`);
        setCreateOpen(false);
        router.refresh();
      } else {
        if (result.field === "name") {
          createForm.setError("name", { message: result.error });
        }
        toast.error(result.error);
      }
    });
  });

  const onEdit = editForm.handleSubmit((values) => {
    if (!editTarget) return;
    startTransition(async () => {
      const result = await updateCity(editTarget.id, values);
      if (result.success) {
        toast.success("City updated.");
        setEditTarget(null);
        router.refresh();
      } else {
        if (result.field === "name") {
          editForm.setError("name", { message: result.error });
        }
        toast.error(result.error);
      }
    });
  });

  const onDelete = () => {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result = await deleteCity(deleteTarget.id);
      if (result.success) {
        toast.success("City deleted.");
        setDeleteTarget(null);
        router.refresh();
      } else {
        // Dependency-guarded rejection (Req 14.6).
        toast.error(result.error);
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Building className="h-4 w-4 text-emerald-600" />
          Cities ({cities.length})
        </CardTitle>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Add City
        </Button>
      </CardHeader>
      <CardContent>
        {cities.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No cities yet. Add one to start the hierarchy.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {cities.map((city) => (
              <li
                key={city.id}
                className="flex items-center justify-between py-2.5"
              >
                <span className="text-sm font-medium text-slate-800">
                  {city.name}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    onClick={() => openEdit(city)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setDeleteTarget(city)}
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
            <DialogTitle>Add City</DialogTitle>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={onCreate} className="space-y-4">
              <FormField
                control={createForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Hyderabad" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={isPending}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Saving..." : "Create City"}
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
            <DialogTitle>Edit City</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={onEdit} className="space-y-4">
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
            <DialogTitle className="text-destructive">Delete City</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete <strong className="text-foreground">{deleteTarget?.name}</strong>?
            A city with associated kitchens cannot be deleted.
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
