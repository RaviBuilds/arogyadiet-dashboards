"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { Input } from "@/shared/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
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
}

const STATUS_COLORS: Record<FranchiseStatus, string> = {
  onboarding: "bg-amber-50 text-amber-700 border-amber-200",
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  suspended: "bg-red-50 text-red-700 border-red-200",
};

export default function FranchiseDetailClient({
  franchise,
}: FranchiseDetailClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editName, setEditName] = useState(franchise.name);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const handleUpdate = () => {
    if (!editName.trim()) {
      toast.error("Name is required");
      return;
    }
    startTransition(async () => {
      const result = await updateFranchise(franchise.id, { name: editName.trim() });
      if (result.success) {
        toast.success("Franchise updated");
        setIsEditOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleActivate = () => {
    startTransition(async () => {
      const result = await activateFranchise(franchise.id);
      if (result.success) {
        toast.success(`"${franchise.name}" is now active`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleSuspend = () => {
    startTransition(async () => {
      const result = await suspendFranchise(franchise.id);
      if (result.success) {
        toast.success(`"${franchise.name}" has been suspended`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleReactivate = () => {
    startTransition(async () => {
      const result = await reactivateFranchise(franchise.id);
      if (result.success) {
        toast.success(`"${franchise.name}" has been reactivated`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteFranchise(franchise.id);
      if (result.success) {
        toast.success("Franchise deleted");
        router.push("/franchises");
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <>
      {/* Back + Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/franchises">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">
                {franchise.name}
              </h1>
              <Badge
                variant="outline"
                className={STATUS_COLORS[franchise.status]}
              >
                {franchise.status}
              </Badge>
            </div>
            <p className="text-sm text-slate-500">
              Created {new Date(franchise.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Edit2 className="h-3.5 w-3.5" />
                Edit
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Franchise</DialogTitle>
                <DialogDescription>Update franchise details.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <label className="text-sm font-medium text-slate-700">Name</label>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsEditOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleUpdate} disabled={isPending}>
                    {isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {franchise.status === "onboarding" && (
            <Button
              size="sm"
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
              onClick={handleActivate}
              disabled={isPending}
            >
              <Play className="h-3.5 w-3.5" />
              Activate
            </Button>
          )}

          {franchise.status === "active" && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
              onClick={handleSuspend}
              disabled={isPending}
            >
              <Pause className="h-3.5 w-3.5" />
              Suspend
            </Button>
          )}

          {franchise.status === "suspended" && (
            <Button
              size="sm"
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
              onClick={handleReactivate}
              disabled={isPending}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reactivate
            </Button>
          )}

          {franchise.status === "onboarding" && (
            <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete Franchise</DialogTitle>
                  <DialogDescription>
                    This will permanently delete &quot;{franchise.name}&quot; and all its pincode
                    assignments. This cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleDelete}
                    disabled={isPending}
                  >
                    {isPending ? "Deleting..." : "Delete Franchise"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Franchise Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">ID</span>
              <span className="font-mono text-xs text-slate-600">
                {franchise.id.slice(0, 8)}...
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Status</span>
              <Badge variant="outline" className={STATUS_COLORS[franchise.status]}>
                {franchise.status}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Kitchen</span>
              <span className="text-slate-700">
                {franchise.kitchen_id ? franchise.kitchen_id.slice(0, 8) + "..." : "Not assigned"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Owner</span>
              <span className="text-slate-700">
                {franchise.owner_user_id ? franchise.owner_user_id.slice(0, 8) + "..." : "Not assigned"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Service Pincodes
            </CardTitle>
            <CardDescription>
              {franchise.pincodes.length} pincode{franchise.pincodes.length !== 1 ? "s" : ""} assigned.
              {franchise.pincodes.length === 0 && franchise.status === "onboarding" && (
                <span className="text-amber-600 ml-1">
                  Admin must assign pincodes before activation.
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {franchise.pincodes.length === 0 ? (
              <p className="text-sm text-slate-400">No pincodes assigned yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {franchise.pincodes.map((p) => (
                  <Badge key={p.id} variant="secondary" className="font-mono">
                    {p.pincode}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
