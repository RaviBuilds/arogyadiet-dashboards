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
  Building2,
  Users,
  Truck,
  IndianRupee,
  Package,
  AlertCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Franchise } from "@/types/franchise";

interface NetworkMetrics {
  totalFranchises: number;
  activeFranchises: number;
  onboardingFranchises: number;
  suspendedFranchises: number;
  totalSubscriptions: number;
  totalRiders: number;
  totalDeliveriesToday: number;
}

/**
 * FranchiseNetworkOverview
 *
 * Displays consolidated metrics across the franchise network:
 * - Franchise count by status
 * - Total active subscriptions (core + all franchises)
 * - Total active riders
 * - Today's deliveries
 *
 * Designed for the Master Dashboard. Each metric handles its own error state
 * without blocking others.
 */
export default function FranchiseNetworkOverview() {
  const [metrics, setMetrics] = useState<NetworkMetrics | null>(null);
  const [franchises, setFranchises] = useState<Franchise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadMetrics() {
      try {
        const supabase = createClient();

        // Fetch all franchises
        const { data: franchiseData, error: franchiseError } = await supabase
          .from("franchises")
          .select("*")
          .order("name");

        if (franchiseError) throw franchiseError;

        const allFranchises = (franchiseData ?? []) as Franchise[];
        setFranchises(allFranchises);

        // Fetch metrics in parallel
        const [subsResult, ridersResult, deliveriesResult] = await Promise.allSettled([
          supabase
            .from("subscriptions")
            .select("id", { count: "exact", head: true })
            .eq("status", "ACTIVE"),
          supabase
            .from("rider_profiles")
            .select("id", { count: "exact", head: true })
            .eq("is_active", true),
          supabase
            .from("delivery_orders")
            .select("id", { count: "exact", head: true })
            .eq("delivery_date", new Date().toISOString().split("T")[0]),
        ]);

        setMetrics({
          totalFranchises: allFranchises.length,
          activeFranchises: allFranchises.filter((f) => f.status === "active").length,
          onboardingFranchises: allFranchises.filter((f) => f.status === "onboarding").length,
          suspendedFranchises: allFranchises.filter((f) => f.status === "suspended").length,
          totalSubscriptions:
            subsResult.status === "fulfilled"
              ? (subsResult.value.count ?? 0)
              : 0,
          totalRiders:
            ridersResult.status === "fulfilled"
              ? (ridersResult.value.count ?? 0)
              : 0,
          totalDeliveriesToday:
            deliveriesResult.status === "fulfilled"
              ? (deliveriesResult.value.count ?? 0)
              : 0,
        });
      } catch (err: any) {
        setError(err.message ?? "Failed to load metrics");
      } finally {
        setLoading(false);
      }
    }

    loadMetrics();
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 rounded-lg bg-slate-100" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200">
        <CardContent className="py-6 flex items-center gap-2 text-red-600">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">{error}</span>
        </CardContent>
      </Card>
    );
  }

  if (!metrics) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Franchise Network Overview
        </CardTitle>
        <CardDescription>
          Consolidated metrics across core operation and all franchises.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* KPI Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            icon={Building2}
            label="Franchises"
            value={metrics.totalFranchises}
            sub={`${metrics.activeFranchises} active`}
            color="text-blue-600"
          />
          <MetricCard
            icon={Users}
            label="Active Subscriptions"
            value={metrics.totalSubscriptions}
            sub="Core + all franchises"
            color="text-emerald-600"
          />
          <MetricCard
            icon={Truck}
            label="Active Riders"
            value={metrics.totalRiders}
            sub="Network-wide"
            color="text-purple-600"
          />
          <MetricCard
            icon={Package}
            label="Today's Deliveries"
            value={metrics.totalDeliveriesToday}
            sub="All locations"
            color="text-amber-600"
          />
        </div>

        {/* Franchise List */}
        {franchises.length > 0 && (
          <div className="pt-2">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
              Franchise Registry
            </p>
            <div className="space-y-1.5">
              {franchises.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2 text-sm"
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
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: any;
  label: string;
  value: number;
  sub: string;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        <span className="text-xs text-slate-500">{label}</span>
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>
    </div>
  );
}
