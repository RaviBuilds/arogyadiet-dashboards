"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Package, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { FranchiseRole } from "@/types/franchise";

interface FranchiseOrdersProps {
  role: FranchiseRole;
  franchiseId: string;
}

interface OrderRow {
  id: string;
  delivery_date: string;
  status: string;
  customer_profiles: { users: { full_name: string } | null } | null;
  rider_profiles: { users: { full_name: string } | null } | null;
}

const STATUS_COLORS: Record<string, string> = {
  DELIVERED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ASSIGNED: "bg-blue-50 text-blue-700 border-blue-200",
  OUT_FOR_DELIVERY: "bg-purple-50 text-purple-700 border-purple-200",
  FAILED: "bg-red-50 text-red-700 border-red-200",
};

/**
 * Franchise-scoped delivery orders component.
 * Shows today's orders for the given franchise_id.
 */
export default function FranchiseOrders({ role, franchiseId }: FranchiseOrdersProps) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const today = new Date().toISOString().split("T")[0];
      const { data } = await supabase
        .from("delivery_orders")
        .select("id, delivery_date, status, customer_profiles(users(full_name)), rider_profiles(users(full_name))")
        .eq("franchise_id", franchiseId)
        .eq("delivery_date", today)
        .order("route_sequence", { ascending: true });
      setOrders((data as OrderRow[]) ?? []);
      setLoading(false);
    }
    load();
  }, [franchiseId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Package className="h-4 w-4" />
          Today&apos;s Orders
        </CardTitle>
        <CardDescription>
          {loading ? "Loading..." : `${orders.length} delivery order(s) today.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : orders.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">No orders for today.</p>
        ) : (
          <div className="rounded-lg border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Rider</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">
                      {o.customer_profiles?.users?.full_name ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {o.rider_profiles?.users?.full_name ?? "Unassigned"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={STATUS_COLORS[o.status] ?? "text-slate-500"}
                      >
                        {o.status?.replace(/_/g, " ") ?? "—"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
