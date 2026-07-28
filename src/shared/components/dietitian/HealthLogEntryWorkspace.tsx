"use client";

// src/shared/components/dietitian/HealthLogEntryWorkspace.tsx
// Feature: dietitian-management — the Log Customer workflow's log-entry
// workspace (Req 15.5, 15.6, 15.15, 25.6).
//
// Portal-neutral: this is what a Dietitian sees after selecting a customer
// from the Log Customer list (`LogCustomerList.tsx`). It combines the customer
// identity header, the cadence-driven `LogSlotSelector`, the read-only
// `SelfLogReferencePanel` for the selected slot (Req 25.6) and the
// `HealthLogForm` itself (Req 15.5, 15.6).
//
// Slot model: instead of a free calendar, the Dietitian picks from the fixed
// schedule of check-ins implied by the Cadence_Engine (every Nth Eligible_Day
// from the Logging_Window start — `src/lib/dietitian/logSlots.ts`). Selecting a
// slot loads that date's existing Dietitian_Log (to prefill) and Self_Log
// (reference) on demand; a logged slot outside its same-day edit window is
// shown read-only (Req 18.1, 18.2). On a successful submit the workspace stays
// put and refreshes so the slot flips to "logged", rather than navigating away.
//
// Requirements: 15.5, 15.6, 15.9, 15.15, 18.1, 18.2, 25.6

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Phone, Hash, User2, ClipboardList, FileText } from "lucide-react";

import { parseISODateString } from "@/lib/dates/ist";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { HealthLogForm } from "@/shared/components/dietitian/HealthLogForm";
import { SelfLogReferencePanel } from "@/shared/components/dietitian/SelfLogReferencePanel";
import { LogSlotSelector } from "@/shared/components/dietitian/LogSlotSelector";
import {
  getDietitianLogForDate,
  getSelfLogForDate,
} from "@/actions/dietitian-actions/healthLogActions";
import type { LogSlot } from "@/lib/dietitian/logSlots";
import type {
  CustomerCategory,
  CustomParameter,
  HealthLog,
  ParameterValue,
} from "@/types/dietitian";

/** The prefill values + edit state a single slot's Dietitian_Log carries. */
interface DietitianLogValues {
  parameters: Record<string, ParameterValue>;
  customParameters: CustomParameter[];
  closingComment: string;
}

export interface HealthLogEntryWorkspaceProps {
  customerProfileId: string;
  customerName: string;
  customerCode: string | null;
  mobile: string | null;
  category: CustomerCategory;
  /** The cadence-driven Log_Slot schedule with status merged in (Req 14, 15). */
  slots: LogSlot[];
  /** The slot date to open on, or `null` when there are no slots. */
  initialSelectedDate: string | null;
  /** Distinct Custom_Parameter labels previously used for this customer (Req 12.9). */
  customParameterSuggestions: string[];
  /** The Self_Log(s) recorded for `initialSelectedDate`, read-only reference (Req 25.6). */
  initialSelfLogs: HealthLog[];
  /** An existing Dietitian_Log for `initialSelectedDate` to prefill, or `null`. */
  initialValues: DietitianLogValues | null;
  /** Whether `initialValues` (if any) is still editable today (Req 18.1, 18.2). */
  initialEditable: boolean;
}

function categoryLabel(category: CustomerCategory): string {
  switch (category) {
    case "ACCOMMODATION":
      return "Accommodation";
    case "KIT":
      return "Kit";
    case "MEAL":
      return "Meal";
  }
}

export function HealthLogEntryWorkspace({
  customerProfileId,
  customerName,
  customerCode,
  mobile,
  category,
  slots,
  initialSelectedDate,
  customParameterSuggestions,
  initialSelfLogs,
  initialValues,
  initialEditable,
}: HealthLogEntryWorkspaceProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [selectedDate, setSelectedDate] = useState<string | null>(initialSelectedDate);
  const [selfLogs, setSelfLogs] = useState<HealthLog[]>(initialSelfLogs);
  const [logValues, setLogValues] = useState<DietitianLogValues | null>(initialValues);
  const [editable, setEditable] = useState<boolean>(initialEditable);
  const [loading, setLoading] = useState(false);
  // Bumped on every load so the form remounts with fresh default values.
  const [formNonce, setFormNonce] = useState(0);

  const loadSlot = useCallback(
    async (date: string) => {
      setLoading(true);
      try {
        const [dietitianResult, selfLogResult] = await Promise.all([
          getDietitianLogForDate(customerProfileId, date),
          getSelfLogForDate(customerProfileId, date),
        ]);

        setSelfLogs(selfLogResult.success ? selfLogResult.data : []);

        if (dietitianResult.success && dietitianResult.data) {
          const { editable: isEditable, ...values } = dietitianResult.data;
          setLogValues(values);
          setEditable(isEditable);
        } else {
          // No log yet for this date — a fresh, editable create.
          setLogValues(null);
          setEditable(true);
        }
      } finally {
        setLoading(false);
        setFormNonce((n) => n + 1);
      }
    },
    [customerProfileId],
  );

  const handleSelectSlot = useCallback(
    (date: string) => {
      if (date === selectedDate && !loading) {
        // Re-selecting the current slot is a no-op.
        return;
      }
      setSelectedDate(date);
      void loadSlot(date);
    },
    [selectedDate, loading, loadSlot],
  );

  const handleSubmitted = useCallback(() => {
    // Stay on the page: reload the current slot (now editable, just-saved) and
    // refresh the server component so the slot chip flips to "logged".
    if (selectedDate) void loadSlot(selectedDate);
    startTransition(() => router.refresh());
  }, [selectedDate, loadSlot, router]);

  // A logged slot outside its edit window is shown, but locked.
  const readOnly = logValues !== null && !editable;

  return (
    <div className="space-y-6">
      {/* Customer identity header — who this log belongs to. */}
      <Card className="overflow-hidden border-slate-200/70">
        <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
              <User2 className="size-6" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-lg font-semibold text-slate-900">
                  {customerName}
                </span>
                <Badge variant="outline">{categoryLabel(category)}</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Hash className="size-3.5" />
                  {customerCode ?? "—"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3.5" />
                  {mobile ?? "—"}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cadence-driven slot schedule. */}
      <Card className="border-slate-200/70">
        <CardContent className="py-5">
          <LogSlotSelector
            slots={slots}
            selectedDate={selectedDate}
            onSelect={handleSelectSlot}
            loading={loading}
          />
        </CardContent>
      </Card>

      {selectedDate ? (
        <>
          {/* Customer self-log reference — only takes space when there's data
              to show (Req 25.6); otherwise a slim note sits atop the form. */}
          {selfLogs.length > 0 && (
            <SelfLogReferencePanel selfLogs={selfLogs} logDate={selectedDate} />
          )}

          <Card className="border-slate-200/70">
            <CardHeader className="border-b bg-slate-50/60">
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="size-4 text-primary" />
                Health Log Entry
              </CardTitle>
              <CardDescription>
                {readOnly
                  ? "Viewing a previously recorded log for this slot."
                  : logValues
                    ? "Update the measurements recorded for this slot."
                    : "Capture the measurements recorded during this consultation."}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              {selfLogs.length === 0 && (
                <p className="mb-6 flex items-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2 text-sm text-muted-foreground">
                  <FileText className="size-4 shrink-0 text-slate-400" />
                  No customer self-log recorded for{" "}
                  {format(parseISODateString(selectedDate), "dd MMM yyyy")}.
                </p>
              )}
              <HealthLogForm
                key={`${selectedDate}-${formNonce}`}
                customerProfileId={customerProfileId}
                category={category}
                selectableDates={[selectedDate]}
                defaultLogDate={selectedDate}
                fixedLogDate={selectedDate}
                readOnly={readOnly}
                customParameterSuggestions={customParameterSuggestions}
                initialValues={logValues}
                onSubmitted={handleSubmitted}
              />
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="border-slate-200/70">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No log slots are scheduled for this customer yet.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
