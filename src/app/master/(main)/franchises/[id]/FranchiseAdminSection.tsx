"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Badge } from "@/shared/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { UserPlus, User, Loader2, Pencil, Trash2, CheckCircle2, Mail, Phone } from "lucide-react";
import { toast } from "sonner";
import {
  createFranchiseAdminUser,
  getFranchiseAdminUsers,
  removeFranchiseAdmin,
  updateFranchiseAdmin,
} from "@/actions/admin-actions/franchiseUserActions";

interface FranchiseAdminSectionProps {
  franchiseId: string;
  franchiseName: string;
}

interface AdminUser {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
}

export default function FranchiseAdminSection({
  franchiseId,
  franchiseName,
}: FranchiseAdminSectionProps) {
  const router = useRouter();
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");

  const [editName, setEditName] = useState("");
  const [editMobile, setEditMobile] = useState("");

  useEffect(() => {
    async function load() {
      const result = await getFranchiseAdminUsers(franchiseId);
      if (result.success && result.users.length > 0) {
        setAdminUser(result.users[0]);
      }
      setLoading(false);
    }
    load();
  }, [franchiseId]);

  useEffect(() => {
    if (adminUser) {
      setEditName(adminUser.full_name);
    }
  }, [adminUser]);

  const handleCreate = () => {
    if (!fullName.trim() || !email.trim() || !password.trim()) { toast.error("Name, email, and password are required"); return; }
    if (password.length < 6) { toast.error("Password must be at least 6 characters"); return; }

    startTransition(async () => {
      const result = await createFranchiseAdminUser({ franchiseId, fullName: fullName.trim(), email: email.trim(), mobile: mobile.trim() || undefined, password });
      if (result.success) {
        toast.success(`Admin "${fullName}" created. They must set a new password on first login.`);
        setFullName(""); setEmail(""); setMobile(""); setPassword(""); setIsCreateOpen(false);
        const refreshed = await getFranchiseAdminUsers(franchiseId);
        if (refreshed.success && refreshed.users.length > 0) setAdminUser(refreshed.users[0]);
        router.refresh();
      } else { toast.error(result.error); }
    });
  };

  const handleEdit = () => {
    if (!editName.trim()) { toast.error("Name is required"); return; }
    startTransition(async () => {
      const result = await updateFranchiseAdmin(adminUser!.id, { fullName: editName.trim(), mobile: editMobile.trim() || null });
      if (result.success) { toast.success("Admin details updated"); setIsEditOpen(false); router.refresh(); }
      else { toast.error(result.error); }
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await removeFranchiseAdmin(adminUser!.id, franchiseId);
      if (result.success) { toast.success("Admin removed"); setIsDeleteOpen(false); setAdminUser(null); router.refresh(); }
      else { toast.error(result.error); }
    });
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-100 bg-gradient-to-r from-blue-50/80 to-indigo-50/60 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
              <User className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Franchise Admin</h3>
              <p className="text-[11px] text-slate-500">
                {adminUser ? "Portal login account" : "Create login credentials"}
              </p>
            </div>
          </div>
          {adminUser && (
            <div className="flex items-center gap-1.5 text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span className="text-[11px] font-medium">Assigned</span>
            </div>
          )}
          {!adminUser && (
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5 h-8 bg-blue-600 hover:bg-blue-700 shadow-sm">
                  <UserPlus className="h-3.5 w-3.5" /> Create Admin
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[440px]">
                <DialogHeader>
                  <DialogTitle>Create Franchise Admin</DialogTitle>
                  <DialogDescription>
                    Login credentials for &quot;{franchiseName}&quot;. Password change required on first login.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3.5 pt-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Full Name *</label>
                    <Input placeholder="e.g. Rajesh Kumar" value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1 h-10" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Email *</label>
                    <Input type="email" placeholder="e.g. franchise@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 h-10" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Mobile</label>
                    <Input placeholder="e.g. 9876543210" value={mobile} onChange={(e) => setMobile(e.target.value)} className="mt-1 h-10" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Temporary Password *</label>
                    <Input type="text" placeholder="e.g. Welcome@123" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 h-10" />
                    <p className="text-[10px] text-slate-400 mt-1">Forced change on first login</p>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                    <Button onClick={handleCreate} disabled={isPending}>{isPending ? "Creating..." : "Create Account"}</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {adminUser ? (
          <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200/80 px-5 py-4">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold text-sm">
                {adminUser.full_name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">{adminUser.full_name}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <Mail className="h-3 w-3" /> {adminUser.email}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-semibold">
                Active
              </Badge>
              <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-slate-200/80">
                    <Pencil className="h-3.5 w-3.5 text-slate-500" />
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Edit Admin</DialogTitle>
                    <DialogDescription>Update name or mobile. Email cannot be changed.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3.5 pt-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-600">Full Name</label>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-1 h-10" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-600">Email</label>
                      <Input value={adminUser.email} disabled className="mt-1 h-10 bg-slate-50 text-slate-400" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-600">Mobile</label>
                      <Input value={editMobile} onChange={(e) => setEditMobile(e.target.value)} placeholder="9876543210" className="mt-1 h-10" />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancel</Button>
                      <Button onClick={handleEdit} disabled={isPending}>{isPending ? "Saving..." : "Save"}</Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-red-50">
                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Remove Admin</DialogTitle>
                    <DialogDescription>
                      Deactivate &quot;{adminUser.full_name}&quot; and remove from this franchise. They won&apos;t be able to log in.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex justify-end gap-2 pt-4">
                    <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>Cancel</Button>
                    <Button variant="destructive" onClick={handleDelete} disabled={isPending}>{isPending ? "Removing..." : "Remove Admin"}</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
            <User className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500 font-medium">No admin assigned</p>
            <p className="text-xs text-slate-400 mt-0.5">Create credentials for the franchise owner to access their portal.</p>
          </div>
        )}
      </div>
    </div>
  );
}
