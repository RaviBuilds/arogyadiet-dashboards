"use client";

// src/app/master/(main)/hierarchy/_components/GroupFormDialog.tsx
// Master Hierarchy — Group create/edit dialog (multi-tenant-franchise — Task 13.2,
// Req 12.2, 1.2, 2.3).
//
// Self-contained client leaf that drives Group CRUD for a City via React Hook
// Form + Zod (`groupSchema`). A Group owns EXACTLY ONE Kitchen, so CREATE mode
// also creates that Kitchen: it delegates to `createGroup`, which accepts an
// optional `kitchenName` (defaulting blank → "<group> Kitchen" server-side). EDIT
// mode is a rename only and calls `updateGroup`.
//
// Mutations run inside a transition, surface the ActionResult error/field on
// failure (toast + inline field error), and refresh the RSC tree on success.
// Follows the established master-portal dialog convention (see
// `src/shared/components/master/core-clinics/CityManager.tsx`).
//
// A later wiring pass (HierarchyTree.tsx) mounts this component — it is NOT
// edited here. The dialog supports a controlled `open`/`onOpenChange`, a custom
// `trigger`, or its own default button + internal open state.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Plus, Pencil } from "lucide-react";

import {
  createGroup,
  updateGroup,
} from "@/actions/master-actions/groupActions";
import { groupSchema } from "@/validations/franchise";
import type { Group } from "@/types/franchise";

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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";

// Form schema: `groupSchema` (name + city_id) plus the optional Kitchen label
// collected only in CREATE mode. The action defaults a blank kitchen name to
// "<group> Kitchen", so the input is optional here.
const groupFormSchema = groupSchema.extend({
  kitchenName: z
    .string()
    .trim()
    .max(100, "Kitchen name cannot exceed 100 characters")
    .optional(),
});

type GroupFormInput = z.infer<typeof groupFormSchema>;

/** The minimal existing-group shape required to rename a Group. */
type EditableGroup = Pick<Group, "id" | "name" | "city_id">;

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

type GroupFormDialogProps =
  | (CommonProps & {
      mode: "create";
      /** The City this Group (and its single Kitchen) is created under. */
      cityId: string;
      group?: never;
    })
  | (CommonProps & {
      mode: "edit";
      /** The existing Group being renamed. */
      group: EditableGroup;
      cityId?: never;
    });

export default function GroupFormDialog(props: GroupFormDialogProps) {
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

  const cityId = mode === "create" ? props.cityId : props.group.city_id;

  const buildDefaults = (): GroupFormInput => ({
    name: mode === "edit" ? props.group.name : "",
    city_id: cityId,
    kitchenName: "",
  });

  const form = useForm<GroupFormInput>({
    resolver: zodResolver(groupFormSchema),
    defaultValues: buildDefaults(),
  });

  // Reset the form to the latest values whenever the dialog opens.
  const handleOpenChange = (next: boolean) => {
    if (next) form.reset(buildDefaults());
    setOpen(next);
  };

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result =
        mode === "create"
          ? await createGroup({
              name: values.name,
              city_id: values.city_id,
              kitchenName: values.kitchenName,
            })
          : // Edit is a rename only — never touches the owned Kitchen (Req 2.6).
            await updateGroup(props.group.id, {
              name: values.name,
              city_id: values.city_id,
            });

      if (result.success) {
        toast.success(
          mode === "create"
            ? `Group "${values.name}" created.`
            : "Group updated."
        );
        handleOpenChange(false);
        router.refresh();
        return;
      }

      // Surface the field-specific error inline when it maps to a form field;
      // always echo the message as a toast (Req 12.2 / ActionResult contract).
      if (result.field === "name" || result.field === "city_id") {
        form.setError(result.field, { message: result.error });
      }
      toast.error(result.error);
    });
  });

  const defaultTrigger =
    mode === "create" ? (
      <Button type="button" size="sm" variant="outline" className="gap-1.5">
        <Plus className="h-3.5 w-3.5" />
        Add Group
      </Button>
    ) : (
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Edit group"
      >
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
            {mode === "create" ? "Add Group" : "Edit Group"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create a group and its kitchen under this city."
              : "Rename this group."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Group name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. North Zone"
                      autoFocus
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {mode === "create" && (
              <FormField
                control={form.control}
                name="kitchenName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Kitchen name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Defaults to “<group> Kitchen”"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormDescription>
                      Optional. Leave blank to name the kitchen after the group.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

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
                    ? "Create Group"
                    : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
