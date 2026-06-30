"use client";

import { useState, useEffect } from "react";
import { Loader2, Users, Package, Truck, CreditCard } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { FranchiseRole } from "@/types/franchise";
import { StatCard } from "@/shared/components/franchise/ui/GlassCard";

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
 * Shows key metrics scoped to the franchise as consistent StatCards.
 */
export default function FranchiseReports({ franchiseId }: FranchiseReportsProps) {
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

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!metrics) {
    return <p className="text-sm text-rose-500">Failed to load metrics.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
      <StatCard icon={CreditCard} label="Active Subscriptions" value={metrics.activeSubscriptions} accent="text-emerald-600" accentBg="bg-emerald-50" />
      <StatCard icon={Users} label="Total Customers" value={metrics.totalCustomers} accent="text-blue-600" accentBg="bg-blue-50" />
      <StatCard icon={Truck} label="Active Riders" value={metrics.totalRiders} accent="text-violet-600" accentBg="bg-violet-50" />
      <StatCard icon={Package} label="Deliveries (Month)" value={metrics.deliveriesThisMonth} accent="text-amber-600" accentBg="bg-amber-50" />
    </div>
  );
}
