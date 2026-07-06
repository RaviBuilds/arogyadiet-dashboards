"use client";

import { useState } from "react";
import { ClipboardList, ArrowRight } from "lucide-react";
import type { DisputeWithFranchiseName } from "@/types/dispute";
import type { DisputeStatus } from "@/validations/disputeSchema";
import { VALID_TRANSITIONS } from "@/validations/disputeSchema";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import ResolveDisputeDialog from "./ResolveDisputeDialog";

interface Props {
  disputes: DisputeWithFranchiseName[];
  onSuccess: () => void;
  onError: (message: string) => void;
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

export default function DisputeListTable({ disputes, onSuccess, onError }: Props) {
  const [selectedDispute, setSelectedDispute] = useState<DisputeWithFranchiseName | null>(null);
  const [targetStatus, setTargetStatus] = useState<DisputeStatus | null>(null);

  function handleActionClick(dispute: DisputeWithFranchiseName, nextStatus: DisputeStatus) {
    setSelectedDispute(dispute);
    setTargetStatus(nextStatus);
  }

  function handleDialogClose() {
    setSelectedDispute(null);
    setTargetStatus(null);
  }

  if (disputes.length === 0) {
    return (
      <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 mx-auto mb-4">
          <ClipboardList className="h-6 w-6 text-slate-400" />
        </div>
        <p className="text-sm font-medium text-slate-500">No disputes found.</p>
        <p className="text-xs text-slate-400 mt-1">Disputes from franchises will appear here.</p>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-800">
            All Disputes
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {disputes.length} dispute{disputes.length !== 1 ? "s" : ""} matching filter
          </p>
        </div>

        {/* Dispute Cards */}
        <div className="divide-y divide-slate-100">
          {disputes.map((dispute) => {
            const allowed = VALID_TRANSITIONS[dispute.status];
            const hasNextStatus = allowed !== null;
            const defaultNext: DisputeStatus = Array.isArray(allowed)
              ? allowed[0]
              : allowed ?? "Under_Investigation";
            const orderCount = dispute.related_order_ids?.length ?? 0;

            return (
              <div
                key={dispute.id}
                className="px-6 py-4 hover:bg-slate-50/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: Main info */}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="text-sm font-semibold text-slate-800">
                        {dispute.franchise_name}
                      </span>
                      <Badge
                        variant="outline"
                        className={`rounded-lg text-[10px] font-medium ${STATUS_STYLES[dispute.status]}`}
                      >
                        {STATUS_LABELS[dispute.status]}
                      </Badge>
                      <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                        {dispute.category.replace(/_/g, " ")}
                      </span>
                    </div>

                    <p className="text-sm text-slate-600 line-clamp-1">
                      {dispute.description}
                    </p>

                    {/* Meta row */}
                    <div className="flex items-center gap-4 text-[11px] text-slate-400">
                      <span>
                        {new Date(dispute.created_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                      {orderCount > 0 && (
                        <span>{orderCount} related order{orderCount !== 1 ? "s" : ""}</span>
                      )}
                      {dispute.master_admin_comment && (
                        <span className="text-slate-500 italic truncate max-w-[200px]">
                          &ldquo;{dispute.master_admin_comment}&rdquo;
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: Action */}
                  <div className="flex-shrink-0">
                    {hasNextStatus ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl text-xs font-medium gap-1.5 shadow-sm hover:shadow-md transition-shadow"
                        onClick={() => handleActionClick(dispute, defaultNext)}
                      >
                        Update
                        <ArrowRight className="h-3 w-3" />
                      </Button>
                    ) : (
                      <span className="inline-flex items-center rounded-lg bg-emerald-50 px-2.5 py-1 text-[10px] font-medium text-emerald-700 border border-emerald-200">
                        Resolved
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedDispute && targetStatus && (
        <ResolveDisputeDialog
          dispute={selectedDispute}
          targetStatus={targetStatus}
          onSuccess={() => {
            handleDialogClose();
            onSuccess();
          }}
          onError={onError}
          onClose={handleDialogClose}
        />
      )}
    </>
  );
}
