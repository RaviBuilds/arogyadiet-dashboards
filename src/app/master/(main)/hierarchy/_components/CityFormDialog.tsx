"use client";

// src/app/master/(main)/hierarchy/_components/CityFormDialog.tsx
// Master Hierarchy — City create/edit dialog (multi-tenant-franchise — Task 13.2,
// Req 12.2, 1.2, 2.3).
//
// Self-contained client leaf that drives City CRUD for a Franchise Business via
// React Hook Form + Zod (`franchiseCitySchema`). Mutations call the franchise
// city Server Actions inside a transition, surface the ActionResult error/field
// on failure (toast + inline field error), and refresh the RSC tree on success.
//
// Follows the established master-portal dialog convention (see
// `src/shared/components/master/core-clinics/CityManager.tsx`): Shadcn
// Dialog/Form/Input/Button, `toast` via sonner, `useTransition` for the action
// call, and `router.refresh()` on success.
//
// A later wiring pass (HierarchyTree.tsx) mounts this component at its TODO
// markers — it is NOT edited here. The dialog is therefore flexible about how it
// is opened: pass a controlled `open`/`onOpenChange`, supply a custom `trigger`,
// or let it render its own default button (and manage its own open state).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";

import {
  createFranchiseCity,
  updateFranchiseCity,
} from "@/actions/master-actions/cityActions";
import {
  franchiseCitySchema,
  type FranchiseCitySchemaInput,
} from "@/validations/franchise";
import type { FranchiseCity } from "@/types/franchise";

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
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";

/** The minimal existing-city shape required to edit a Franchise City. */
type EditableCity = Pick<FranchiseCity, "id" | "name" | "business_id">;

interface CommonProps {
  /** Controlled open state. When omitted, the dialog manages its own state. */
  open?: boolean;
  /** Controlled open-change handler (paired with `open`). */
  onOpenChange?: (open: boolean) => void;
  /**
   * Custom trigger node. When omitted, a sensible default button is rendered.
   * Pass `null` to render no trigger at all (pure controlled usage).
   */
  trigger?: React.ReactNode | null;
}

type CityFormDialogProps =
  | (CommonProps & {
      mode: "create";
      /** The owning Franchise Business this City is created under. */
      businessId: string;
      city?: never;
    })
  | (CommonProps & {
      mode: "edit";
      /** The existing City being renamed. */
      city: EditableCity;
      businessId?: never;
    });

export default function CityFormDialog(props: CityFormDialogProps) {
  const { mode, open, onOpenChange, trigger } = props;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Support both controlled (open/onOpenChange supplied) and uncontrolled usage.
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  const businessId =
    mode === "create" ? props.businessId : props.city.business_id;

  const form = useForm<FranchiseCitySchemaInput>({
    resolver: zodResolver(franchiseCitySchema),
    defaultValues: {
      name: mode === "edit" ? props.city.name : "",
      business_id: businessId,
    },
  });

  // Reset the form to the latest values whenever the dialog opens.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      form.reset({
        name: mode === "edit" ? props.city.name : "",
        business_id: businessId,
      });
    }
    setOpen(next);
  };

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result =
        mode === "create"
          ? await createFranchiseCity(values)
          : await updateFranchiseCity(props.city.id, values);

      if (result.success) {
        toast.success(
          mode === "create"
            ? `City "${values.name}" created.`
            : "City updated."
        );
        handleOpenChange(false);
        router.refresh();
        return;
      }

      // Surface the field-specific error inline when it maps to a form field;
      // always echo the message as a toast (Req 12.2 / ActionResult contract).
      if (result.field === "name" || result.field === "business_id") {
        form.setError(result.field, { message: result.error });
      }
      toast.error(result.error);
    });
  });

  const defaultTrigger =
    mode === "create" ? (
      <Button type="button" size="sm" variant="outline" className="gap-1.5">
        <Plus className="h-3.5 w-3.5" />
        Add City
      </Button>
    ) : (
      <Button type="button" size="icon-sm" variant="ghost" aria-label="Edit city">
        <Pencil className="h-3.5 w-3.5" />
      </Button>
    );

  const triggerNode = trigger === undefined ? defaultTrigger : trigger;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {triggerNode !== null && (
        <DialogTrigger asChild>{triggerNode}</DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Add City" : "Edit City"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create a city under this franchise business."
              : "Rename this city."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>City name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Hyderabad"
                      autoFocus
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
                {isPending
                  ? "Saving..."
                  : mode === "create"
                    ? "Create City"
                    : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
