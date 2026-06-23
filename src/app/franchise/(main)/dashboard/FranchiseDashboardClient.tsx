"use client";

import Link from "next/link";
import { Badge } from "@/shared/components/ui/badge";
import {
  Users,
  CreditCard,
  Truck,
  Package,
  TrendingUp,
  Clock,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Activity,
  LayoutDashboard,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import { GlassCard, SectionCard } from "@/shared/components/franchise/ui/GlassCard";

interface DashboardMetrics {
  activeSubscriptions: number;
  totalCustomers: number;
  activeRiders: number;
  todayDeliveries: number;
  monthDeliveries: number;
  pendingSubscriptions: number;
  deliveredToday: number;
  pendingToday: number;
  failedToday: number;
}

interface TodayOrder {
  id: string;
  status: string;
  customer_profiles?: any;
  rider_profiles?: any;
}

interface Props {
  franchiseId: string;
  franchiseName: string;
  metrics: DashboardMetrics;
  todayOrders: TodayOrder[];
}

const STATUS_COLORS: Record<string, string> = {
  DELIVERED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ASSIGNED: "bg-blue-50 text-blue-700 border-blue-200",
  OUT_FOR_DELIVERY: "bg-purple-50 text-purple-700 border-purple-200",
  ON_THE_WAY: "bg-indigo-50 text-indigo-700 border-indigo-200",
  PICKED: "bg-cyan-50 text-cyan-700 border-cyan-200",
  FAILED: "bg-red-50 text-red-700 border-red-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
  ORDER_CREATED: "bg-slate-50 text-slate-600 border-slate-200",
  MEAL_PREPARED: "bg-amber-50 text-amber-700 border-amber-200",
};

export default function FranchiseDashboardClient({
  franchiseId,
  franchiseName,
  metrics,
  todayOrders,
}: Props) {
  if (!franchiseId) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p>Unable to determine franchise. Please contact support.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      {/* Page Header */}
      <PageHeader
        title="Dashboard"
        subtitle={`${franchiseName} — operations overview at a glance.`}
        icon={LayoutDashboard}
      />

      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
        <KpiCard
          icon={Users}
          label="Total Customers"
          value={metrics.totalCustomers}
          color="text-blue-600"
          bgColor="bg-blue-50"
          href="/customers"
        />
        <KpiCard
          icon={CreditCard}
          label="Active Subscriptions"
          value={metrics.activeSubscriptions}
          color="text-emerald-600"
          bgColor="bg-emerald-50"
          href="/subscriptions"
          sub={metrics.pendingSubscriptions > 0 ? `${metrics.pendingSubscriptions} pending` : undefined}
        />
        <KpiCard
          icon={Truck}
          label="Active Riders"
          value={metrics.activeRiders}
          color="text-purple-600"
          bgColor="bg-purple-50"
          href="/riders"
        />
        <KpiCard
          icon={Package}
          label="Today's Deliveries"
          value={metrics.todayDeliveries}
          color="text-amber-600"
          bgColor="bg-amber-50"
          href="/operations"
          sub={`${metrics.monthDeliveries} this month`}
        />
      </div>

      {/* Today's Operations Status */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Delivery Status Breakdown */}
        <SectionCard icon={Activity} title="Today's Status" subtitle="Delivery breakdown" className="lg:col-span-1">
          <div className="space-y-3">
            <StatusRow
              icon={CheckCircle2}
              label="Delivered"
              count={metrics.deliveredToday}
              color="text-emerald-600"
              bgColor="bg-emerald-100"
            />
            <StatusRow
              icon={Clock}
              label="In Progress"
              count={metrics.pendingToday}
              color="text-blue-600"
              bgColor="bg-blue-100"
            />
            <StatusRow
              icon={XCircle}
              label="Failed / Cancelled"
              count={metrics.failedToday}
              color="text-rose-600"
              bgColor="bg-rose-100"
            />
            {metrics.todayDeliveries > 0 && (
              <div className="pt-3 border-t border-slate-100">
                <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                    style={{
                      width: `${metrics.todayDeliveries > 0 ? (metrics.deliveredToday / metrics.todayDeliveries) * 100 : 0}%`,
                    }}
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  {metrics.todayDeliveries > 0
                    ? `${Math.round((metrics.deliveredToday / metrics.todayDeliveries) * 100)}% completion rate`
                    : "No deliveries today"}
                </p>
              </div>
            )}
          </div>
        </SectionCard>

        {/* Today's Orders Table */}
        <SectionCard
          icon={Package}
          title="Recent Orders Today"
          subtitle={`${todayOrders.length} of ${metrics.todayDeliveries} total`}
          className="lg:col-span-2"
          actions={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/operations" className="text-xs">
                View All <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          }
        >
          {todayOrders.length === 0 ? (
            <p className="text-sm text-slate-400 py-10 text-center">
              No delivery orders for today yet.
            </p>
          ) : (
            <div className="space-y-2 max-h-[280px] overflow-y-auto">
              {todayOrders.map((order: any) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between rounded-xl bg-white/60 px-3 py-2.5 ring-1 ring-slate-100 transition-colors hover:bg-slate-50/60"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-slate-800">
                      {order.customer_profiles?.users?.full_name ?? "Customer"}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Rider: {order.rider_profiles?.users?.full_name ?? "Unassigned"}
                    </span>
                  </div>
                  <Badge
                    variant="outline"
                    className={`rounded-lg text-[10px] ${STATUS_COLORS[order.status] ?? "text-slate-500"}`}
                  >
                    {order.status?.replace(/_/g, " ") ?? "—"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Quick Actions */}
      <SectionCard icon={TrendingUp} title="Quick Actions" subtitle="Jump to a workspace">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <QuickAction href="/customers" label="Manage Customers" icon={Users} />
          <QuickAction href="/subscriptions" label="Subscriptions" icon={CreditCard} />
          <QuickAction href="/riders" label="Manage Riders" icon={Truck} />
          <QuickAction href="/operations" label="Operations" icon={TrendingUp} />
        </div>
      </SectionCard>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  color,
  bgColor,
  href,
  sub,
}: {
  icon: any;
  label: string;
  value: number;
  color: string;
  bgColor: string;
  href: string;
  sub?: string;
}) {
  return (
    <Link href={href}>
      <GlassCard interactive className="group p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2.5">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {label}
            </p>
            <p className={`text-3xl font-semibold tracking-tight ${color}`}>{value}</p>
            {sub && <p className="text-xs text-slate-400">{sub}</p>}
          </div>
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-xl ring-1 ring-inset ring-white/60 transition-transform group-hover:scale-105 ${bgColor}`}
          >
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
        </div>
      </GlassCard>
    </Link>
  );
}

function StatusRow({
  icon: Icon,
  label,
  count,
  color,
  bgColor,
}: {
  icon: any;
  label: string;
  count: number;
  color: string;
  bgColor: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className={`rounded-md p-1.5 ${bgColor}`}>
          <Icon className={`h-3.5 w-3.5 ${color}`} />
        </div>
        <span className="text-sm text-slate-600">{label}</span>
      </div>
      <span className={`text-sm font-bold ${color}`}>{count}</span>
    </div>
  );
}

function QuickAction({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: any;
}) {
  return (
    <Link href={href}>
      <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 p-4 hover:bg-slate-50 hover:border-slate-300 transition-all duration-200 cursor-pointer">
        <Icon className="h-5 w-5 text-slate-600" />
        <span className="text-xs font-medium text-slate-700 text-center">{label}</span>
      </div>
    </Link>
  );
}
