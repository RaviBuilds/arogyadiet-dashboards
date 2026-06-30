"use client";

import { useState, useEffect } from "react";
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
import { SectionCard } from "@/shared/components/franchise/ui/GlassCard";

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
  FAILED: "bg-rose-50 text-rose-700 border-rose-200",
};

const TH = "text-[11px] font-medium uppercase tracking-wider text-slate-400";

/**
 * Franchise-scoped delivery orders component.
 * Shows today's orders for the given franchise_id.
 */
export default function FranchiseOrders({ franchiseId }: FranchiseOrdersProps) {
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
      setOrders((data as unknown as OrderRow[]) ?? []);
      setLoading(false);
    }
    load();
  }, [franchiseId]);

  return (
    <SectionCard
      icon={Package}
      title="Today's Orders"
      subtitle={loading ? "Loading..." : `${orders.length} delivery orders`}
    >
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : orders.length === 0 ? (
        <p className="text-sm text-slate-400 py-12 text-center">No orders for today.</p>
      ) : (
        <div className="overflow-auto rounded-xl ring-1 ring-slate-100">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/60 hover:bg-slate-50/60">
                <TableHead className={TH}>Customer</TableHead>
                <TableHead className={TH}>Rider</TableHead>
                <TableHead className={TH}>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id} className="border-slate-100 transition-colors hover:bg-slate-50/40">
                  <TableCell className="text-sm font-medium text-slate-800">
                    {o.customer_profiles?.users?.full_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {o.rider_profiles?.users?.full_name ?? "Unassigned"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`rounded-lg text-[10px] ${STATUS_COLORS[o.status] ?? "text-slate-500"}`}>
                      {o.status?.replace(/_/g, " ") ?? "—"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </SectionCard>
  );
}
