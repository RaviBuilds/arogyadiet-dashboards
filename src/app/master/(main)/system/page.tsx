import { Suspense } from "react";
import Link from "next/link";
import { MasterPageHeader } from "@/shared/components/master/MasterPageHeader";
import { Users, DollarSign, ScrollText, Shield, FileBarChart, Hospital } from "lucide-react";
import { CoreBusinessSection } from "@/shared/components/master/core-business/CoreBusinessSection";
import { RateConfigCard } from "@/shared/components/master/rates/RateConfigCard";

export const revalidate = 0;

export default function SystemPage() {
  return (
    <div className="space-y-6">
      <MasterPageHeader
        title="System & Configuration"
        description="User management, finance settings, activity logs, and system health."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <SystemCard
          href="/user-management"
          icon={<Users className="h-5 w-5 text-emerald-600" />}
          title="User Management"
          description="Create, edit, and manage admin accounts."
        />
        <SystemCard
          href="/core-clinics"
          icon={<Hospital className="h-5 w-5 text-emerald-600" />}
          title="Core Clinic Management"
          description="Manage cities, kitchens, and clinics in the core hierarchy."
        />
        <SystemCard
          href="/finance"
          icon={<DollarSign className="h-5 w-5 text-emerald-600" />}
          title="Finance"
          description="Revenue, rider payouts, and system settings."
        />
        <SystemCard
          href="/logs"
          icon={<ScrollText className="h-5 w-5 text-slate-600" />}
          title="Activity Logs"
          description="Audit trail of all admin operations."
        />
        <SystemCard
          href="/customers"
          icon={<Shield className="h-5 w-5 text-red-600" />}
          title="Customer Data"
          description="Legacy customer and subscription tables."
        />
        <SystemCard
          href="/reports"
          icon={<FileBarChart className="h-5 w-5 text-blue-600" />}
          title="Report Engine"
          description="Custom reports, export data, and analytics."
        />
      </div>

      {/* Additive Core Business section — positioned BELOW the existing Core
          Clinic Management card, which is left untouched (Req 21.2, 21.7). */}
      <Suspense
        fallback={
          <p className="pt-6 text-sm text-slate-500">Loading Core Business…</p>
        }
      >
        <CoreBusinessSection />
      </Suspense>

      {/* Rate Configuration card — delivery and rider payout per-km rates
          for Core Business and each franchise (Req 10.1, 12.1, 12.2). */}
      <RateConfigCard />
    </div>
  );
}

function SystemCard({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6 hover:border-slate-300 hover:shadow-md transition-all duration-200 group"
    >
      <div className="flex items-center gap-3 mb-3">
        {icon}
        <h3 className="text-sm font-semibold text-slate-800 group-hover:text-slate-900">
          {title}
        </h3>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">{description}</p>
    </Link>
  );
}
