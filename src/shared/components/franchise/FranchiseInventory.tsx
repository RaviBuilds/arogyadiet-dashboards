"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Boxes, Info } from "lucide-react";
import type { FranchiseRole } from "@/types/franchise";

interface FranchiseInventoryProps {
  role: FranchiseRole;
  franchiseId: string;
}

/**
 * Franchise inventory placeholder component.
 *
 * NOTE: Inventory and manufacturing are currently excluded from franchise scoping
 * (per business decision — franchises don't have manufacturing units).
 * This component is a placeholder for future implementation.
 *
 * Products table IS franchise-scoped, but the full inventory module
 * (raw materials, lots, manufacturing) remains core-only for now.
 */
export default function FranchiseInventory({ role, franchiseId }: FranchiseInventoryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Boxes className="h-4 w-4" />
          Inventory
        </CardTitle>
        <CardDescription>
          Product catalog and stock management for this franchise.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start gap-3 rounded-lg border border-blue-100 bg-blue-50/50 px-4 py-3">
          <Info className="h-4 w-4 mt-0.5 text-blue-600 shrink-0" />
          <div className="text-sm text-blue-700">
            <p className="font-medium">Coming soon</p>
            <p className="text-xs text-blue-600 mt-0.5">
              Franchise inventory management will be available in a future update.
              Currently, product catalog is managed by the core operation.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
