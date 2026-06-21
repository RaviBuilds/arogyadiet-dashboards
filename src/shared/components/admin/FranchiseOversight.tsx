"use client";

import { useState, useEffect, useTransition } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Building2,
  MapPin,
  Plus,
  X,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  assignPincodes,
  removePincodes,
  listFranchisePincodes,
  getPincodeConflicts,
} from "@/actions/admin-actions/franchisePincodeActions";
import type { Franchise, FranchisePincodeConflict } from "@/types/franchise";
import { createClient } from "@/lib/supabase/client";

/**
 * FranchiseOversight — Admin Dashboard Section
 *
 * Allows ADMIN to:
 * - View all franchises with their assigned pincodes
 * - Assign new pincodes to franchises
 * - Remove pincodes from franchises
 * - View pincode conflicts
 *
 * This is ADDITIVE ONLY — does not modify any existing admin dashboard components.
 */
export default function FranchiseOversight() {
  const [franchises, setFranchises] = useState<Franchise[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFranchise, setSelectedFranchise] = useState<string | null>(null);
  const [pincodes, setPincodes] = useState<{ id: string; pincode: string }[]>([]);
  const [conflicts, setConflicts] = useState<FranchisePincodeConflict[]>([]);
  const [newPincode, setNewPincode] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    async function loadFranchises() {
      const supabase = createClient();
      const { data } = await supabase
        .from("franchises")
        .select("*")
        .order("name");
      setFranchises((data as Franchise[]) ?? []);
      setLoading(false);
    }
    loadFranchises();
  }, []);

  const loadPincodes = async (franchiseId: string) => {
    setSelectedFranchise(franchiseId);
    const result = await listFranchisePincodes(franchiseId);
    if (result.success) {
      setPincodes(result.data);
    }
    const conflictResult = await getPincodeConflicts(franchiseId);
    if (conflictResult.success) {
      setConflicts(conflictResult.conflicts);
    }
  };

  const handleAssignPincode = () => {
    if (!selectedFranchise || !newPincode.trim()) return;

    if (!/^[0-9]{6}$/.test(newPincode.trim())) {
      toast.error("Pincode must be exactly 6 digits");
      return;
    }

    startTransition(async () => {
      const result = await assignPincodes({
        franchise_id: selectedFranchise,
        pincodes: [newPincode.trim()],
      });
      if (result.success) {
        toast.success(`Pincode ${newPincode} assigned`);
        setNewPincode("");
        loadPincodes(selectedFranchise);
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleRemovePincode = (pincode: string) => {
    if (!selectedFranchise) return;

    startTransition(async () => {
      const result = await removePincodes({
        franchise_id: selectedFranchise,
        pincodes: [pincode],
      });
      if (result.success) {
        toast.success(`Pincode ${pincode} removed`);
        loadPincodes(selectedFranchise);
      } else {
        toast.error(result.error);
      }
    });
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </CardContent>
      </Card>
    );
  }

  if (franchises.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Franchise Oversight
          </CardTitle>
          <CardDescription>
            No franchises have been created yet. Master Admin will create them from the BI Command Center.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const selectedData = franchises.find((f) => f.id === selectedFranchise);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Franchise Pincode Management
        </CardTitle>
        <CardDescription>
          Assign and manage service area pincodes for each franchise. Core (Hyderabad) pincodes are protected.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Franchise Selection */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {franchises.map((f) => (
            <button
              key={f.id}
              onClick={() => loadPincodes(f.id)}
              className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-all ${
                selectedFranchise === f.id
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                  : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <span className="font-medium text-slate-700">{f.name}</span>
              <Badge
                variant="outline"
                className={
                  f.status === "active"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : f.status === "onboarding"
                      ? "bg-amber-50 text-amber-700 border-amber-200"
                      : "bg-red-50 text-red-700 border-red-200"
                }
              >
                {f.status}
              </Badge>
            </button>
          ))}
        </div>

        {/* Pincode Management Panel */}
        {selectedFranchise && selectedData && (
          <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">
                {selectedData.name} — Pincodes ({pincodes.length})
              </h3>
            </div>

            {/* Conflicts Warning */}
            {conflicts.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <AlertCircle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
                <div className="text-xs text-amber-700">
                  <strong>{conflicts.length} conflict(s) detected.</strong>{" "}
                  {conflicts.map((c) => c.pincode).join(", ")} overlap with{" "}
                  {conflicts[0].conflicting_entity === "core"
                    ? "core operation"
                    : "another franchise"}
                  .
                </div>
              </div>
            )}

            {conflicts.length === 0 && pincodes.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                No conflicts — all pincodes are unique to this franchise.
              </div>
            )}

            {/* Add Pincode */}
            <div className="flex gap-2">
              <Input
                placeholder="Enter 6-digit pincode"
                value={newPincode}
                onChange={(e) => setNewPincode(e.target.value)}
                className="max-w-[200px] font-mono"
                maxLength={6}
                onKeyDown={(e) => e.key === "Enter" && handleAssignPincode()}
              />
              <Button
                size="sm"
                onClick={handleAssignPincode}
                disabled={isPending || !newPincode.trim()}
                className="gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                Assign
              </Button>
            </div>

            {/* Pincode List */}
            {pincodes.length === 0 ? (
              <p className="text-xs text-slate-400">No pincodes assigned yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {pincodes.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1"
                  >
                    <MapPin className="h-3 w-3 text-slate-400" />
                    <span className="font-mono text-xs text-slate-700">
                      {p.pincode}
                    </span>
                    <button
                      onClick={() => handleRemovePincode(p.pincode)}
                      disabled={isPending}
                      className="ml-1 rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                      title="Remove pincode"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
