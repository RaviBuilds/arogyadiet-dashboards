"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { Input } from "@/shared/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import {
  ArrowLeft,
  Edit2,
  Play,
  Pause,
  RotateCcw,
  Trash2,
  MapPin,
  Building2,
  Calendar,
  Hash,
  User,
  ChefHat,
} from "lucide-react";
import { toast } from "sonner";
import {
  updateFranchise,
  activateFranchise,
  suspendFranchise,
  reactivateFranchise,
  deleteFranchise,
} from "@/actions/admin-actions/franchiseActions";
import type { FranchiseWithPincodes, FranchiseStatus } from "@/types/franchise";

interface FranchiseDetailClientProps {
  franchise: FranchiseWithPincodes;
  ownerName?: string | null;
}

const STATUS_CONFIG: Record<FranchiseStatus, { bg: string; text: string; dot: string }> = {
  onboarding: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  active: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  suspended: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
};

export default function FranchiseDetailClient({
  franchise,
  ownerName,
}: FranchiseDetailClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editName, setEditName] = useState(franchise.name);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const statusStyle = STATUS_CONFIG[franchise.status];

  const handleUpdate = () => {
    if (!editName.trim()) { toast.error("Name is required"); return; }
    startTransition(async () => {
      const result = await updateFranchise(franchise.id, { name: editName.trim() });
      if (result.success) { toast.success("Franchise updated"); setIsEditOpen(false); router.refresh(); }
      else { toast.error(result.error); }
    });
  };

  const handleActivate = () => {
    startTransition(async () => {
      const result = await activateFranchise(franchise.id);
      if (result.success) { toast.success(`"${franchise.name}" is now active!`); router.refresh(); }
      else { toast.error(result.error); }
    });
  };

  const handleSuspend = () => {
    startTransition(async () => {
      const result = await suspendFranchise(franchise.id);
      if (result.success) { toast.success(`"${franchise.name}" suspended`); router.refresh(); }
      else { toast.error(result.error); }
    });
  };

  const handleReactivate = () => {
    startTransition(async () => {
      const result = await reactivateFranchise(franchise.id);
      if (result.success) { toast.success(`"${franchise.name}" reactivated`); router.refresh(); }
      else { toast.error(result.error); }
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteFranchise(franchise.id);
      if (result.success) { toast.success("Franchise deleted"); router.push("/franchises"); }
      else { toast.error(result.error); }
    });
  };

  return (
    <>
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/franchises">
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full border border-slate-200 hover:bg-slate-50">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                {franchise.name}
              </h1>
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${statusStyle.bg}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
                <span className={`text-xs font-semibold capitalize ${statusStyle.text}`}>
                  {franchise.status}
                </span>
              </div>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              Created {new Date(franchise.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 h-9">
                <Edit2 className="h-3.5 w-3.5" /> Edit
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Franchise</DialogTitle>
                <DialogDescription>Update franchise name.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancel</Button>
                  <Button onClick={handleUpdate} disabled={isPending}>
                    {isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {franchise.status === "onboarding" && (
            <Button size="sm" className="gap-1.5 h-9 bg-emerald-600 hover:bg-emerald-700 shadow-sm" onClick={handleActivate} disabled={isPending}>
              <Play className="h-3.5 w-3.5" /> Activate
            </Button>
          )}
          {franchise.status === "active" && (
            <Button variant="outline" size="sm" className="gap-1.5 h-9 text-red-600 border-red-200 hover:bg-red-50" onClick={handleSuspend} disabled={isPending}>
              <Pause className="h-3.5 w-3.5" /> Suspend
            </Button>
          )}
          {franchise.status === "suspended" && (
            <Button size="sm" className="gap-1.5 h-9 bg-emerald-600 hover:bg-emerald-700" onClick={handleReactivate} disabled={isPending}>
              <RotateCcw className="h-3.5 w-3.5" /> Reactivate
            </Button>
          )}
          {franchise.status === "onboarding" && (
            <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-9 text-red-600 border-red-200 hover:bg-red-50">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete Franchise</DialogTitle>
                  <DialogDescription>
                    Permanently delete &quot;{franchise.name}&quot; and all pincode assignments. Cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>Cancel</Button>
                  <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
                    {isPending ? "Deleting..." : "Delete"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* Franchise Details - 3 cols */}
        <div className="lg:col-span-3 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-5">
            <Building2 className="h-4 w-4 text-slate-400" />
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Franchise Details</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <DetailItem icon={Hash} label="Franchise ID" value={franchise.id.slice(0, 8) + "..."} mono />
            <DetailItem icon={Calendar} label="Status" value={franchise.status} badge statusStyle={statusStyle} />
            <DetailItem icon={ChefHat} label="Kitchen" value={franchise.kitchen_id ? "Configured" : "Not assigned"} warn={!franchise.kitchen_id} />
            <DetailItem icon={User} label="Owner" value={ownerName ?? "Not assigned"} warn={!ownerName} />
          </div>
        </div>

        {/* Pincodes - 2 cols */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <MapPin className="h-4 w-4 text-slate-400" />
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Service Pincodes</h3>
          </div>
          <p className="text-sm text-slate-600 mb-3">
            {franchise.pincodes.length} pincode{franchise.pincodes.length !== 1 ? "s" : ""} assigned
            {franchise.pincodes.length === 0 && franchise.status === "onboarding" && (
              <span className="text-amber-600 block text-xs mt-1">
                Admin must assign pincodes before activation.
              </span>
            )}
          </p>
          {franchise.pincodes.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {franchise.pincodes.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-mono font-medium text-emerald-700"
                >
                  {p.pincode}
                </span>
              ))}
            </div>
          ) : (
            <div className="rounded-lg bg-slate-50 border border-dashed border-slate-200 p-4 text-center">
              <MapPin className="h-5 w-5 text-slate-300 mx-auto mb-1" />
              <p className="text-xs text-slate-400">No pincodes yet</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function DetailItem({
  icon: Icon,
  label,
  value,
  mono,
  badge,
  statusStyle,
  warn,
}: {
  icon: any;
  label: string;
  value: string;
  mono?: boolean;
  badge?: boolean;
  statusStyle?: { bg: string; text: string; dot: string };
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg bg-slate-50/80 border border-slate-100 px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3 w-3 text-slate-400" />
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
      </div>
      {badge && statusStyle ? (
        <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full ${statusStyle.bg}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
          <span className={`text-xs font-semibold capitalize ${statusStyle.text}`}>{value}</span>
        </div>
      ) : (
        <p className={`text-sm font-semibold ${warn ? "text-amber-600" : "text-slate-800"} ${mono ? "font-mono text-xs" : ""}`}>
          {value}
        </p>
      )}
    </div>
  );
}
