"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  approveFailedDeliveryAction,
  rejectFailedDeliveryAction,
  type PendingFailureApprovalRow,
} from "@/actions/admin-actions/operationsActions";
import { SectionHeader } from "../core/SectionHeader";
import { DataTableCard } from "../core/DataTableCard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Button } from "@/shared/components/ui/button";

export default function FailedDeliveryApprovals({
  approvals,
}: {
  approvals: PendingFailureApprovalRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<
    "approve" | "reject" | null
  >(null);

  if (!approvals.length) return null;

  const handleAction = (
    orderId: string,
    action: "approve" | "reject",
  ) => {
    setPendingOrderId(orderId);
    setPendingAction(action);

    startTransition(async () => {
      const result =
        action === "approve"
          ? await approveFailedDeliveryAction(orderId)
          : await rejectFailedDeliveryAction(orderId);

      setPendingOrderId(null);
      setPendingAction(null);

      if (result.success) {
        toast.success(
          action === "approve"
            ? "Failed delivery approved."
            : "Failed delivery request rejected. Rider must attempt delivery again.",
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <DataTableCard
      header={
        <SectionHeader
          title="⚠️ Failed Delivery Approvals"
          icon={AlertTriangle}
        />
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Rider Name</TableHead>
            <TableHead>Customer Name</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {approvals.map((row) => {
            const isRowPending = isPending && pendingOrderId === row.orderId;

            return (
              <TableRow key={row.orderId}>
                <TableCell className="font-medium">{row.riderName}</TableCell>
                <TableCell>{row.customerName}</TableCell>
                <TableCell className="max-w-md text-muted-foreground">
                  {row.reason}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={isRowPending}
                      onClick={() => handleAction(row.orderId, "approve")}
                    >
                      {isRowPending && pendingAction === "approve" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Approve"
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isRowPending}
                      onClick={() => handleAction(row.orderId, "reject")}
                    >
                      {isRowPending && pendingAction === "reject" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Reject"
                      )}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </DataTableCard>
  );
}
