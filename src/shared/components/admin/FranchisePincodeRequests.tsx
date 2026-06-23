"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Inbox,
  MapPin,
  Building2,
  Clock,
  Check,
  X,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import {
  listPincodeRequests,
  approvePincodeRequest,
  rejectPincodeRequest,
} from "@/actions/admin-actions/franchisePincodeActions";
import type { FranchisePincodeRequestWithMeta } from "@/types/franchise";

/**
 * FranchisePincodeRequests — Admin approval queue.
 *
 * Lists pending service-area pincode requests raised by franchise admins and
 * lets ADMIN / MASTER_ADMIN approve (promote into live service areas) or reject.
 */
export default function FranchisePincodeRequests() {
  const [requests, setRequests] = useState<FranchisePincodeRequestWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const load = useCallback(async () => {
    const result = await listPincodeRequests("pending");
    if (result.success) setRequests(result.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleApprove = (id: string, pincode: string) => {
    setActingId(id);
    startTransition(async () => {
      const result = await approvePincodeRequest({ request_id: id });
      if (result.success) {
        toast.success(
          result.assignedCustomers > 0
            ? `Pincode ${pincode} approved · ${result.assignedCustomers} customer(s) assigned`
            : `Pincode ${pincode} approved`
        );
        await load();
      } else {
        toast.error(result.error);
      }
      setActingId(null);
    });
  };

  const handleReject = (id: string, pincode: string) => {
    setActingId(id);
    startTransition(async () => {
      const result = await rejectPincodeRequest({ request_id: id });
      if (result.success) {
        toast.success(`Pincode ${pincode} request rejected`);
        await load();
      } else {
        toast.error(result.error);
      }
      setActingId(null);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Inbox className="h-4 w-4" />
          Pincode Requests
          {requests.length > 0 && (
            <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100">
              {requests.length} pending
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Service-area pincodes requested by franchise admins. Approve to activate
          the pincode for the franchise, or reject the request.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            </div>
            <p className="text-sm font-medium text-slate-600">No pending requests</p>
            <p className="text-xs text-slate-400">
              New franchise pincode requests will appear here for approval.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => (
              <div
                key={r.id}
                className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50">
                    <MapPin className="h-4 w-4 text-amber-600" />
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-slate-800">
                        {r.pincode}
                      </span>
                      <Badge
                        variant="outline"
                        className="gap-1 border-amber-200 bg-amber-50 text-amber-700"
                      >
                        <Clock className="h-3 w-3" />
                        pending
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3 w-3" />
                        {r.franchise_name}
                      </span>
                      {r.requested_by_name && <span>by {r.requested_by_name}</span>}
                      <span>
                        {new Date(r.created_at).toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleReject(r.id, r.pincode)}
                    disabled={actingId === r.id}
                    className="gap-1 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    {actingId === r.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleApprove(r.id, r.pincode)}
                    disabled={actingId === r.id}
                    className="gap-1 bg-emerald-600 hover:bg-emerald-700"
                  >
                    {actingId === r.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Approve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
