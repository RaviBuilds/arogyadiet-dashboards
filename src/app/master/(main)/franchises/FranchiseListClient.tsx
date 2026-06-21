"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { Input } from "@/shared/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { Plus, Search, Building2, Eye } from "lucide-react";
import { toast } from "sonner";
import { createFranchise } from "@/actions/admin-actions/franchiseActions";
import type { Franchise, FranchiseStatus } from "@/types/franchise";

interface FranchiseListClientProps {
  franchises: Franchise[];
}

const STATUS_COLORS: Record<FranchiseStatus, string> = {
  onboarding: "bg-amber-50 text-amber-700 border-amber-200",
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  suspended: "bg-red-50 text-red-700 border-red-200",
};

export default function FranchiseListClient({ franchises }: FranchiseListClientProps) {
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [isPending, startTransition] = useTransition();

  const filtered = franchises.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = () => {
    if (!newName.trim()) {
      toast.error("Franchise name is required");
      return;
    }

    startTransition(async () => {
      const result = await createFranchise({ name: newName.trim() });
      if (result.success) {
        toast.success(`Franchise "${result.data.name}" created`);
        setNewName("");
        setIsCreateOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search franchises..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              New Franchise
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Franchise</DialogTitle>
              <DialogDescription>
                Create a new franchise entry. It will start in &quot;onboarding&quot; status.
                Admin will assign pincodes separately.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <label className="text-sm font-medium text-slate-700">
                  Franchise Name
                </label>
                <Input
                  placeholder="e.g. ArogyaDiet Bangalore"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="mt-1"
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setIsCreateOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={isPending}>
                  {isPending ? "Creating..." : "Create Franchise"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Total"
          value={franchises.length}
          color="text-slate-700"
        />
        <StatCard
          label="Active"
          value={franchises.filter((f) => f.status === "active").length}
          color="text-emerald-700"
        />
        <StatCard
          label="Onboarding"
          value={franchises.filter((f) => f.status === "onboarding").length}
          color="text-amber-700"
        />
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Building2 className="h-12 w-12 text-slate-300 mb-3" />
          <p className="text-sm text-slate-500">
            {franchises.length === 0
              ? "No franchises yet. Create one to get started."
              : "No franchises match your search."}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((franchise) => (
                <TableRow key={franchise.id}>
                  <TableCell className="font-medium">{franchise.name}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={STATUS_COLORS[franchise.status]}
                    >
                      {franchise.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-500 text-sm">
                    {new Date(franchise.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/franchises/${franchise.id}`}>
                      <Button variant="ghost" size="sm" className="gap-1.5">
                        <Eye className="h-3.5 w-3.5" />
                        View
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
