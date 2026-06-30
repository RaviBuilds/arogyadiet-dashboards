"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { UserCog, Plus, Pencil, Trash2, ShieldCheck } from "lucide-react";
import {
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  toggleAdminActive,
} from "@/actions/master-actions/adminActions";
import { DataTableCard } from "@/shared/components/admin/core/DataTableCard";
import { DataSearchFilter } from "@/shared/components/admin/core/DataSearchFilter";
import { SectionHeader } from "@/shared/components/admin/core/SectionHeader";
import { StatusBadge } from "@/shared/components/admin/core/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/shared/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Switch } from "@/shared/components/ui/switch";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  ADMIN_ACCESS_LEVELS,
  ACCESS_LEVEL_LABELS,
  OPERATIONS_GROUPS,
  GROUP_LABELS,
  resolveAccessConfiguration,
  type AdminAccessLevel,
  type OperationsAccess,
  type OperationsGroup,
  type PermissionLevel,
} from "@/lib/auth/adminAccessCore";

interface AdminUser {
  id: string;
  auth_user_id: string;
  full_name: string;
  email: string;
  mobile: string | null;
  is_active: boolean;
  created_at: string;
  admin_access_level: string | null;
  admin_operations_access: OperationsAccess | null;
}

interface UserManagementProps {
  initialAdmins: AdminUser[];
}

/**
 * Per-group operations access editor. Shown only when the selected Access Level
 * is `operations`. Each of the six groups can be selected and set to Manage
 * (default) or View (read-only).
 */
function OperationsGroupConfig({
  value,
  onChange,
  idPrefix,
}: {
  value: OperationsAccess;
  onChange: (next: OperationsAccess) => void;
  idPrefix: string;
}) {
  const toggle = (group: OperationsGroup, checked: boolean) => {
    const next: OperationsAccess = { ...value };
    if (checked) next[group] = next[group] ?? "manage";
    else delete next[group];
    onChange(next);
  };
  const setPermission = (group: OperationsGroup, perm: PermissionLevel) => {
    onChange({ ...value, [group]: perm });
  };

  return (
    <div className="space-y-2.5 rounded-md border p-3">
      <p className="text-xs font-medium text-muted-foreground">
        Operations access — select groups and set each to Manage or View
      </p>
      {OPERATIONS_GROUPS.map((group) => {
        const selected = value[group] !== undefined;
        return (
          <div key={group} className="flex items-center justify-between gap-3">
            <label
              htmlFor={`${idPrefix}-${group}`}
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                id={`${idPrefix}-${group}`}
                checked={selected}
                onCheckedChange={(c) => toggle(group, c === true)}
              />
              {GROUP_LABELS[group]}
            </label>
            <Select
              value={selected ? value[group] : undefined}
              onValueChange={(v) => setPermission(group, v as PermissionLevel)}
              disabled={!selected}
            >
              <SelectTrigger className="h-8 w-28">
                <SelectValue placeholder="Manage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manage">Manage</SelectItem>
                <SelectItem value="view">View</SelectItem>
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}

const SEARCH_OPTIONS = [
  { value: "full_name", label: "Name" },
  { value: "email", label: "Email" },
  { value: "mobile", label: "Mobile" },
];

export default function UserManagement({ initialAdmins }: UserManagementProps) {
  const [admins, setAdmins] = useState<AdminUser[]>(initialAdmins);
  const [searchColumn, setSearchColumn] = useState("full_name");
  const [searchTerm, setSearchTerm] = useState("");

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    fullName: "",
    email: "",
    mobile: "",
    password: "",
    accessLevel: "inventory_operations" as AdminAccessLevel,
    operationsAccess: {} as OperationsAccess,
  });

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState({
    fullName: "",
    mobile: "",
    accessLevel: "inventory_operations" as AdminAccessLevel,
    operationsAccess: {} as OperationsAccess,
  });

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState("");

  const [isPending, startTransition] = useTransition();

  // --- Filtering ---
  const filtered = admins.filter((a) => {
    if (!searchTerm) return true;
    const val =
      String(
        (a as unknown as Record<string, unknown>)[searchColumn] ?? "",
      ).toLowerCase();
    return val.includes(searchTerm.toLowerCase());
  });

  // --- Create ---
  const handleCreate = () => {
    startTransition(async () => {
      const result = await createAdminUser(createForm);
      if (result.success) {
        toast.success("Admin user created successfully.");
        setCreateOpen(false);
        setCreateForm({
          fullName: "",
          email: "",
          mobile: "",
          password: "",
          accessLevel: "inventory_operations",
          operationsAccess: {},
        });
        // Refresh list from server would happen via revalidation; optimistic update:
        window.location.reload();
      } else {
        toast.error(result.error || "Failed to create admin.");
      }
    });
  };

  // --- Edit ---
  const openEdit = (admin: AdminUser) => {
    setEditTarget(admin);
    const cfg = resolveAccessConfiguration(
      admin.admin_access_level,
      admin.admin_operations_access,
    );
    setEditForm({
      fullName: admin.full_name,
      mobile: admin.mobile || "",
      accessLevel: cfg.level,
      operationsAccess: cfg.groups,
    });
    setEditOpen(true);
  };

  const handleEdit = () => {
    if (!editTarget) return;
    startTransition(async () => {
      const result = await updateAdminUser(editTarget.id, editForm);
      if (result.success) {
        toast.success("Admin updated successfully.");
        const persistedOps =
          editForm.accessLevel === "operations" ? editForm.operationsAccess : null;
        setAdmins((prev) =>
          prev.map((a) =>
            a.id === editTarget.id
              ? {
                  ...a,
                  full_name: editForm.fullName,
                  mobile: editForm.mobile || null,
                  admin_access_level: editForm.accessLevel,
                  admin_operations_access: persistedOps,
                }
              : a,
          ),
        );
        setEditOpen(false);
      } else {
        toast.error(result.error || "Failed to update admin.");
      }
    });
  };

  // --- Toggle Active ---
  const handleToggleActive = (admin: AdminUser) => {
    startTransition(async () => {
      const result = await toggleAdminActive(admin.id, admin.is_active);
      if (result.success) {
        toast.success(
          admin.is_active ? "Admin deactivated." : "Admin activated.",
        );
        setAdmins((prev) =>
          prev.map((a) =>
            a.id === admin.id ? { ...a, is_active: !a.is_active } : a,
          ),
        );
      } else {
        toast.error(result.error || "Failed to update status.");
      }
    });
  };

  // --- Delete ---
  const openDelete = (admin: AdminUser) => {
    setDeleteTarget(admin);
    setDeleteConfirmEmail("");
    setDeleteOpen(true);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result = await deleteAdminUser(deleteTarget.id);
      if (result.success) {
        toast.success("Admin deleted successfully.");
        setAdmins((prev) => prev.filter((a) => a.id !== deleteTarget.id));
        setDeleteOpen(false);
      } else {
        toast.error(result.error || "Failed to delete admin.");
      }
    });
  };

  return (
    <>
      <DataTableCard
        header={
          <SectionHeader
            title={`Admin Users (${filtered.length})`}
            icon={UserCog}
            action={
              <Button
                size="sm"
                onClick={() => setCreateOpen(true)}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Add Admin
              </Button>
            }
          />
        }
        controls={
          <DataSearchFilter
            searchColumn={searchColumn}
            onColumnChange={setSearchColumn}
            searchTerm={searchTerm}
            onTermChange={setSearchTerm}
            options={SEARCH_OPTIONS}
          />
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>Access Level</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center py-10 text-muted-foreground"
                >
                  No admin users found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((admin) => (
                <TableRow key={admin.id} className="hover:bg-muted/30">
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-primary/60 shrink-0" />
                      {admin.full_name}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {admin.email}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {admin.mobile || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {(() => {
                      const cfg = resolveAccessConfiguration(
                        admin.admin_access_level,
                        admin.admin_operations_access,
                      );
                      if (cfg.level !== "operations") {
                        return ACCESS_LEVEL_LABELS[cfg.level];
                      }
                      const count = Object.keys(cfg.groups).length;
                      return `${ACCESS_LEVEL_LABELS[cfg.level]} · ${count} group${count === 1 ? "" : "s"}`;
                    })()}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={admin.is_active ? "ACTIVE" : "PAUSED"} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(admin.created_at).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="flex items-center gap-1.5">
                        <Switch
                          checked={admin.is_active}
                          onCheckedChange={() => handleToggleActive(admin)}
                          disabled={isPending}
                          className="scale-90"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => openEdit(admin)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => openDelete(admin)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DataTableCard>

      {/* Create Admin Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Admin</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="create-name">Full Name</Label>
              <Input
                id="create-name"
                placeholder="Full name"
                value={createForm.fullName}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, fullName: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-email">Email</Label>
              <Input
                id="create-email"
                type="email"
                placeholder="admin@example.com"
                value={createForm.email}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, email: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-mobile">Mobile (optional)</Label>
              <Input
                id="create-mobile"
                placeholder="+91 9XXXXXXXXX"
                value={createForm.mobile}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, mobile: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-password">Password</Label>
              <Input
                id="create-password"
                type="password"
                placeholder="Min. 8 characters"
                value={createForm.password}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, password: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-access-level">Access Level</Label>
              <Select
                value={createForm.accessLevel}
                onValueChange={(value) =>
                  setCreateForm((f) => ({
                    ...f,
                    accessLevel: value as AdminAccessLevel,
                    // Clear per-group config when leaving the operations level.
                    operationsAccess:
                      value === "operations" ? f.operationsAccess : {},
                  }))
                }
              >
                <SelectTrigger id="create-access-level">
                  <SelectValue placeholder="Select access level" />
                </SelectTrigger>
                <SelectContent>
                  {ADMIN_ACCESS_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {ACCESS_LEVEL_LABELS[level]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {createForm.accessLevel === "operations" && (
              <OperationsGroupConfig
                idPrefix="create-ops"
                value={createForm.operationsAccess}
                onChange={(next) =>
                  setCreateForm((f) => ({ ...f, operationsAccess: next }))
                }
              />
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              onClick={handleCreate}
              disabled={
                isPending ||
                !createForm.fullName ||
                !createForm.email ||
                createForm.password.length < 8 ||
                (createForm.accessLevel === "operations" &&
                  Object.keys(createForm.operationsAccess).length === 0)
              }
            >
              {isPending ? "Creating..." : "Create Admin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Admin Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Admin — {editTarget?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Full Name</Label>
              <Input
                id="edit-name"
                value={editForm.fullName}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, fullName: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-mobile">Mobile</Label>
              <Input
                id="edit-mobile"
                value={editForm.mobile}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, mobile: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-access-level">Access Level</Label>
              <Select
                value={editForm.accessLevel}
                onValueChange={(value) =>
                  setEditForm((f) => ({
                    ...f,
                    accessLevel: value as AdminAccessLevel,
                    operationsAccess:
                      value === "operations" ? f.operationsAccess : {},
                  }))
                }
              >
                <SelectTrigger id="edit-access-level">
                  <SelectValue placeholder="Select access level" />
                </SelectTrigger>
                <SelectContent>
                  {ADMIN_ACCESS_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {ACCESS_LEVEL_LABELS[level]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {editForm.accessLevel === "operations" && (
              <OperationsGroupConfig
                idPrefix="edit-ops"
                value={editForm.operationsAccess}
                onChange={(next) =>
                  setEditForm((f) => ({ ...f, operationsAccess: next }))
                }
              />
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              onClick={handleEdit}
              disabled={
                isPending ||
                !editForm.fullName ||
                (editForm.accessLevel === "operations" &&
                  Object.keys(editForm.operationsAccess).length === 0)
              }
            >
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete Admin Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              This action is <strong>permanent</strong> and cannot be undone.
              The admin will lose all access immediately.
            </p>
            <div className="rounded-md bg-destructive/5 border border-destructive/20 p-3 text-sm">
              <p className="font-medium text-foreground">{deleteTarget?.full_name}</p>
              <p className="text-muted-foreground">{deleteTarget?.email}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="delete-confirm">
                Type the email address to confirm
              </Label>
              <Input
                id="delete-confirm"
                placeholder={deleteTarget?.email}
                value={deleteConfirmEmail}
                onChange={(e) => setDeleteConfirmEmail(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={
                isPending || deleteConfirmEmail !== deleteTarget?.email
              }
            >
              {isPending ? "Deleting..." : "Delete Admin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
