"use client";

/**
 * FallbackAutomationsPanel
 *
 * Backup manual-trigger panel for every scheduled cron job that does NOT
 * already have a dedicated card in System Automation Control (Order Creation,
 * Product Linking, Routing & Batching). Lets an admin re-run any of these on
 * demand — each run uses that automation's own default target date (today's
 * IST date, computed server-side) so there's no date picker here.
 *
 * auto-off-duty (rider 5-minute sweep) is intentionally excluded — running it
 * manually would have no meaningful effect since it re-evaluates live state.
 *
 * Rendered inside the same "System Automation Control" toggle in
 * PlannedDeliveries.tsx — visible only when that toggle is switched ON.
 */

import { useState, useTransition } from "react";
import { Card } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import {
  UserCheck,
  PackageOpen,
  ImageOff,
  BedDouble,
  FileArchive,
  PlayCircle,
  Loader2,
  CheckCircle2,
  Clock,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { SectionHeader } from "../core/SectionHeader";
import { ConfirmActionModal } from "../core/ConfirmActionModal";
import {
  runFallbackAutomation,
  type FallbackAutomationKey,
} from "@/actions/admin-actions/fallbackAutomationActions";

type FallbackScript = {
  key: FallbackAutomationKey;
  name: string;
  icon: typeof UserCheck;
  desc: string;
  schedule: string;
};

const FALLBACK_SCRIPTS: FallbackScript[] = [
  {
    key: "SUB_ACTIVATE",
    name: "Subscription Activation / Expiry",
    icon: UserCheck,
    desc: "Activates PENDING subscriptions starting tomorrow and marks concluded ACTIVE subscriptions as EXPIRED.",
    schedule: "Scheduled ~2:00 PM IST daily",
  },
  {
    key: "KIT_EXPIRE",
    name: "KIT Subscription Expiry",
    icon: PackageOpen,
    desc: "Expires ACTIVE KIT subscriptions whose tracking period has ended.",
    schedule: "Scheduled ~11:30 PM IST daily",
  },
  {
    key: "IMG_CLEANUP",
    name: "Dispatch Image Cleanup",
    icon: ImageOff,
    desc: "Deletes franchise dispatch package images 10 days after confirmed receipt.",
    schedule: "Scheduled ~8:30 AM IST daily",
  },
  {
    key: "STAY_TRANSITION",
    name: "Accommodation Stay Transition",
    icon: BedDouble,
    desc: "Transitions accommodation stays: PENDING → ACTIVE on start date, ACTIVE → FINISHED past end date.",
    schedule: "Scheduled ~1:00 AM IST daily",
  },
  {
    key: "PO_CLEANUP",
    name: "Purchase Order Cleanup",
    icon: FileArchive,
    desc: "Deletes purchase order files from inventory lots older than 3 months.",
    schedule: "Scheduled 1st of month, ~4:00 AM IST",
  },
];

type RunStatus = {
  loading: boolean;
  success?: boolean;
  summary?: string;
};

export function FallbackAutomationsPanel() {
  const [statusByKey, setStatusByKey] = useState<Record<string, RunStatus>>({});
  const [isPending, startTransition] = useTransition();
  const [confirmKey, setConfirmKey] = useState<FallbackScript | null>(null);

  const handleRun = (script: FallbackScript) => {
    setStatusByKey((prev) => ({ ...prev, [script.key]: { loading: true } }));

    startTransition(async () => {
      const result = await runFallbackAutomation(script.key);

      if (result.success) {
        toast.success(`${script.name} executed successfully.`);
        setStatusByKey((prev) => ({
          ...prev,
          [script.key]: { loading: false, success: true, summary: result.summary },
        }));
      } else {
        toast.error(result.error || `Failed to run ${script.name}`);
        setStatusByKey((prev) => ({
          ...prev,
          [script.key]: { loading: false, success: false },
        }));
      }
    });
  };

  return (
    <div className="mt-8">
      <SectionHeader
        title="Fallback Automations"
        icon={ShieldAlert}
        className="mb-2"
      />
      <p className="mb-5 ml-8 text-sm text-muted-foreground">
        Backup triggers for every scheduled job below. Use these only if the
        Supabase-scheduled run was missed or needs to be re-executed for today.
      </p>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {FALLBACK_SCRIPTS.map((script) => {
          const status = statusByKey[script.key] || {};
          const isSuccess = status.success;

          return (
            <Card
              key={script.key}
              className={`relative overflow-hidden transition-all duration-300 flex flex-col justify-between ${
                isSuccess
                  ? "border-green-500/40 shadow-sm bg-green-50/20"
                  : "border-border shadow-sm hover:border-primary/30"
              }`}
            >
              <div className="p-5 flex flex-col gap-3 h-full">
                <div className="flex items-center gap-2 font-semibold text-[15px] text-foreground">
                  <script.icon className={`h-4 w-4 ${isSuccess ? "text-green-600" : "text-primary"}`} />
                  {script.name}
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed pr-2">
                  {script.desc}
                </p>

                <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide">
                  {script.schedule}
                </p>

                <div className="mt-1">
                  <Button
                    variant={isSuccess ? "outline" : "default"}
                    size="sm"
                    className={`w-fit font-medium shadow-sm transition-all ${
                      isSuccess ? "border-green-600 text-green-700 hover:bg-green-50" : "bg-primary text-primary-foreground"
                    }`}
                    onClick={() => setConfirmKey(script)}
                    disabled={status.loading}
                  >
                    {status.loading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <PlayCircle className="mr-2 h-4 w-4" />
                    )}
                    {status.loading ? "Running..." : "Run Script"}
                  </Button>
                </div>
              </div>

              <div
                className={`px-5 py-3 text-xs border-t transition-colors ${
                  isSuccess
                    ? "bg-green-100/50 border-green-200 text-green-800"
                    : "bg-muted/30 border-border/50 text-muted-foreground"
                }`}
              >
                {isSuccess ? (
                  <div className="flex items-start gap-2 font-medium">
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                    <span>{status.summary || "Run completed."}</span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <Clock className="h-4 w-4 shrink-0 opacity-50" />
                    <span>Not manually run this session</span>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <ConfirmActionModal
        isOpen={confirmKey !== null}
        onClose={() => setConfirmKey(null)}
        onConfirm={() => {
          if (confirmKey) handleRun(confirmKey);
          setConfirmKey(null);
        }}
        title="Confirm Manual Run"
        description={
          confirmKey ? (
            <p>
              Are you sure you want to manually re-run{" "}
              <span className="font-semibold text-foreground">[{confirmKey.name}]</span> for
              its default target date? This will be logged as an admin manual run,
              separate from the scheduled Supabase cron run.
            </p>
          ) : (
            ""
          )
        }
        confirmLabel="Run Script"
        variant="destructive"
        isPending={isPending}
      />
    </div>
  );
}
