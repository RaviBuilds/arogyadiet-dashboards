"use client";

import { useState, useTransition } from "react";
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
import { Plus, Search, Building2, ChevronRight, TrendingUp, Clock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { createFranchise } from "@/actions/admin-actions/franchiseActions";
import type { Franchise, FranchiseStatus } from "@/types/franchise";

interface FranchiseListClientProps {
  franchises: Franchise[];
}

const STATUS_CONFIG: Record<FranchiseStatus, { bg: string; text: string; dot: string; icon: any }> = {
  onboarding: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500", icon: Clock },
  active: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", icon: TrendingUp },
  suspended: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500", icon: AlertTriangle },
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
    if (!newName.trim()) { toast.error("Franchise name is required"); return; }
    startTransition(async () => {
      const result = await createFranchise({ name: newName.trim() });
      if (result.success) {
        toast.success(`Franchise "${result.data.name}" created`);
        setNewName(""); setIsCreateOpen(false);
      } else { toast.error(result.error); }
    });
  };

  const totalActive = franchises.filter((f) => f.status === "active").length;
  const totalOnboarding = franchises.filter((f) => f.status === "onboarding").length;
  const totalSuspended = franchises.filter((f) => f.status === "suspended").length;

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search franchises..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-10 bg-white border-slate-200"
          />
        </div>

        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 h-10 px-5 bg-slate-900 hover:bg-slate-800 shadow-sm">
              <Plus className="h-4 w-4" />
              New Franchise
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Create New Franchise</DialogTitle>
              <DialogDescription>
                Start onboarding a new franchise location. You&apos;ll set up the admin, kitchen, and pincodes next.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Franchise Name</label>
                <Input
                  placeholder="e.g. ArogyaDiet Bangalore"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="mt-1.5 h-10"
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={isPending}>
                  {isPending ? "Creating..." : "Create Franchise"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <KPICard icon={Building2} label="TOTAL FRANCHISES" value={franchises.length} color="text-slate-800" bgIcon="bg-slate-100" />
        <KPICard icon={TrendingUp} label="ACTIVE" value={totalActive} color="text-emerald-700" bgIcon="bg-emerald-100" sub={totalActive > 0 ? "Operational" : undefined} />
        <KPICard icon={Clock} label="ONBOARDING" value={totalOnboarding} color="text-amber-700" bgIcon="bg-amber-100" sub={totalOnboarding > 0 ? "Setting up" : undefined} />
        <KPICard icon={AlertTriangle} label="SUSPENDED" value={totalSuspended} color="text-red-700" bgIcon="bg-red-100" sub={totalSuspended > 0 ? "Needs attention" : undefined} />
      </div>

      {/* Franchise List */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 py-16 text-center">
          <Building2 className="h-12 w-12 text-slate-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-500">
            {franchises.length === 0 ? "No franchises yet" : "No franchises match your search"}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {franchises.length === 0 && "Click \"New Franchise\" to start onboarding."}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-[1fr_120px_140px_80px] gap-4 px-6 py-3 bg-slate-50 border-b border-slate-100">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Name</span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Status</span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Created</span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right">Action</span>
          </div>

          {/* Rows */}
          {filtered.map((franchise, idx) => {
            const style = STATUS_CONFIG[franchise.status];
            return (
              <Link
                key={franchise.id}
                href={`/franchises/${franchise.id}`}
                className={`grid grid-cols-[1fr_120px_140px_80px] gap-4 px-6 py-4 items-center transition-colors hover:bg-slate-50/80 group ${
                  idx < filtered.length - 1 ? "border-b border-slate-100" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${style.bg}`}>
                    <Building2 className={`h-4 w-4 ${style.text}`} />
                  </div>
                  <span className="text-sm font-semibold text-slate-800 group-hover:text-slate-900">
                    {franchise.name}
                  </span>
                </div>

                <div>
                  <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${style.bg}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                    <span className={`text-[11px] font-semibold capitalize ${style.text}`}>
                      {franchise.status}
                    </span>
                  </div>
                </div>

                <span className="text-xs text-slate-500">
                  {new Date(franchise.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </span>

                <div className="flex justify-end">
                  <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KPICard({
  icon: Icon,
  label,
  value,
  color,
  bgIcon,
  sub,
}: {
  icon: any;
  label: string;
  value: number;
  color: string;
  bgIcon: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-sm">
      <div className="flex items-center gap-2.5 mb-2">
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${bgIcon}`}>
          <Icon className={`h-3.5 w-3.5 ${color}`} />
        </div>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}
