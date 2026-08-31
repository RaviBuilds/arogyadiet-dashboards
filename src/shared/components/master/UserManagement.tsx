"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  UserCog,
  Plus,
  Pencil,
  Trash2,
  ShieldCheck,
  Stethoscope,
  AlertTriangle,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  toggleAdminActive,
} from "@/actions/master-actions/adminActions";
import {
  listDietitians,
  listClinicsForDietitianAssignment,
  createDietitian,
  updateDietitian,
  toggleDietitianActive,
} from "@/actions/master-actions/dietitianActions";
import type { ClinicWithFranchiseName } from "@/repositories/dietitian/dietitianRepository";
import type { DietitianAccount } from "@/types/dietitian";
import { DataTableCard } from "@/shared/components/admin/core/DataTableCard";
import { DataSearchFilter } from "@/shared/components/admin/core/DataSearchFilter";
import { SectionHeader } from "@/shared/components/admin/core/SectionHeader";
import { StatusBadge } from "@/shared/components/admin/core/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
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
  DIETITIAN_ACCESS_LEVEL,
  OPERATIONS_GROUPS,
  CLINIC_SCOPED_GROUPS,
  resolveAccessLevel,
  resolveAccessConfiguration,
  type AdminAccessLevel,
  type OperationsAccess,
} from "@/lib/auth/adminAccessCore";
import { OperationsGroupConfig } from "@/shared/components/master/OperationsGroupConfig";

/** Access Level options offered by the Edit Admin dialog — `dietitian` is
 * excluded here because promoting an existing plain Admin into a Dietitian
 * through this generic edit path would bypass every Dietitian-specific
 * invariant (Clinic/franchise derivation, franchise cardinality). A Dietitian
 * is always created and edited through its own dedicated flow below. */
const EDIT_ADMIN_ACCESS_LEVELS = ADMIN_ACCESS_LEVELS.filter(
  (level) => level !== DIETITIAN_ACCESS_LEVEL,
);

/** Sentinel for the Assign Clinic dropdown's "no clinic" option — Radix
 * `Select.Item` forbids an empty-string `value`, and a Dietitian's
 * Dietitian_Clinic_Link is legitimately empty (Req 3.4). */
const UNASSIGNED_CLINIC = "__unassigned__";

function clinicOptionLabel(clinic: ClinicWithFranchiseName): string {
  return clinic.franchiseName ? `${clinic.name} (${clinic.franchiseName})` : clinic.name;
}

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
  admin_clinic_id: string | null;
}

interface UserManagementProps {
  initialAdmins: AdminUser[];
}

// `OperationsGroupConfig` now lives in its own module so the Franchise Users
// panel can reuse the identical control (franchise-scoped-access Task 8). It is
// imported at the top of this file; behaviour here is unchanged, including the
// Clinic_Scoped_Admin call that passes `groups={CLINIC_SCOPED_GROUPS}`
// (Req 13.7, 13.8).

const SEARCH_OPTIONS = [
  { value: "full_name", label: "Name" },
  { value: "email", label: "Email" },
  { value: "mobile", label: "Mobile" },
];

export default function UserManagement({ initialAdmins }: UserManagementProps) {
  // Req 3.2 — Dietitian accounts are excluded from the Admin Users section
  // even though `getAdminUsers()` filters by role `ADMIN` only (a
  // Core_Business Dietitian also carries role `ADMIN`); the exclusion is
  // therefore applied here, on the resolved Access_Level.
  const [admins, setAdmins] = useState<AdminUser[]>(
    initialAdmins.filter(
      (a) => resolveAccessLevel(a.admin_access_level) !== DIETITIAN_ACCESS_LEVEL,
    ),
  );
  const [searchColumn, setSearchColumn] = useState("full_name");
  const [searchTerm, setSearchTerm] = useState("");

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [createForm, setCreateForm] = useState({
    fullName: "",
    email: "",
    mobile: "",
    password: "",
    accessLevel: "inventory_operations" as AdminAccessLevel,
    operationsAccess: {} as OperationsAccess,
    // Reused for BOTH the Dietitian Assign-Clinic dropdown and the Clinic
    // Access dropdown (Req 13.4) — accessLevel === DIETITIAN_ACCESS_LEVEL and
    // accessLevel === "operations" are mutually exclusive, so a form is
    // always driving exactly one of the two clinic dropdowns at a time.
    clinicId: UNASSIGNED_CLINIC,
    // Req 13.2 — the Clinic_Access_Checkbox state, meaningful only while
    // accessLevel === "operations".
    clinicAccess: false,
  });

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState({
    fullName: "",
    mobile: "",
    accessLevel: "inventory_operations" as AdminAccessLevel,
    operationsAccess: {} as OperationsAccess,
    // Req 13.17 — prefilled by openEdit() from admin.admin_clinic_id.
    clinicAccess: false,
    clinicId: UNASSIGNED_CLINIC,
  });

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState("");

  const [isPending, startTransition] = useTransition();

  // ─── Dietitians section (Req 3.1, 3.2, 3.3, 3.4) ────────────────────────────
  const [dietitians, setDietitians] = useState<DietitianAccount[]>([]);
  const [clinics, setClinics] = useState<ClinicWithFranchiseName[]>([]);
  const [dietitiansLoading, setDietitiansLoading] = useState(true);
  // Req 13.6 — tracked separately from `dietitiansLoading`/`clinics` (which
  // silently falls back to an empty list on failure) so the Clinic Access
  // dropdown can distinguish "load failed" from "genuinely no clinics" (Req
  // 13.5). Both dropdowns share the one underlying `clinics` fetch.
  const [clinicsLoadFailed, setClinicsLoadFailed] = useState(false);
  const [dietitianSearchTerm, setDietitianSearchTerm] = useState("");

  const [editDietitianOpen, setEditDietitianOpen] = useState(false);
  const [editDietitianTarget, setEditDietitianTarget] =
    useState<DietitianAccount | null>(null);
  const [editDietitianForm, setEditDietitianForm] = useState({
    fullName: "",
    mobile: "",
    clinicId: UNASSIGNED_CLINIC,
  });

  const [isDietitianPending, startDietitianTransition] = useTransition();

  const loadDietitianData = async () => {
    setDietitiansLoading(true);
    const [dietitiansResult, clinicsResult] = await Promise.all([
      listDietitians(),
      listClinicsForDietitianAssignment(),
    ]);
    setDietitiansLoading(false);
    if (dietitiansResult.success) setDietitians(dietitiansResult.data);
    else toast.error(dietitiansResult.error);
    if (clinicsResult.success) {
      setClinics(clinicsResult.data);
      setClinicsLoadFailed(false);
    } else {
      setClinicsLoadFailed(true);
      toast.error(clinicsResult.error);
    }
  };

  // Req 13.4 — the Clinic Access dropdown offers Core_Clinics only, unlike the
  // Dietitian Assign Clinic dropdown which lists every clinic (including
  // franchise-owned ones). `listClinicsForDietitianAssignment` already
  // returns `franchiseId` on every row, so filtering it client-side avoids a
  // new server action / repository function for this narrower listing.
  const coreClinicsForAssignment = clinics.filter((c) => c.franchiseId === null);

  useEffect(() => {
    // `loadDietitianData` sets `dietitiansLoading`/`dietitians`/`clinics` from
    // the Server Actions on mount — mirrors `NetworkReportSection.tsx`'s
    // load-on-mount effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDietitianData();
  }, []);

  const filteredDietitians = dietitians.filter((d) => {
    if (!dietitianSearchTerm) return true;
    const term = dietitianSearchTerm.toLowerCase();
    return (
      d.fullName.toLowerCase().includes(term) ||
      d.email.toLowerCase().includes(term) ||
      d.mobile.toLowerCase().includes(term)
    );
  });

  /** Req 4.5 — Dietitians whose Dietitian_Clinic_Link is empty. */
  const unassignedClinicDietitians = dietitians.filter((d) => d.clinicId === null);

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
    // Req 2.2 — Dietitian creation captures Mobile + Assign Clinic and is
    // delegated to `DietitianAccountService.createDietitian`, not the generic
    // admin-creation path.
    if (createForm.accessLevel === DIETITIAN_ACCESS_LEVEL) {
      startDietitianTransition(async () => {
        const result = await createDietitian({
          fullName: createForm.fullName,
          email: createForm.email,
          mobile: createForm.mobile,
          password: createForm.password,
          clinicId:
            createForm.clinicId === UNASSIGNED_CLINIC ? null : createForm.clinicId,
        });
        if (result.success) {
          toast.success("Dietitian created successfully.");
          setCreateOpen(false);
          setCreateForm({
            fullName: "",
            email: "",
            mobile: "",
            password: "",
            accessLevel: "inventory_operations",
            operationsAccess: {},
            clinicId: UNASSIGNED_CLINIC,
            clinicAccess: false,
          });
          setDietitians((prev) => [result.data, ...prev]);
        } else {
          toast.error(result.error || "Failed to create dietitian.");
        }
      });
      return;
    }

    startTransition(async () => {
      const result = await createAdminUser({
        ...createForm,
        clinicAccess: createForm.accessLevel === "operations" && createForm.clinicAccess,
        clinicId:
          createForm.clinicId === UNASSIGNED_CLINIC ? null : createForm.clinicId,
      });
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
          clinicId: UNASSIGNED_CLINIC,
          clinicAccess: false,
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
      // Req 13.17 — checkbox checked and dropdown set to the stored
      // Clinic_Scope_Assignment whenever one exists.
      clinicAccess: admin.admin_clinic_id !== null,
      clinicId: admin.admin_clinic_id ?? UNASSIGNED_CLINIC,
    });
    setEditOpen(true);
  };

  const handleEdit = () => {
    if (!editTarget) return;
    startTransition(async () => {
      const result = await updateAdminUser(editTarget.id, {
        ...editForm,
        clinicAccess: editForm.accessLevel === "operations" && editForm.clinicAccess,
        clinicId:
          editForm.clinicId === UNASSIGNED_CLINIC ? null : editForm.clinicId,
      });
      if (result.success) {
        toast.success("Admin updated successfully.");
        const persistedOps =
          editForm.accessLevel === "operations" ? editForm.operationsAccess : null;
        const persistedClinicId =
          editForm.accessLevel === "operations" &&
          editForm.clinicAccess &&
          editForm.clinicId !== UNASSIGNED_CLINIC
            ? editForm.clinicId
            : null;
        setAdmins((prev) =>
          prev.map((a) =>
            a.id === editTarget.id
              ? {
                  ...a,
                  full_name: editForm.fullName,
                  mobile: editForm.mobile || null,
                  admin_access_level: editForm.accessLevel,
                  admin_operations_access: persistedOps,
                  admin_clinic_id: persistedClinicId,
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

  // ─── Dietitian edit / toggle-active (Req 3.5, 3.6, 3.9) ────────────────────
  const openEditDietitian = (dietitian: DietitianAccount) => {
    setEditDietitianTarget(dietitian);
    setEditDietitianForm({
      fullName: dietitian.fullName,
      mobile: dietitian.mobile,
      clinicId: dietitian.clinicId ?? UNASSIGNED_CLINIC,
    });
    setEditDietitianOpen(true);
  };

  const handleEditDietitian = () => {
    if (!editDietitianTarget) return;
    startDietitianTransition(async () => {
      const result = await updateDietitian(editDietitianTarget.id, {
        fullName: editDietitianForm.fullName,
        mobile: editDietitianForm.mobile,
        clinicId:
          editDietitianForm.clinicId === UNASSIGNED_CLINIC
            ? null
            : editDietitianForm.clinicId,
      });
      if (result.success) {
        toast.success("Dietitian updated successfully.");
        setDietitians((prev) =>
          prev.map((d) => (d.id === editDietitianTarget.id ? result.data : d)),
        );
        setEditDietitianOpen(false);
      } else {
        toast.error(result.error || "Failed to update dietitian.");
      }
    });
  };

  const handleToggleDietitianActive = (dietitian: DietitianAccount) => {
    startDietitianTransition(async () => {
      const result = await toggleDietitianActive(dietitian.id, !dietitian.isActive);
      if (result.success) {
        toast.success(dietitian.isActive ? "Dietitian deactivated." : "Dietitian activated.");
        setDietitians((prev) =>
          prev.map((d) => (d.id === dietitian.id ? result.data : d)),
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
      {/* Req 4.5 — warning banner naming every Dietitian with an empty
          Dietitian_Clinic_Link, shown while at least one such Dietitian exists. */}
      {!dietitiansLoading && unassignedClinicDietitians.length > 0 && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Dietitians without an assigned clinic</AlertTitle>
          <AlertDescription>
            {unassignedClinicDietitians.map((d) => d.fullName).join(", ")}{" "}
            {unassignedClinicDietitians.length === 1 ? "has" : "have"} no clinic
            assigned. Assign a clinic so their customer scope resolves correctly.
          </AlertDescription>
        </Alert>
      )}

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

      {/* Dietitians section — separate from Admin Users (Req 3.1, 3.2, 3.3, 3.4). */}
      <div className="mt-6">
        <DataTableCard
          header={
            <SectionHeader
              title={`Dietitians (${filteredDietitians.length})`}
              icon={Stethoscope}
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setCreateForm((f) => ({ ...f, accessLevel: DIETITIAN_ACCESS_LEVEL }));
                    setCreateOpen(true);
                  }}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Dietitian
                </Button>
              }
            />
          }
          controls={
            <Input
              placeholder="Search name, email or mobile..."
              value={dietitianSearchTerm}
              onChange={(e) => setDietitianSearchTerm(e.target.value)}
              className="max-w-xs"
            />
          }
        >
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Clinic</TableHead>
                <TableHead>Franchise</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dietitiansLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                    Loading dietitians...
                  </TableCell>
                </TableRow>
              ) : filteredDietitians.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                    No dietitians found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredDietitians.map((dietitian) => (
                  <TableRow key={dietitian.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Stethoscope className="h-4 w-4 text-primary/60 shrink-0" />
                        {dietitian.fullName}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {dietitian.email}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {dietitian.mobile}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {/* Req 3.4 — an empty Dietitian_Clinic_Link renders as "Unassigned". */}
                      {dietitian.clinicName ?? "Unassigned"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {dietitian.franchiseName ?? "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={dietitian.isActive ? "ACTIVE" : "PAUSED"} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(dietitian.createdAt).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Switch
                          checked={dietitian.isActive}
                          onCheckedChange={() => handleToggleDietitianActive(dietitian)}
                          disabled={isDietitianPending}
                          className="scale-90"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => openEditDietitian(dietitian)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </DataTableCard>
      </div>

      {/* Edit Dietitian Dialog — Clinic is always editable (Req 3.5). */}
      <Dialog open={editDietitianOpen} onOpenChange={setEditDietitianOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Dietitian — {editDietitianTarget?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-dietitian-name">Full Name</Label>
              <Input
                id="edit-dietitian-name"
                value={editDietitianForm.fullName}
                onChange={(e) =>
                  setEditDietitianForm((f) => ({ ...f, fullName: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-dietitian-mobile">Mobile</Label>
              <Input
                id="edit-dietitian-mobile"
                value={editDietitianForm.mobile}
                onChange={(e) =>
                  setEditDietitianForm((f) => ({ ...f, mobile: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-dietitian-clinic">Assigned Clinic</Label>
              <Select
                value={editDietitianForm.clinicId}
                onValueChange={(value) =>
                  setEditDietitianForm((f) => ({ ...f, clinicId: value }))
                }
              >
                <SelectTrigger id="edit-dietitian-clinic">
                  <SelectValue placeholder="Select a clinic" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED_CLINIC}>Unassigned</SelectItem>
                  {clinics.map((clinic) => (
                    <SelectItem key={clinic.id} value={clinic.id}>
                      {clinicOptionLabel(clinic)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isDietitianPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              onClick={handleEditDietitian}
              disabled={isDietitianPending || !editDietitianForm.fullName}
            >
              {isDietitianPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              <Label htmlFor="create-mobile">
                Mobile{createForm.accessLevel === DIETITIAN_ACCESS_LEVEL ? "" : " (optional)"}
              </Label>
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
              <div className="relative">
                <Input
                  id="create-password"
                  type={showCreatePassword ? "text" : "password"}
                  placeholder="Min. 8 characters"
                  value={createForm.password}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, password: e.target.value }))
                  }
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowCreatePassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                  aria-label={showCreatePassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showCreatePassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
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
                    // Req 13.3 — the Clinic Access checkbox (and its clinic
                    // selection) is not presented outside `operations`.
                    clinicAccess: value === "operations" && f.clinicAccess,
                    clinicId:
                      value === "operations" ? f.clinicId : UNASSIGNED_CLINIC,
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
            {/* Req 13.2, 13.3 — Clinic Access checkbox shown only for `operations`. */}
            {createForm.accessLevel === "operations" && (
              <div className="space-y-1.5">
                <label
                  htmlFor="create-clinic-access"
                  className="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    id="create-clinic-access"
                    checked={createForm.clinicAccess}
                    onCheckedChange={(c) =>
                      setCreateForm((f) => ({
                        ...f,
                        clinicAccess: c === true,
                        // Req 13.16 (client mirror) — unchecking clears the
                        // selected clinic back to unassigned.
                        clinicId: c === true ? f.clinicId : UNASSIGNED_CLINIC,
                        // Req 13.13 — operations/franchises are unavailable
                        // once clinic access is checked.
                        operationsAccess:
                          c === true
                            ? Object.fromEntries(
                                Object.entries(f.operationsAccess).filter(
                                  ([g]) => g !== "operations" && g !== "franchises",
                                ),
                              )
                            : f.operationsAccess,
                      }))
                    }
                  />
                  This user has clinic level access
                </label>
                {createForm.clinicAccess && (
                  <div className="space-y-1.5 pl-1">
                    <Label htmlFor="create-clinic-scope">Clinic</Label>
                    {clinicsLoadFailed ? (
                      <p className="text-sm text-destructive">
                        The clinic list could not be loaded.
                      </p>
                    ) : !dietitiansLoading && coreClinicsForAssignment.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No clinics are available for assignment.
                      </p>
                    ) : (
                      <Select
                        value={createForm.clinicId}
                        onValueChange={(value) =>
                          setCreateForm((f) => ({ ...f, clinicId: value }))
                        }
                      >
                        <SelectTrigger id="create-clinic-scope">
                          <SelectValue placeholder="Select a clinic" />
                        </SelectTrigger>
                        <SelectContent>
                          {coreClinicsForAssignment.map((clinic) => (
                            <SelectItem key={clinic.id} value={clinic.id}>
                              {clinic.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
              </div>
            )}
            {createForm.accessLevel === "operations" && (
              <OperationsGroupConfig
                idPrefix="create-ops"
                value={createForm.operationsAccess}
                onChange={(next) =>
                  setCreateForm((f) => ({ ...f, operationsAccess: next }))
                }
                groups={
                  createForm.clinicAccess ? CLINIC_SCOPED_GROUPS : OPERATIONS_GROUPS
                }
              />
            )}
            {/* Req 2.2 — Assign Clinic dropdown shown only for Dietitian. */}
            {createForm.accessLevel === DIETITIAN_ACCESS_LEVEL && (
              <div className="space-y-1.5">
                <Label htmlFor="create-dietitian-clinic">Assign Clinic</Label>
                <Select
                  value={createForm.clinicId}
                  onValueChange={(value) =>
                    setCreateForm((f) => ({ ...f, clinicId: value }))
                  }
                >
                  <SelectTrigger id="create-dietitian-clinic">
                    <SelectValue placeholder="Select a clinic" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED_CLINIC}>Unassigned</SelectItem>
                    {clinics.map((clinic) => (
                      <SelectItem key={clinic.id} value={clinic.id}>
                        {clinicOptionLabel(clinic)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isPending || isDietitianPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              onClick={handleCreate}
              disabled={
                isPending ||
                isDietitianPending ||
                !createForm.fullName ||
                !createForm.email ||
                createForm.password.length < 8 ||
                (createForm.accessLevel === "operations" &&
                  Object.keys(createForm.operationsAccess).length === 0)
              }
            >
              {isPending || isDietitianPending
                ? "Creating..."
                : createForm.accessLevel === DIETITIAN_ACCESS_LEVEL
                  ? "Create Dietitian"
                  : "Create Admin"}
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
                    // Req 13.3 — the Clinic Access checkbox (and its clinic
                    // selection) is not presented outside `operations`.
                    clinicAccess: value === "operations" && f.clinicAccess,
                    clinicId:
                      value === "operations" ? f.clinicId : UNASSIGNED_CLINIC,
                  }))
                }
              >
                <SelectTrigger id="edit-access-level">
                  <SelectValue placeholder="Select access level" />
                </SelectTrigger>
                <SelectContent>
                  {EDIT_ADMIN_ACCESS_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {ACCESS_LEVEL_LABELS[level]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Req 13.2, 13.3 — Clinic Access checkbox shown only for `operations`. */}
            {editForm.accessLevel === "operations" && (
              <div className="space-y-1.5">
                <label
                  htmlFor="edit-clinic-access"
                  className="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    id="edit-clinic-access"
                    checked={editForm.clinicAccess}
                    onCheckedChange={(c) =>
                      setEditForm((f) => ({
                        ...f,
                        clinicAccess: c === true,
                        // Req 13.16 (client mirror) — unchecking clears the
                        // selected clinic back to unassigned.
                        clinicId: c === true ? f.clinicId : UNASSIGNED_CLINIC,
                        // Req 13.13 — operations/franchises are unavailable
                        // once clinic access is checked.
                        operationsAccess:
                          c === true
                            ? Object.fromEntries(
                                Object.entries(f.operationsAccess).filter(
                                  ([g]) => g !== "operations" && g !== "franchises",
                                ),
                              )
                            : f.operationsAccess,
                      }))
                    }
                  />
                  This user has clinic level access
                </label>
                {editForm.clinicAccess && (
                  <div className="space-y-1.5 pl-1">
                    <Label htmlFor="edit-clinic-scope">Clinic</Label>
                    {clinicsLoadFailed ? (
                      <p className="text-sm text-destructive">
                        The clinic list could not be loaded.
                      </p>
                    ) : !dietitiansLoading && coreClinicsForAssignment.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No clinics are available for assignment.
                      </p>
                    ) : (
                      <Select
                        value={editForm.clinicId}
                        onValueChange={(value) =>
                          setEditForm((f) => ({ ...f, clinicId: value }))
                        }
                      >
                        <SelectTrigger id="edit-clinic-scope">
                          <SelectValue placeholder="Select a clinic" />
                        </SelectTrigger>
                        <SelectContent>
                          {coreClinicsForAssignment.map((clinic) => (
                            <SelectItem key={clinic.id} value={clinic.id}>
                              {clinic.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
              </div>
            )}
            {editForm.accessLevel === "operations" && (
              <OperationsGroupConfig
                idPrefix="edit-ops"
                value={editForm.operationsAccess}
                onChange={(next) =>
                  setEditForm((f) => ({ ...f, operationsAccess: next }))
                }
                groups={
                  editForm.clinicAccess ? CLINIC_SCOPED_GROUPS : OPERATIONS_GROUPS
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
