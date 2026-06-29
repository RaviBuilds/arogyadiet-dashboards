"use client";

// src/app/master/(main)/hierarchy/_components/BusinessFormDialog.tsx
// Master Hierarchy — Franchise Business create/edit dialog
// (multi-tenant-franchise — Req 1.1, the top-level entry point of the hierarchy).
//
// The Franchise Hierarchy is built top-down from a Business of type `Franchise`.
// This dialog is the entry point that lets a Master Admin create that Business
// (and rename an existing one). It reuses the core-clinic `businessActions`
// (`createBusiness` / `updateBusiness`), forcing `type: "Franchise"` since the
// Core business is managed separately under the System → Core Business section.
//
// Self-contained client leaf: supports a controlled `open`/`onOpenChange`, a
// custom `trigger`, or its own default button + internal open state.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Plus, Pencil } from "lucide-react";

import {
  createBusiness,
  updateBusiness,
} from "@/actions/master-actions/businessActions";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";

/** The minimal existing-business shape required to rename a Franchise Business. */
interface EditableBusiness {
  id: string;
  name: string;
}

interface CommonProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Custom trigger; omit for a default button, pass `null` for none. */
  trigger?: React.ReactNode | null;
}

type BusinessFormDialogProps =
  | (CommonProps & { mode: "create"; business?: never })
  | (CommonProps & { mode: "edit"; business: EditableBusiness });

export default function BusinessFormDialog(props: BusinessFormDialogProps) {
  const { mode, open, onOpenChange, trigger } = props;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(mode === "edit" ? props.business.name : "");

  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;

  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  const handleOpenChange = (next: boolean) => {
    if (next) setName(mode === "edit" ? props.business.name : "");
    setOpen(next);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Business name is required");
      return;
    }

    startTransition(async () => {
      const result =
        mode === "create"
          ? await createBusiness({ name: trimmed, type: "Franchise" })
          : await updateBusiness(props.business.id, {
              name: trimmed,
              type: "Franchise",
            });

      if (result.success) {
        toast.success(
          mode === "create"
            ? `Franchise business "${trimmed}" created.`
            : "Business updated.",
        );
        handleOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const defaultTrigger =
    mode === "create" ? (
      <Button type="button" size="sm" className="gap-1.5">
        <Plus className="h-3.5 w-3.5" />
        New Franchise Business
      </Button>
    ) : (
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Edit business"
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
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-slate-700" />
            {mode === "create"
              ? "New Franchise Business"
              : "Edit Franchise Business"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create the top-level Franchise business. You can then add its cities, groups, franchises, and clinics."
              : "Rename this Franchise business."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium">Business name</label>
            <Input
              autoFocus
              placeholder="e.g. ArogyaDiet Franchise Network"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
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
                : mode === "create"
                  ? "Create Business"
                  : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
