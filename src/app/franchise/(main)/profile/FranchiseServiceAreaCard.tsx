"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { SectionCard } from "@/shared/components/franchise/ui/GlassCard";
import {
  MapPin,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import {
  requestFranchisePincode,
  cancelMyPincodeRequest,
} from "@/actions/franchise-actions/franchisePincodeRequestActions";
import type { FranchisePincodeRequest } from "@/types/franchise";

interface Props {
  approvedPincodes: string[];
  requests: FranchisePincodeRequest[];
}

export default function FranchiseServiceAreaCard({ approvedPincodes, requests }: Props) {
  const router = useRouter();
  const [newPincode, setNewPincode] = useState("");
  const [isPending, startTransition] = useTransition();

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const rejectedRequests = requests.filter((r) => r.status === "rejected");

  const handleRequest = () => {
    const pincode = newPincode.trim();
    if (!/^[0-9]{6}$/.test(pincode)) {
      toast.error("Pincode must be exactly 6 digits");
      return;
    }
    startTransition(async () => {
      const result = await requestFranchisePincode({ pincode });
      if (result.success) {
        toast.success(`Pincode ${pincode} submitted for approval`);
        setNewPincode("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleCancel = (id: string, pincode: string) => {
    startTransition(async () => {
      const result = await cancelMyPincodeRequest(id);
      if (result.success) {
        toast.success(`Request for ${pincode} cancelled`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const totalServed = approvedPincodes.length;

  return (
    <SectionCard
      icon={MapPin}
      title="Service Area Pincodes"
      subtitle={`${totalServed} active${pendingRequests.length ? ` · ${pendingRequests.length} pending` : ""}`}
    >
      <div className="space-y-6">
        {/* Request form */}
        <div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              placeholder="Enter 6-digit pincode"
              value={newPincode}
              onChange={(e) => setNewPincode(e.target.value.replace(/\D/g, ""))}
              className="max-w-[220px] font-mono"
              maxLength={6}
              inputMode="numeric"
              onKeyDown={(e) => e.key === "Enter" && handleRequest()}
            />
            <Button
              size="sm"
              onClick={handleRequest}
              disabled={isPending || newPincode.trim().length !== 6}
              className="gap-1.5"
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Request Pincode
            </Button>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
            <Info className="h-3.5 w-3.5 shrink-0" />
            New pincodes stay pending until an admin approves them.
          </p>
        </div>

        {/* Active (approved) pincodes */}
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
            Active Service Area
          </p>
          {approvedPincodes.length === 0 ? (
            <p className="text-sm text-slate-400">No active pincodes yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {approvedPincodes.map((p) => (
                <Badge
                  key={p}
                  variant="secondary"
                  className="gap-1 rounded-lg bg-emerald-50 font-mono text-emerald-700 ring-1 ring-inset ring-emerald-200"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  {p}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Pending requests */}
        {pendingRequests.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Awaiting Approval
            </p>
            <div className="flex flex-wrap gap-2">
              {pendingRequests.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 ring-1 ring-inset ring-amber-200"
                >
                  <Clock className="h-3 w-3 text-amber-600" />
                  <span className="font-mono text-xs text-amber-700">{r.pincode}</span>
                  <button
                    onClick={() => handleCancel(r.id, r.pincode)}
                    disabled={isPending}
                    className="ml-0.5 rounded p-0.5 text-amber-500 transition-colors hover:bg-amber-100 hover:text-amber-700"
                    title="Cancel request"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rejected requests */}
        {rejectedRequests.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Rejected
            </p>
            <div className="flex flex-col gap-1.5">
              {rejectedRequests.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-2 text-xs text-slate-500"
                >
                  <Badge
                    variant="outline"
                    className="gap-1 rounded-lg border-red-200 font-mono text-red-600"
                  >
                    <XCircle className="h-3 w-3" />
                    {r.pincode}
                  </Badge>
                  {r.review_notes && (
                    <span className="text-slate-400">— {r.review_notes}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
