"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Filter } from "lucide-react";
import DisputeListTable from "./DisputeListTable";
import type { DisputeWithFranchiseName } from "@/types/dispute";

interface Props {
  disputes: DisputeWithFranchiseName[];
  franchises: { id: string; name: string }[];
}

export default function DisputesClient({ disputes, franchises }: Props) {
  const router = useRouter();
  const [selectedFranchise, setSelectedFranchise] = useState<string>("all");

  const filteredDisputes =
    selectedFranchise === "all"
      ? disputes
      : disputes.filter((d) => d.franchise_id === selectedFranchise);

  const openCount = disputes.filter((d) => d.status === "Open").length;
  const investigatingCount = disputes.filter((d) => d.status === "Under_Investigation").length;

  function handleStatusUpdateSuccess() {
    toast.success("Dispute status updated successfully!", { duration: 5000 });
    router.refresh();
  }

  function handleStatusUpdateError(message: string) {
    toast.error(message || "Failed to update dispute status.");
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Manage Disputes
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Review and resolve disputes from all franchises.
          </p>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            <select
              value={selectedFranchise}
              onChange={(e) => setSelectedFranchise(e.target.value)}
              className="bg-transparent text-sm font-medium text-slate-700 focus:outline-none cursor-pointer pr-2"
            >
              <option value="all">All Franchises</option>
              {franchises.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Status Summary Ribbon */}
      <div className="grid grid-cols-3 gap-4">
        <StatusPill label="Total" count={disputes.length} color="slate" />
        <StatusPill label="Open" count={openCount} color="blue" />
        <StatusPill label="Investigating" count={investigatingCount} color="amber" />
      </div>

      {/* Dispute List */}
      <DisputeListTable
        disputes={filteredDisputes}
        onSuccess={handleStatusUpdateSuccess}
        onError={handleStatusUpdateError}
      />
    </div>
  );
}

function StatusPill({ label, count, color }: { label: string; count: number; color: "slate" | "blue" | "amber" }) {
  const colors = {
    slate: "text-slate-800 bg-slate-50 border-slate-200",
    blue: "text-blue-700 bg-blue-50 border-blue-200",
    amber: "text-amber-700 bg-amber-50 border-amber-200",
  };

  return (
    <div className={`rounded-2xl border p-4 ${colors[color]} backdrop-blur-sm`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-2xl font-semibold tracking-tight mt-1 ${color === "slate" ? "text-slate-800" : color === "blue" ? "text-blue-700" : "text-amber-700"}`}>
        {count}
      </p>
    </div>
  );
}
