"use client";

import {
  Users,
  UserCheck,
  UserX,
  Activity,
  AlertTriangle,
  Salad,
} from "lucide-react";
import {
  StatCard,
  SectionCard,
} from "@/shared/components/franchise/ui/GlassCard";

interface CustomerData {
  id: string;
  status: string;
  dietary_preference: string;
  hasMedicalHistory: boolean;
  allergies: string | null;
  isActive: boolean;
}

interface FranchiseCustomerOverviewProps {
  customers: CustomerData[];
}

export function FranchiseCustomerOverview({
  customers,
}: FranchiseCustomerOverviewProps) {
  if (customers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Users className="h-12 w-12 text-slate-300 mb-3" />
        <p className="text-sm font-medium text-slate-700">
          No customer data available yet
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Customers will appear here once they are onboarded.
        </p>
      </div>
    );
  }

  const total = customers.length;
  const activeCount = customers.filter((c) => c.status === "Active").length;
  const noPlanCount = customers.filter((c) => c.status === "No Plan").length;
  const medicalCount = customers.filter((c) => c.hasMedicalHistory).length;
  const allergyCount = customers.filter(
    (c) =>
      c.allergies !== null &&
      c.allergies.trim() !== "" &&
      c.allergies.toLowerCase() !== "none" &&
      c.allergies.toLowerCase() !== "no allergy",
  ).length;

  // Dietary distribution
  const vegCount = customers.filter(
    (c) => c.dietary_preference === "Veg",
  ).length;
  const nonVegCount = customers.filter(
    (c) => c.dietary_preference === "Non-Veg",
  ).length;

  // Status distribution
  const statusCounts = {
    Active: customers.filter((c) => c.status === "Active").length,
    Pending: customers.filter((c) => c.status === "Pending").length,
    Stopped: customers.filter((c) => c.status === "Stopped").length,
    Expired: customers.filter((c) => c.status === "Expired").length,
    "No Plan": customers.filter((c) => c.status === "No Plan").length,
  };

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatCard
          icon={Users}
          label="Total Customers"
          value={total}
          accent="text-slate-700"
          accentBg="bg-slate-100"
        />
        <StatCard
          icon={UserCheck}
          label="Active"
          value={activeCount}
          accent="text-emerald-600"
          accentBg="bg-emerald-50"
        />
        <StatCard
          icon={UserX}
          label="No Plan"
          value={noPlanCount}
          accent="text-amber-600"
          accentBg="bg-amber-50"
        />
        <StatCard
          icon={Activity}
          label="Medical History"
          value={medicalCount}
          accent="text-blue-600"
          accentBg="bg-blue-50"
        />
        <StatCard
          icon={AlertTriangle}
          label="Has Allergies"
          value={allergyCount}
          accent="text-rose-600"
          accentBg="bg-rose-50"
        />
      </div>

      {/* Dietary Preference Distribution */}
      <SectionCard icon={Salad} title="Dietary Preference" subtitle="Distribution">
        <div className="space-y-4">
          <DistributionRow
            label="Veg"
            count={vegCount}
            total={total}
            color="bg-green-500"
          />
          <DistributionRow
            label="Non-Veg"
            count={nonVegCount}
            total={total}
            color="bg-red-500"
          />
        </div>
      </SectionCard>

      {/* Customer Status Mix */}
      <SectionCard icon={Activity} title="Customer Status" subtitle="Mix">
        <div className="space-y-4">
          <DistributionRow
            label="Active"
            count={statusCounts.Active}
            total={total}
            color="bg-emerald-500"
          />
          <DistributionRow
            label="Pending"
            count={statusCounts.Pending}
            total={total}
            color="bg-blue-500"
          />
          <DistributionRow
            label="Stopped"
            count={statusCounts.Stopped}
            total={total}
            color="bg-red-500"
          />
          <DistributionRow
            label="Expired"
            count={statusCounts.Expired}
            total={total}
            color="bg-slate-400"
          />
          <DistributionRow
            label="No Plan"
            count={statusCounts["No Plan"]}
            total={total}
            color="bg-amber-500"
          />
        </div>
      </SectionCard>
    </div>
  );
}

function DistributionRow({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-xs text-slate-500">
          {count} ({pct}%)
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
