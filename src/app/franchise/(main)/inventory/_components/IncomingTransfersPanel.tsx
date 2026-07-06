"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { PackageOpen, Boxes } from "lucide-react";
import type { FranchiseStockTransfer } from "@/types/franchiseInventory";
import ReceiveTransferControls from "./ReceiveTransferControls";
import PackageImagesViewer from "@/shared/components/admin/inventory/PackageImagesViewer";

interface IncomingTransfersPanelProps {
  transfers: FranchiseStockTransfer[];
}

/**
 * Panel displaying incoming stock transfers from the central kitchen.
 *
 * Shows DISPATCHED transfers with Accept/Reject controls and
 * ACCEPTED (in-transit) transfers with a "Confirm Received" button.
 *
 * Requirements validated: 7.1, 7.2, 7.3, 8.2
 */
export default function IncomingTransfersPanel({
  transfers,
}: IncomingTransfersPanelProps) {
  // Filter to only actionable transfers (DISPATCHED and ACCEPTED)
  const actionableTransfers = transfers.filter(
    (t) => t.state === "DISPATCHED" || t.state === "ACCEPTED",
  );

  if (actionableTransfers.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <PackageOpen className="h-4 w-4" />
            Incoming Transfers
          </CardTitle>
          <CardDescription>
            Stock dispatched from the central kitchen will appear here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Boxes className="h-10 w-10 text-slate-300 mb-3" />
            <p className="text-sm text-slate-500">No pending transfers</p>
            <p className="text-xs text-slate-400 mt-1">
              When the central kitchen dispatches stock to your franchise, it
              will appear here for your review.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <PackageOpen className="h-4 w-4" />
          Incoming Transfers
          <Badge
            variant="outline"
            className="ml-auto rounded-lg text-[10px] bg-blue-50 text-blue-700 border-blue-200"
          >
            {actionableTransfers.length} pending
          </Badge>
        </CardTitle>
        <CardDescription>
          Review and accept stock dispatched from the central kitchen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {actionableTransfers.map((transfer) => (
          <TransferCard key={transfer.id} transfer={transfer} />
        ))}
      </CardContent>
    </Card>
  );
}

function TransferCard({ transfer }: { transfer: FranchiseStockTransfer }) {
  const dispatchDate = new Date(transfer.dispatchedAt).toLocaleDateString(
    "en-IN",
    {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  );

  return (
    <div className="rounded-xl bg-white/60 p-4 ring-1 ring-slate-100 transition-all hover:ring-slate-200">
      {/* Header: Product name + state badge */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-slate-800 truncate">
            {transfer.productName}
          </h4>
          <p className="text-xs text-slate-500 mt-0.5">
            From: Central Kitchen
          </p>
        </div>
        <Badge
          variant="outline"
          className={`rounded-lg text-[10px] shrink-0 ${
            transfer.state === "DISPATCHED"
              ? "bg-purple-50 text-purple-700 border-purple-200"
              : "bg-amber-50 text-amber-700 border-amber-200"
          }`}
        >
          {transfer.state === "DISPATCHED" ? "Dispatched" : "In Transit"}
        </Badge>
      </div>

      {/* Quantity and dispatch timestamp */}
      <div className="flex items-center gap-4 text-xs text-slate-600 mb-3">
        <span className="font-medium">
          Qty: <span className="text-slate-800">{transfer.quantity}</span>
        </span>
        <span className="text-slate-400">•</span>
        <span>{dispatchDate}</span>
      </div>

      {/* Batch breakdown */}
      {transfer.lines.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">
            Batch Breakdown
          </p>
          <div className="space-y-1">
            {transfer.lines.map((line, idx) => (
              <div
                key={`${line.batchNumber}-${idx}`}
                className="flex items-center justify-between rounded-lg bg-slate-50/80 px-3 py-1.5 text-xs"
              >
                <span className="text-slate-700 font-mono">
                  {line.batchNumber}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500">
                    Exp:{" "}
                    {new Date(line.expiryDate).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                  <Badge
                    variant="outline"
                    className="rounded text-[10px] px-1.5 py-0"
                  >
                    ×{line.quantity}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Package images viewer */}
      {transfer.packageImagePaths && transfer.packageImagePaths.length > 0 && (
        <div className="mb-3">
          <PackageImagesViewer transferId={transfer.id} />
        </div>
      )}

      {/* Action buttons */}
      <div className="border-t border-slate-100 pt-3">
        <ReceiveTransferControls transfer={transfer} />
      </div>
    </div>
  );
}
