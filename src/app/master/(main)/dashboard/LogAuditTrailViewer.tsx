"use client";

// src/app/master/(main)/dashboard/LogAuditTrailViewer.tsx
// Master dashboard — Log_Audit_Trail viewer (dietitian-management — Task 11.5,
// Req 18.8).
//
// A master admin enters a Customer_Record id (taken from a row in
// `DietitianActivityReport`'s per-customer table, or typed directly) and this
// component lists every `health_log_audit_entries` row for that customer, in
// the reverse-chronological order `listHealthLogAuditEntries` already
// guarantees, showing each entry's outcome (ACCEPTED/REJECTED) — the append-
// only audit trail exists precisely so every write attempt, accepted and
// rejected, is visible here (Req 18.5, 18.6).

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";

import { listHealthLogAuditEntries } from "@/actions/master-actions/dietitianActivityActions";
import type { AuditEntry } from "@/types/dietitian";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

/** Format an ISO 8601 timestamp for display, in IST. */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

interface LogAuditTrailViewerProps {
  /** Optional starting Customer_Record id, e.g. deep-linked from an activity report row. */
  initialCustomerProfileId?: string;
}

/**
 * Master dashboard audit viewer: enter a Customer_Record id and see its
 * Log_Audit_Trail, reverse-chronological, with each entry's outcome
 * (Req 18.8).
 */
export function LogAuditTrailViewer({
  initialCustomerProfileId = "",
}: LogAuditTrailViewerProps) {
  const [customerProfileId, setCustomerProfileId] = useState(initialCustomerProfileId);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleLoad = () => {
    const trimmed = customerProfileId.trim();
    if (trimmed.length === 0) {
      toast.error("Enter a customer id");
      return;
    }
    startTransition(async () => {
      const result = await listHealthLogAuditEntries(trimmed);
      if (result.success) {
        setEntries(result.data);
      } else {
        toast.error(result.error);
        setEntries(null);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log Audit Trail</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Customer profile id"
              value={customerProfileId}
              onChange={(e) => setCustomerProfileId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLoad();
              }}
              className="pl-9"
            />
          </div>
          <Button onClick={handleLoad} disabled={isPending} size="sm">
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Load
          </Button>
        </div>

        {entries !== null && (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Log date</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Rejection reason</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-20 text-center text-sm text-muted-foreground">
                      No audit entries for this customer.
                    </TableCell>
                  </TableRow>
                ) : (
                  entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{entry.logDate}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{entry.action}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            entry.outcome === "ACCEPTED"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-red-200 bg-red-50 text-red-700"
                          }
                        >
                          {entry.outcome}
                        </Badge>
                      </TableCell>
                      <TableCell>{entry.actorName ?? "—"}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-muted-foreground">
                        {entry.rejectionReason ?? "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatTimestamp(entry.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default LogAuditTrailViewer;
