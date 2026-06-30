"use client";

// src/shared/components/master/core-business/BusinessManager.tsx
// Client leaf for Business CRUD within the additive master-portal "Core
// Business" section (core-clinic-architecture, Task 14.1). This section is
// scoped to the Core business only, so the Business_Type is fixed to "Core"
// here (Req 21.3) — the type field is not exposed. React Hook Form + Zod drives
// create/edit; mutations call the master business Server Actions, surface the
// ActionResult error/field on failure (Req 20.3), and refresh the RSC tree on
// success. Delete surfaces the dependency-guarded rejection message (Req 20.6).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Briefcase, Plus, Pencil, Trash2 } from "lucide-react";

import {
  createBusiness,
  updateBusiness,
  deleteBusiness,
} from "@/actions/master-actions/businessActions";
import type { Business } from "@/types/clinic";

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

// Core Business surface form schema (Req 20.1): trimmed name 1..100. The
// Business_Type is implicit ("Core") in this scoped section (Req 21.3), so it is
// not part of the form.
const businessFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Business name is required")
    .max(100, "Business name cannot exceed 100 characters"),
});

type BusinessFormInput = z.infer<typeof businessFormSchema>;

interface BusinessManagerProps {
  businesses: Business[];
}

export function BusinessManager({ businesses }: BusinessManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Business | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Business | null>(null);

  const createForm = useForm<BusinessFormInput>({
    resolver: zodResolver(businessFormSchema),
    defaultValues: { name: "" },
  });

  const editForm = useForm<BusinessFormInput>({
    resolver: zodResolver(businessFormSchema),
    defaultValues: { name: "" },
  });

  const openCreate = () => {
    createForm.reset({ name: "" });
    setCreateOpen(true);
  };

  const openEdit = (business: Business) => {
    editForm.reset({ name: business.name });
    setEditTarget(business);
  };

  const onCreate = createForm.handleSubmit((values) => {
    startTransition(async () => {
      // Scoped to the Core business (Req 21.3): always type "Core".
      const result = await createBusiness({ name: values.name, type: "Core" });
      if (result.success) {
        toast.success(`Business "${values.name}" created.`);
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
      const result = await updateBusiness(editTarget.id, {
        name: values.name,
        type: "Core",
      });
      if (result.success) {
        toast.success("Business updated.");
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
      const result = await deleteBusiness(deleteTarget.id);
      if (result.success) {
        toast.success("Business deleted.");
        setDeleteTarget(null);
        router.refresh();
      } else {
        // Dependency-guarded rejection (Req 20.6).
        toast.error(result.error);
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-emerald-600" />
          Core Business ({businesses.length})
        </CardTitle>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Add Business
        </Button>
      </CardHeader>
      <CardContent>
        {businesses.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No core business yet. Add one to start the hierarchy.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {businesses.map((business) => (
              <li
                key={business.id}
                className="flex items-center justify-between py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">
                    {business.name}
                  </p>
                  <p className="text-xs text-slate-500">Type: {business.type}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    onClick={() => openEdit(business)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setDeleteTarget(business)}
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
            <DialogTitle>Add Core Business</DialogTitle>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={onCreate} className="space-y-4">
              <FormField
                control={createForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Core Hyderabad Business"
                        {...field}
                      />
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
                  {isPending ? "Saving..." : "Create Business"}
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
            <DialogTitle>Edit Core Business</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={onEdit} className="space-y-4">
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business name</FormLabel>
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
            <DialogTitle className="text-destructive">
              Delete Business
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete{" "}
            <strong className="text-foreground">{deleteTarget?.name}</strong>? A
            business with associated kitchens cannot be deleted.
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
