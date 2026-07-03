import Link from "next/link";
import {
  Upload,
  UserPlus,
  Plus,
  ArrowLeft,
  ArrowRight,
  FileSpreadsheet,
  Zap,
  Users,
} from "lucide-react";

import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { Button } from "@/shared/components/ui/button";
import { guardAdminGroup } from "@/lib/auth/adminAccess";

export default async function CustomerOnboardingPage() {
  await guardAdminGroup("customers");

  return (
    <div className="flex animate-in fade-in flex-col gap-6 pb-2 duration-500">
      <AdminPageHeader
        title="Customer Onboarding"
        description="Choose how you'd like to add customers to the platform."
      />

      {/* Back link */}
      <div>
        <Button variant="ghost" size="sm" className="text-slate-500 hover:text-slate-900 -ml-1" asChild>
          <Link href="/customers">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back to Customers
          </Link>
        </Button>
      </div>

      {/* Action cards grid */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">

        {/* Card 1 — Bulk Import */}
        <Link
          href="/customers/bulk-import"
          className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-transparent transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md hover:ring-slate-200/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* Top accent stripe */}
          <div className="h-1 w-full bg-linear-to-r from-violet-400 via-indigo-400 to-blue-400" />

          <div className="flex flex-1 flex-col gap-5 p-6">
            {/* Icon */}
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 ring-1 ring-indigo-100 transition-all duration-200 group-hover:bg-indigo-100">
              <FileSpreadsheet className="h-5 w-5 text-indigo-600" />
            </div>

            {/* Text */}
            <div className="flex flex-1 flex-col gap-1.5">
              <p className="text-base font-semibold tracking-tight text-slate-900">
                Bulk Import
              </p>
              <p className="text-sm leading-relaxed text-slate-500">
                Import multiple customers and subscriptions at once from an Excel or CSV spreadsheet. Ideal for migrating offline records.
              </p>
            </div>

            {/* Metadata chips */}
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                <Upload className="h-3 w-3" />
                CSV / XLSX
              </span>
              <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                Batch operation
              </span>
            </div>

            {/* Footer CTA */}
            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <span className="text-xs text-slate-400">
                Up to thousands of rows
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 transition-all duration-200 group-hover:gap-2">
                Get started
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>
        </Link>

        {/* Card 2 — Quick Onboard */}
        <Link
          href="/customers/quick-onboard"
          className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-transparent transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md hover:ring-slate-200/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* Top accent stripe */}
          <div className="h-1 w-full bg-linear-to-r from-emerald-400 via-teal-400 to-cyan-400" />

          <div className="flex flex-1 flex-col gap-5 p-6">
            {/* Icon */}
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-100 transition-all duration-200 group-hover:bg-emerald-100">
              <Zap className="h-5 w-5 text-emerald-600" />
            </div>

            {/* Text */}
            <div className="flex flex-1 flex-col gap-1.5">
              <p className="text-base font-semibold tracking-tight text-slate-900">
                Quick Onboard
              </p>
              <p className="text-sm leading-relaxed text-slate-500">
                Rapidly onboard a single customer with their core details, subscription plan, address, and payment — all in one guided wizard.
              </p>
            </div>

            {/* Metadata chips */}
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                <Zap className="h-3 w-3" />
                Step-by-step wizard
              </span>
              <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                Single customer
              </span>
            </div>

            {/* Footer CTA */}
            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <span className="text-xs text-slate-400">
                Includes map-based address capture
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 transition-all duration-200 group-hover:gap-2">
                Get started
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>
        </Link>

        {/* Card 3 — Create Customer (opens modal on the customers page) */}
        <Link
          href="/customers?action=create"
          className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-transparent transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md hover:ring-slate-200/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* Top accent stripe — uses brand primary colour */}
          <div className="h-1 w-full bg-linear-to-r from-rose-400 via-orange-400 to-amber-400" />

          <div className="flex flex-1 flex-col gap-5 p-6">
            {/* Icon */}
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 ring-1 ring-rose-100 transition-all duration-200 group-hover:bg-rose-100">
              <Users className="h-5 w-5 text-rose-600" />
            </div>

            {/* Text */}
            <div className="flex flex-1 flex-col gap-1.5">
              <p className="text-base font-semibold tracking-tight text-slate-900">
                Create Customer
              </p>
              <p className="text-sm leading-relaxed text-slate-500">
                Manually create a new customer profile with full details — name, contact, demographics, and delivery address — without a subscription.
              </p>
            </div>

            {/* Metadata chips */}
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
                <Plus className="h-3 w-3" />
                Profile creation
              </span>
              <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                No subscription required
              </span>
            </div>

            {/* Footer CTA */}
            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <span className="text-xs text-slate-400">
                Add subscription separately later
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 transition-all duration-200 group-hover:gap-2">
                Get started
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>
        </Link>

      </div>
    </div>
  );
}
