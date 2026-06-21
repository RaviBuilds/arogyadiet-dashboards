"use client";

import { useState, useEffect, useTransition } from "react";
import { Badge } from "@/shared/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { getPincodeConflicts } from "@/actions/admin-actions/franchisePincodeActions";
import type { FranchisePincodeConflict } from "@/types/franchise";

interface PincodeConflictSectionProps {
  franchiseId: string;
  pincodeCount: number;
}

export default function PincodeConflictSection({
  franchiseId,
  pincodeCount,
}: PincodeConflictSectionProps) {
  const [conflicts, setConflicts] = useState<FranchisePincodeConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pincodeCount === 0) {
      setLoading(false);
      return;
    }

    async function checkConflicts() {
      const result = await getPincodeConflicts(franchiseId);
      if (result.success) {
        setConflicts(result.conflicts);
      } else {
        setError(result.error);
      }
      setLoading(false);
    }

    checkConflicts();
  }, [franchiseId, pincodeCount]);

  if (pincodeCount === 0) return null;

  if (loading) {
    return (
      <Card>
        <CardContent className="py-4">
          <div className="h-6 w-48 animate-pulse rounded bg-slate-100" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200">
        <CardContent className="py-4">
          <p className="text-sm text-red-600">Failed to check conflicts: {error}</p>
        </CardContent>
      </Card>
    );
  }

  if (conflicts.length === 0) {
    return (
      <Card className="border-emerald-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2 text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            No Pincode Conflicts
          </CardTitle>
          <CardDescription>
            All assigned pincodes are unique to this franchise. Ready for activation.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-amber-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 text-amber-700">
          <AlertTriangle className="h-4 w-4" />
          Pincode Conflicts Detected ({conflicts.length})
        </CardTitle>
        <CardDescription>
          These pincodes overlap with other entities. Resolve conflicts before
          activation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {conflicts.map((conflict) => (
            <div
              key={conflict.pincode}
              className="flex items-center justify-between rounded-md border border-amber-100 bg-amber-50/50 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="font-mono">
                  {conflict.pincode}
                </Badge>
                <span className="text-sm text-slate-600">
                  conflicts with{" "}
                  <span className="font-medium">
                    {conflict.conflicting_entity === "core"
                      ? "Core Operation (Hyderabad)"
                      : conflict.conflicting_franchise_name ?? "Another franchise"}
                  </span>
                </span>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Ask Admin to reassign or remove conflicting pincodes to resolve.
        </p>
      </CardContent>
    </Card>
  );
}
