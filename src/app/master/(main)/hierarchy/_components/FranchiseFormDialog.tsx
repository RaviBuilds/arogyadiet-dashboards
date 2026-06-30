"use client";

// src/app/master/(main)/hierarchy/_components/FranchiseFormDialog.tsx
// Master Hierarchy — Franchise create/edit dialog (multi-tenant-franchise —
// Task 13.3, Req 12.2, 3.5, 4.1).
//
// Client leaf mounted at the FranchiseFormDialog markers in HierarchyTree.tsx.
// React Hook Form + Zod (`franchiseSchema`) drives the form; mutations call the
// franchise Server Actions (`createFranchise` / `updateFranchise`) inside a
// transition, surface the returned ActionResult error/field on failure
// (Req 12.2), and refresh the RSC tree on success.
//
// OWNER PICKER (Req 4.1): a Franchise has EXACTLY ONE FRANCHISE_ADMIN owner. The
// owner is chosen from a <Select> populated by `listFranchiseAdmins()` when the
// dialog opens. Admins that already own a franchise are still listed (the create
// flow re-stamps) but their label is suffixed " — already assigned". A
// "Create new Franchise Admin" section lets the operator mint a brand-new,
// franchise-LESS FRANCHISE_ADMIN via `createUnassignedFranchiseAdmin(...)` and
// auto-selects it as the owner on success — closing the UX gap where the owner
// previously had to be entered as a raw user UUID.
//
// On create the owning Group is preset (`groupId`) and the group_id field is
// hidden. On create the franchise is persisted as `onboarding` (Req 3.5), so the
// status control is offered ONLY in edit mode and is otherwise governed by the
// dedicated FranchiseStatusControls.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";

import { createFranchise, updateFranchise } from "@/actions/master-actions/franchiseActions";
import {
  listFranchiseAdmins,
  createUnassignedFranchiseAdmin,
} from "@/actions/master-actions/franchiseAdminActions";
import { franchiseSchema, type FranchiseSchemaInput } from "@/validations/franchise";
import type { FranchiseStatus } from "@/types/franchise";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Separator } from "@/shared/components/ui/separator";
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
  FormDescription,
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

/** A FRANCHISE_ADMIN owner eligible to be assigned as a franchise owner. */
interface FranchiseAdminOption {
  id: string;
  full_name: string;
  email: string;
  franchise_id: string | null;
}

/** Password input with a show/hide eye toggle. */
function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  show,
  onToggle,
}: {
  id: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="pr-10"
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        aria-label={show ? "Hide password" : "Show password"}
        tabIndex={-1}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** The minimal existing-franchise shape needed to seed the edit form. */
export interface FranchiseFormTarget {
  id: string;
  name: string;
  group_id: string;
  owner_user_id: string;
  status: FranchiseStatus;
}

type FranchiseFormDialogProps =
  | {
      mode: "create";
      /** The Group the new franchise is created under (preset + hidden). */
      groupId: string;
      /** Optional controlled trigger element. */
      trigger?: React.ReactNode;
    }
  | {
      mode: "edit";
      /** The existing franchise to edit. */
      franchise: FranchiseFormTarget;
      /** Optional controlled trigger element. */
      trigger?: React.ReactNode;
    };

const STATUS_OPTIONS: { value: FranchiseStatus; label: string }[] = [
  { value: "onboarding", label: "Onboarding" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
];

export default function FranchiseFormDialog(props: FranchiseFormDialogProps) {
  const { mode, trigger } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // ── Owner picker state ───────────────────────────────────────────────────
  const [owners, setOwners] = useState<FranchiseAdminOption[]>([]);
  const [ownersLoading, setOwnersLoading] = useState(false);

  // ── "Create new Franchise Admin" sub-form state ────────────────────────────
  const [showCreateAdmin, setShowCreateAdmin] = useState(false);
  const [isCreatingAdmin, startCreateAdmin] = useTransition();
  const [showPassword, setShowPassword] = useState(false);
  const [newAdmin, setNewAdmin] = useState({
    fullName: "",
    email: "",
    mobile: "",
    password: "",
    confirmPassword: "",
  });

  // The form value shape always carries every franchiseSchema field; group_id is
  // preset on create and status is only edited in edit mode.
  const defaultValues: FranchiseSchemaInput =
    mode === "create"
      ? {
          name: "",
          group_id: props.groupId,
          owner_user_id: "",
          status: "onboarding",
        }
      : {
          name: props.franchise.name,
          group_id: props.franchise.group_id,
          owner_user_id: props.franchise.owner_user_id,
          status: props.franchise.status,
        };

  const form = useForm<FranchiseSchemaInput>({
    resolver: zodResolver(franchiseSchema),
    defaultValues,
  });

  // Load the eligible FRANCHISE_ADMIN owners whenever the dialog opens.
  const loadOwners = async () => {
    setOwnersLoading(true);
    const result = await listFranchiseAdmins();
    setOwnersLoading(false);
    if (result.success) {
      setOwners(result.data);
    } else {
      toast.error(result.error);
    }
  };

  // Keep the form seeded with the latest props and refresh the owners list
  // whenever the dialog opens (e.g. the edit target changed, or the preset group
  // differs).
  useEffect(() => {
    if (open) {
      form.reset(defaultValues);
      setShowCreateAdmin(false);
      setShowPassword(false);
      setNewAdmin({ fullName: "", email: "", mobile: "", password: "", confirmPassword: "" });
      void loadOwners();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const applyFieldError = (field: string | undefined, error: string) => {
    if (
      field === "name" ||
      field === "group_id" ||
      field === "owner_user_id" ||
      field === "status"
    ) {
      form.setError(field, { message: error });
    }
    toast.error(error);
  };

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      if (mode === "create") {
        const result = await createFranchise({
          name: values.name,
          group_id: values.group_id,
          owner_user_id: values.owner_user_id,
        });
        if (result.success) {
          toast.success(`Franchise "${values.name}" created.`);
          setOpen(false);
          router.refresh();
        } else {
          applyFieldError(result.field, result.error);
        }
      } else {
        const result = await updateFranchise(props.franchise.id, {
          name: values.name,
          group_id: values.group_id,
          owner_user_id: values.owner_user_id,
          ...(values.status !== undefined ? { status: values.status } : {}),
        });
        if (result.success) {
          toast.success("Franchise updated.");
          setOpen(false);
          router.refresh();
        } else {
          applyFieldError(result.field, result.error);
        }
      }
    });
  });

  // Create a brand-new, franchise-LESS FRANCHISE_ADMIN, then refresh the owners
  // list and auto-select the new user as the franchise owner.
  const onCreateAdmin = () => {
    if (newAdmin.password !== newAdmin.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    startCreateAdmin(async () => {
      const result = await createUnassignedFranchiseAdmin({
        fullName: newAdmin.fullName,
        email: newAdmin.email,
        mobile: newAdmin.mobile || undefined,
        password: newAdmin.password,
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(`Franchise Admin "${result.data.full_name}" created.`);

      // Refresh the owners list, then auto-select the new owner.
      const listResult = await listFranchiseAdmins();
      if (listResult.success) {
        setOwners(listResult.data);
      } else {
        // Fall back to optimistically appending the newly created admin.
        setOwners((prev) => [
          {
            id: result.data.userId,
            full_name: result.data.full_name,
            email: result.data.email,
            franchise_id: null,
          },
          ...prev,
        ]);
      }

      form.setValue("owner_user_id", result.data.userId, {
        shouldValidate: true,
        shouldDirty: true,
      });
      form.clearErrors("owner_user_id");

      setShowCreateAdmin(false);
      setShowPassword(false);
      setNewAdmin({ fullName: "", email: "", mobile: "", password: "", confirmPassword: "" });
    });
  };

  const ownerLabel = (owner: FranchiseAdminOption) => {
    const base = `${owner.full_name} (${owner.email})`;
    return owner.franchise_id ? `${base} — already assigned` : base;
  };

  const title = mode === "create" ? "Add Franchise" : "Edit Franchise";
  const submitLabel = mode === "create" ? "Create Franchise" : "Save Changes";
  const canSubmitNewAdmin =
    newAdmin.fullName.trim().length > 0 &&
    newAdmin.email.trim().length > 0 &&
    newAdmin.password.length >= 6 &&
    newAdmin.password === newAdmin.confirmPassword;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ?? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setOpen(true)}
        >
          {title}
        </Button>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Register a new franchise under this group. It starts in onboarding."
              : "Update this franchise's details and FRANCHISE_ADMIN owner."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            {/* group_id is preset on create (hidden) and read-only context on edit. */}
            <input type="hidden" {...form.register("group_id")} />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Franchise name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Madhapur Franchise" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="owner_user_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Franchise owner (Franchise Admin)</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={ownersLoading}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            ownersLoading
                              ? "Loading franchise admins..."
                              : "Select a franchise admin"
                          }
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {owners.map((owner) => (
                        <SelectItem key={owner.id} value={owner.id}>
                          {ownerLabel(owner)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    The single Franchise Admin who owns this franchise.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Create new Franchise Admin affordance ─────────────────────── */}
            <div className="rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Need a new Franchise Admin?</p>
                  <p className="text-xs text-muted-foreground">
                    Create an account to assign as the owner.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={showCreateAdmin ? "secondary" : "outline"}
                  onClick={() => setShowCreateAdmin((prev) => !prev)}
                >
                  {showCreateAdmin ? "Cancel" : "Create new Franchise Admin"}
                </Button>
              </div>

              {showCreateAdmin && (
                <div className="mt-3 space-y-3">
                  <Separator />
                  <div className="space-y-1.5">
                    <Label htmlFor="new-admin-name">Full name</Label>
                    <Input
                      id="new-admin-name"
                      placeholder="e.g. Priya Sharma"
                      value={newAdmin.fullName}
                      onChange={(e) =>
                        setNewAdmin((p) => ({ ...p, fullName: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-admin-email">Email</Label>
                    <Input
                      id="new-admin-email"
                      type="email"
                      placeholder="admin@example.com"
                      value={newAdmin.email}
                      onChange={(e) =>
                        setNewAdmin((p) => ({ ...p, email: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-admin-mobile">Mobile (optional)</Label>
                    <Input
                      id="new-admin-mobile"
                      placeholder="e.g. 9876543210"
                      value={newAdmin.mobile}
                      onChange={(e) =>
                        setNewAdmin((p) => ({ ...p, mobile: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-admin-password">Password</Label>
                    <PasswordInput
                      id="new-admin-password"
                      placeholder="At least 6 characters"
                      value={newAdmin.password}
                      onChange={(e) =>
                        setNewAdmin((p) => ({ ...p, password: e.target.value }))
                      }
                      show={showPassword}
                      onToggle={() => setShowPassword((s) => !s)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-admin-confirm-password">
                      Confirm password
                    </Label>
                    <PasswordInput
                      id="new-admin-confirm-password"
                      placeholder="Re-enter password"
                      value={newAdmin.confirmPassword}
                      onChange={(e) =>
                        setNewAdmin((p) => ({
                          ...p,
                          confirmPassword: e.target.value,
                        }))
                      }
                      show={showPassword}
                      onToggle={() => setShowPassword((s) => !s)}
                    />
                    {newAdmin.confirmPassword.length > 0 &&
                      newAdmin.password !== newAdmin.confirmPassword && (
                        <p className="text-xs text-destructive">
                          Passwords do not match.
                        </p>
                      )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={onCreateAdmin}
                    disabled={isCreatingAdmin || !canSubmitNewAdmin}
                  >
                    {isCreatingAdmin ? "Creating..." : "Create admin"}
                  </Button>
                </div>
              )}
            </div>

            {mode === "edit" && (
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {STATUS_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Lifecycle transitions are normally driven by the status
                      controls; editing here writes the value directly.
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
                {isPending ? "Saving..." : submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
