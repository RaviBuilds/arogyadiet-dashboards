"use client";

// src/app/master/(main)/dashboard/DietitianActivitySection.tsx
// Master dashboard — Dietitian dropdown + activity report + audit viewer
// (dietitian-management — Task 11.5, Req 18.8, 20.1, 20.6, 20.7).
//
// Mirrors `NetworkReportSection.tsx`'s load-on-mount + reload-on-select
// pattern: `listActiveDietitians()` populates the dropdown (each option
// labelled with its assigned Clinic name, `Unassigned` when empty, Req 20.1),
// and selecting one loads `getDietitianActivityReport(dietitianUserId)` into
// the shared, portal-neutral `DietitianActivityReport` (Req 20.2–20.5, 20.7).
// Its `reportCardHrefFor` routes into the master-only Report_Card page
// mounted at `/dietitian-activity/[customerId]/report-card` (Req 20.6).

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  listActiveDietitians,
  getDietitianActivityReport,
} from "@/actions/master-actions/dietitianActivityActions";
import type { DietitianAccount, DietitianActivitySummary } from "@/types/dietitian";
import { DietitianActivityReport } from "@/shared/components/dietitian/DietitianActivityReport";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { LogAuditTrailViewer } from "./LogAuditTrailViewer";

function dietitianOptionLabel(dietitian: DietitianAccount): string {
  return `${dietitian.fullName} — ${dietitian.clinicName ?? "Unassigned"}`;
}

export default function DietitianActivitySection() {
  const [dietitians, setDietitians] = useState<DietitianAccount[]>([]);
  const [selectedDietitianId, setSelectedDietitianId] = useState<string | null>(null);
  const [summary, setSummary] = useState<DietitianActivitySummary | null>(null);
  const [isPending, startTransition] = useTransition();

  // Load the Dietitian dropdown options once (Req 20.1).
  useEffect(() => {
    listActiveDietitians().then((result) => {
      if (result.success) setDietitians(result.data);
      else toast.error(result.error);
    });
  }, []);

  // (Re)load the activity report whenever the selected Dietitian changes.
  useEffect(() => {
    startTransition(async () => {
      if (!selectedDietitianId) {
        setSummary(null);
        return;
      }
      const result = await getDietitianActivityReport(selectedDietitianId);
      if (result.success) setSummary(result.data);
      else {
        toast.error(result.error);
        setSummary(null);
      }
    });
  }, [selectedDietitianId]);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800">
            Dietitian Activity
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            See who is behind on logging, per dietitian.
          </p>
        </div>
        {dietitians.length > 0 && (
          <Select
            value={selectedDietitianId ?? undefined}
            onValueChange={setSelectedDietitianId}
          >
            <SelectTrigger className="h-9 w-[280px] text-xs">
              <SelectValue placeholder="Select a dietitian" />
            </SelectTrigger>
            <SelectContent>
              {dietitians.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {dietitianOptionLabel(d)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {isPending ? (
        <div className="h-40 animate-pulse rounded-2xl bg-slate-100 border border-slate-200" />
      ) : summary ? (
        <DietitianActivityReport
          summary={summary}
          reportCardHrefFor={(customerProfileId) =>
            `/dietitian-activity/${customerProfileId}/report-card`
          }
        />
      ) : selectedDietitianId ? null : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Select a dietitian to view their activity report
            </CardTitle>
          </CardHeader>
          <CardContent />
        </Card>
      )}

      <LogAuditTrailViewer />
    </section>
  );
}
