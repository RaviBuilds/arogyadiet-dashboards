"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  getRiderDeliveryOrderStatusAction,
  markOrderDeliveredAction,
} from "@/actions/rider-actions/routeActions";
import type { ChecklistItem } from "@/lib/delivery/riderChecklist";
import { ChecklistModal } from "./ChecklistModal";
import { FailedDeliveryModal } from "./FailedDeliveryModal";

const FAILURE_APPROVAL_POLL_MS = 5000;

export function RiderDeliveryActions({
  orderId,
  status,
  checklistItems,
}: {
  orderId: string;
  status: string;
  checklistItems: ChecklistItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [failedOpen, setFailedOpen] = useState(false);
  const handledStatusRef = useRef<string | null>(null);

  useEffect(() => {
    if (status !== "PENDING_FAILURE_APPROVAL") {
      return;
    }

    let cancelled = false;

    const checkStatus = async () => {
      const result = await getRiderDeliveryOrderStatusAction(orderId);
      if (cancelled || !result.success) return;

      const nextStatus = result.status;
      if (nextStatus === "PENDING_FAILURE_APPROVAL") return;
      if (handledStatusRef.current === nextStatus) return;

      handledStatusRef.current = nextStatus;
      router.refresh();

      if (nextStatus === "FAILED") {
        toast.success("Admin approved failed delivery.");
        router.push("/route");
      } else if (nextStatus === "REACHING_TO_LOCATION") {
        toast.info(
          "Admin rejected the failure request. You can attempt delivery again.",
        );
      }
    };

    void checkStatus();
    const intervalId = window.setInterval(() => {
      void checkStatus();
    }, FAILURE_APPROVAL_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [status, orderId, router]);

  if (status === "PENDING_FAILURE_APPROVAL") {
    return (
      <div className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm font-semibold text-zinc-600">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
        Waiting for Admin Approval...
      </div>
    );
  }

  if (status !== "REACHING_TO_LOCATION") {
    return null;
  }

  const handleConfirmDelivery = () => {
    startTransition(async () => {
      try {
        await markOrderDeliveredAction(orderId);
        setChecklistOpen(false);
        toast.success("Delivery marked as delivered.");
        router.push("/route");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Could not mark delivered.";
        toast.error(message);
      }
    });
  };

  return (
    <>
      <div className="flex gap-2">
        <Button
          type="button"
          className="h-14 flex-1 rounded-2xl bg-green-600 text-base font-bold text-white hover:bg-green-700"
          disabled={isPending}
          onClick={() => setChecklistOpen(true)}
        >
          <CheckCircle2 className="mr-2 h-5 w-5" />
          Mark Delivered
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="icon"
          className="h-14 w-14 shrink-0 rounded-2xl"
          disabled={isPending}
          aria-label="Request failed delivery"
          onClick={() => setFailedOpen(true)}
        >
          <AlertTriangle className="h-5 w-5" />
        </Button>
      </div>

      <ChecklistModal
        open={checklistOpen}
        onOpenChange={setChecklistOpen}
        items={checklistItems}
        onConfirm={handleConfirmDelivery}
        isPending={isPending}
      />

      <FailedDeliveryModal
        open={failedOpen}
        onOpenChange={setFailedOpen}
        orderId={orderId}
        onSuccess={() => router.refresh()}
      />
    </>
  );
}
