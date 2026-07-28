"use client";

// src/app/master/(main)/hierarchy/_components/FranchiseUsersPanel.tsx
// Master Hierarchy — Franchise Users panel (dietitian-management — Task 11.3,
// Req 21.1, 21.2, 22.1, 22.2, 22.4, 22.5, 22.6).
//
// Client Component slotted into the HierarchyTree's per-franchise row,
// alongside AgreementDocsPanel/FranchiseStatusControls. Opens as a Dialog
// listing every `users` row for the selected Franchise
// (`listFranchiseUsers`), with two mutation entry points:
//   - "Create Franchise User" — a plain, non-Dietitian franchise user
//     (full name / email / mobile / password / Access_Level), delegating to
//     `createFranchiseUser` (Req 21.2, 21.3).
//   - the Franchise's Dietitian action — "Create Dietitian" when the
//     Franchise has no active Dietitian, or "Edit Dietitian" (routes into
//     the same Master_Portal Dietitian edit surface UserManagement.tsx
//     already provides) when one exists (Req 22.1, 22.5, 22.6). Disabled
//     with the pinned `Wire a clinic to this franchise first` message when
//     the Franchise (per the `hasClinic` prop, sourced from the already-
//     loaded HierarchyFranchiseNode.clinics) has no Clinic yet (Req 22.4).
//
// The Franchise's own Clinic is shown as READ-ONLY text in the Create
// Dietitian form (Req 22.2) — it is resolved server-side by
// `createFranchiseDietitian` itself, never captured from this form.

import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Stethoscope, Users } from "lucide-react";

import {
  listFranchiseUsers,
  createFranchiseUser,
  createFranchiseDietitian,
  FRANCHISE_USER_ACCESS_LEVELS,
  type FranchiseUserListItem,
} from "@/actions/master-actions/franchiseUserActions";
import { ACCESS_LEVEL_LABELS, type AdminAccessLevel } from "@/lib/auth/adminAccessCore";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Separator } from "@/shared/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

interface FranchiseUsersPanelProps {
  franchiseId: string;
  franchiseName: string;
  /** Whether this Franchise has at least one wired Clinic (Req 22.4). */
  hasClinic: boolean;
  trigger?: React.ReactNode;
}

const EMPTY_NEW_USER = {
  fullName: "",
  email: "",
  mobile: "",
  password: "",
  accessLevel: "inventory_operations" as AdminAccessLevel,
};

const EMPTY_NEW_DIETITIAN = {
  fullName: "",
  email: "",
  mobile: "",
  password: "",
};

export function FranchiseUsersPanel({
  franchiseId,
  franchiseName,
  hasClinic,
  trigger,
}: FranchiseUsersPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [users, setUsers] = useState<FranchiseUserListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUser, setNewUser] = useState(EMPTY_NEW_USER);
  const [isCreatingUser, startCreateUser] = useTransition();

  const [showCreateDietitian, setShowCreateDietitian] = useState(false);
  const [newDietitian, setNewDietitian] = useState(EMPTY_NEW_DIETITIAN);
  const [isCreatingDietitian, startCreateDietitian] = useTransition();

  /** Req 21.1 — every `users` row whose `franchise_id` equals this Franchise. */
  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const result = await listFranchiseUsers(franchiseId);
    if (result.success) {
      setUsers(result.data);
    } else {
      setLoadError(result.error);
      setUsers([]);
    }
    setIsLoading(false);
  }, [franchiseId]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      if (open) {
        setShowCreateUser(false);
        setShowCreateDietitian(false);
        setNewUser(EMPTY_NEW_USER);
        setNewDietitian(EMPTY_NEW_DIETITIAN);
        void loadUsers();
      }
    },
    [loadUsers],
  );

  // The Franchise's Dietitian, if it already has one active (Req 22.5, 22.6).
  const activeDietitian = users.find((u) => u.isDietitian && u.isActive) ?? null;

  const canSubmitNewUser =
    newUser.fullName.trim().length > 0 &&
    newUser.email.trim().length > 0 &&
    newUser.password.length >= 6;

  const handleCreateUser = () => {
    startCreateUser(async () => {
      const result = await createFranchiseUser({
        franchiseId,
        fullName: newUser.fullName,
        email: newUser.email,
        mobile: newUser.mobile || undefined,
        password: newUser.password,
        accessLevel: newUser.accessLevel,
      });
      if (result.success) {
        toast.success(`Franchise user "${newUser.fullName}" created.`);
        setShowCreateUser(false);
        setNewUser(EMPTY_NEW_USER);
        await loadUsers();
      } else {
        toast.error(result.error);
      }
    });
  };

  const canSubmitNewDietitian =
    newDietitian.fullName.trim().length > 0 &&
    newDietitian.email.trim().length > 0 &&
    /^\d{10}$/.test(newDietitian.mobile.trim()) &&
    newDietitian.password.length >= 6;

  const handleCreateDietitian = () => {
    startCreateDietitian(async () => {
      const result = await createFranchiseDietitian({
        franchiseId,
        fullName: newDietitian.fullName,
        email: newDietitian.email,
        mobile: newDietitian.mobile,
        password: newDietitian.password,
      });
      if (result.success) {
        toast.success(`Dietitian "${result.data.fullName}" created.`);
        setShowCreateDietitian(false);
        setNewDietitian(EMPTY_NEW_DIETITIAN);
        await loadUsers();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="h-8 gap-2 text-xs">
            <Users className="h-4 w-4" />
            Users
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Franchise Users — {franchiseName}</DialogTitle>
          <DialogDescription>
            Every user account tied to this franchise, plus the franchise&apos;s
            Dietitian.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* ── Users table (Req 21.1) ─────────────────────────────────────── */}
          <div className="max-h-[280px] overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-20 text-center">
                      <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : loadError ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-20 text-center text-sm text-destructive">
                      {loadError}
                    </TableCell>
                  </TableRow>
                ) : users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-20 text-center text-sm text-muted-foreground">
                      No users yet for this franchise.
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">{user.fullName}</span>
                          <span className="text-xs text-muted-foreground">{user.email}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="gap-1">
                          {user.isDietitian && <Stethoscope className="h-3 w-3" />}
                          {ACCESS_LEVEL_LABELS[user.accessLevel]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.isActive ? "default" : "secondary"}>
                          {user.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <Separator />

          {/* ── Dietitian action (Req 22.1, 22.4, 22.5, 22.6) ──────────────── */}
          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <Stethoscope className="h-4 w-4" />
                  Dietitian
                </p>
                <p className="text-xs text-muted-foreground">
                  {activeDietitian
                    ? `${activeDietitian.fullName} is the active dietitian for this franchise.`
                    : hasClinic
                      ? "This franchise has no active dietitian yet."
                      : "Wire a clinic to this franchise first"}
                </p>
              </div>
              {activeDietitian ? (
                <Button size="sm" variant="outline" disabled title="Edit from User Management → Dietitians">
                  Edit Dietitian
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant={showCreateDietitian ? "secondary" : "outline"}
                  disabled={!hasClinic}
                  onClick={() => setShowCreateDietitian((prev) => !prev)}
                >
                  {showCreateDietitian ? "Cancel" : "Create Dietitian"}
                </Button>
              )}
            </div>

            {showCreateDietitian && !activeDietitian && hasClinic && (
              <div className="mt-3 space-y-3">
                <Separator />
                <div className="space-y-1.5">
                  <Label>Franchise Clinic</Label>
                  {/* Req 22.2 — the Franchise's Clinic is read-only text; it is
                      resolved server-side by createFranchiseDietitian, never
                      captured from this form. */}
                  <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    Resolved automatically from the {franchiseName} wired clinic
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-dietitian-name">Full name</Label>
                  <Input
                    id="new-dietitian-name"
                    value={newDietitian.fullName}
                    onChange={(e) =>
                      setNewDietitian((p) => ({ ...p, fullName: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-dietitian-email">Email</Label>
                  <Input
                    id="new-dietitian-email"
                    type="email"
                    value={newDietitian.email}
                    onChange={(e) =>
                      setNewDietitian((p) => ({ ...p, email: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-dietitian-mobile">Mobile</Label>
                  <Input
                    id="new-dietitian-mobile"
                    placeholder="10-digit mobile number"
                    value={newDietitian.mobile}
                    onChange={(e) =>
                      setNewDietitian((p) => ({ ...p, mobile: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-dietitian-password">Password</Label>
                  <Input
                    id="new-dietitian-password"
                    type="password"
                    placeholder="At least 6 characters"
                    value={newDietitian.password}
                    onChange={(e) =>
                      setNewDietitian((p) => ({ ...p, password: e.target.value }))
                    }
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleCreateDietitian}
                  disabled={isCreatingDietitian || !canSubmitNewDietitian}
                >
                  {isCreatingDietitian ? "Creating..." : "Create dietitian"}
                </Button>
              </div>
            )}
          </div>

          <Separator />

          {/* ── Create Franchise User (Req 21.2, 21.3) ─────────────────────── */}
          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Create Franchise User</p>
              <Button
                type="button"
                size="sm"
                variant={showCreateUser ? "secondary" : "outline"}
                onClick={() => setShowCreateUser((prev) => !prev)}
              >
                {showCreateUser ? (
                  "Cancel"
                ) : (
                  <>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add user
                  </>
                )}
              </Button>
            </div>

            {showCreateUser && (
              <div className="mt-3 space-y-3">
                <Separator />
                <div className="space-y-1.5">
                  <Label htmlFor="new-fuser-name">Full name</Label>
                  <Input
                    id="new-fuser-name"
                    value={newUser.fullName}
                    onChange={(e) =>
                      setNewUser((p) => ({ ...p, fullName: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-fuser-email">Email</Label>
                  <Input
                    id="new-fuser-email"
                    type="email"
                    value={newUser.email}
                    onChange={(e) =>
                      setNewUser((p) => ({ ...p, email: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-fuser-mobile">Mobile (optional)</Label>
                  <Input
                    id="new-fuser-mobile"
                    value={newUser.mobile}
                    onChange={(e) =>
                      setNewUser((p) => ({ ...p, mobile: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-fuser-password">Password</Label>
                  <Input
                    id="new-fuser-password"
                    type="password"
                    placeholder="At least 6 characters"
                    value={newUser.password}
                    onChange={(e) =>
                      setNewUser((p) => ({ ...p, password: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-fuser-access">Access Level</Label>
                  <Select
                    value={newUser.accessLevel}
                    onValueChange={(value) =>
                      setNewUser((p) => ({ ...p, accessLevel: value as AdminAccessLevel }))
                    }
                  >
                    <SelectTrigger id="new-fuser-access">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FRANCHISE_USER_ACCESS_LEVELS.map((level) => (
                        <SelectItem key={level} value={level}>
                          {ACCESS_LEVEL_LABELS[level]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleCreateUser}
                  disabled={isCreatingUser || !canSubmitNewUser}
                >
                  {isCreatingUser ? "Creating..." : "Create user"}
                </Button>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default FranchiseUsersPanel;
