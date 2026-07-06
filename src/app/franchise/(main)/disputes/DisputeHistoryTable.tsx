"use client";

import { ClipboardList } from "lucide-react";
import type { Dispute } from "@/types/dispute";
import type { DisputeStatus } from "@/validations/disputeSchema";
import { Badge } from "@/shared/components/ui/badge";
import { SectionCard } from "@/shared/components/franchise/ui/GlassCard";

interface Props {
  disputes: Dispute[];
}

const STATUS_STYLES: Record<DisputeStatus, string> = {
  Open: "bg-blue-50 text-blue-700 border-blue-200",
  Under_Investigation: "bg-amber-50 text-amber-700 border-amber-200",
  Solved: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const STATUS_LABELS: Record<DisputeStatus, string> = {
  Open: "Open",
  Under_Investigation: "Under Investigation",
  Solved: "Solved",
};

export default function DisputeHistoryTable({ disputes }: Props) {
  return (
    <SectionCard
      icon={ClipboardList}
      title="Dispute History"
      subtitle={`${disputes.length} dispute${disputes.length !== 1 ? "s" : ""} raised`}
    >
      {disputes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100/80 mb-4">
            <ClipboardList className="h-6 w-6 text-slate-400" />
          </div>
          <p className="text-sm font-medium text-slate-500">No disputes have been raised yet.</p>
          <p className="text-xs text-slate-400 mt-1">When you raise a dispute, it will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {disputes.map((dispute) => (
            <div
              key={dispute.id}
              className="flex flex-col gap-2 rounded-xl bg-white/60 px-4 py-3.5 ring-1 ring-inset ring-slate-100 transition-colors hover:bg-slate-50/60 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    {dispute.category.replace(/_/g, " ")}
                  </span>
                  <Badge
                    variant="outline"
                    className={`rounded-lg text-[10px] ${STATUS_STYLES[dispute.status]}`}
                  >
                    {STATUS_LABELS[dispute.status]}
                  </Badge>
                </div>
                <p className="text-sm text-slate-700 line-clamp-2">
                  {dispute.description}
                </p>
                {dispute.master_admin_comment && (
                  <p className="text-xs text-slate-500 italic">
                    Admin: {dispute.master_admin_comment}
                  </p>
                )}
              </div>
              <div className="flex-shrink-0">
                <span className="text-[11px] text-slate-400">
                  {new Date(dispute.created_at).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
