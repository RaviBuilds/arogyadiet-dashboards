"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { BarChart3, Loader2, Users, Package, Truck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { FranchiseRole } from "@/types/franchise";

interface FranchiseReportsProps {
  role: FranchiseRole;
  franchiseId: string;
}

interface ReportMetrics {
  activeSubscriptions: number;
  totalCustomers: number;
  totalRiders: number;
  deliveriesThisMonth: number;
}

/**
 * Franchise-scoped reports component.
 * Shows key metrics scoped to the franchise.
 */
export default function FranchiseReports({ role, franchiseId }: FranchiseReportsProps) {
  const [metrics, setMetrics] = useState<ReportMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      const firstOfMonth = new Date();
      firstOfMonth.setDate(1);
      const monthStart = firstOfMonth.toISOString().split("T")[0];

      const [subs, customers, riders, deliveries] = await Promise.allSettled([
        supabase
          .from("subscriptions")
          .select("id", { count: "exact", head: true })
          .eq("franchise_id", franchiseId)
          .eq("status", "ACTIVE"),
        supabase
          .from("customer_profiles")
          .select("id", { count: "exact", head: true })
          .eq("franchise_id", franchiseId),
        supabase
          .from("rider_profiles")
          .select("id", { count: "exact", head: true })
          .eq("franchise_id", franchiseId)
          .eq("is_active", true),
        supabase
          .from("delivery_orders")
          .select("id", { count: "exact", head: true })
          .eq("franchise_id", franchiseId)
          .gte("delivery_date", monthStart),
      ]);

      setMetrics({
        activeSubscriptions: subs.status === "fulfilled" ? (subs.value.count ?? 0) : 0,
        totalCustomers: customers.status === "fulfilled" ? (customers.value.count ?? 0) : 0,
        totalRiders: riders.status === "fulfilled" ? (riders.value.count ?? 0) : 0,
        deliveriesThisMonth: deliveries.status === "fulfilled" ? (deliveries.value.count ?? 0) : 0,
      });
      setLoading(false);
    }
    load();
  }, [franchiseId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Reports
        </CardTitle>
        <CardDescription>
          Key metrics for this franchise — current month.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : !metrics ? (
          <p className="text-sm text-red-500">Failed to load metrics.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <MetricTile icon={Users} label="Active Subscriptions" value={metrics.activeSubscriptions} color="text-emerald-600" />
            <MetricTile icon={Users} label="Total Customers" value={metrics.totalCustomers} color="text-blue-600" />
            <MetricTile icon={Truck} label="Active Riders" value={metrics.totalRiders} color="text-purple-600" />
            <MetricTile icon={Package} label="Deliveries (Month)" value={metrics.deliveriesThisMonth} color="text-amber-600" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: any;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        <span className="text-[11px] text-slate-500">{label}</span>
      </div>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}
