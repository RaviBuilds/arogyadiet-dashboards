"use client";

import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CirclePause,
  ClipboardList,
  HeartPulse,
  Salad,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserRoundX,
  Users,
} from "lucide-react";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

interface CustomerOverviewCustomer {
  id: string;
  fullName: string;
  dietary_preference: string;
  status: string;
  allergies: string | null;
  hasMedicalHistory: boolean;
  activePlanName: string | null;
}

interface CustomerOverviewSubscription {
  id: string;
  customer_name: string;
  plan_name: string;
  total_days: number;
  starts_on: string;
  ends_on: string;
  pause_credits_total: number;
  pause_credits_used: number;
  status: string;
}

interface CustomerOverviewProps {
  customers: CustomerOverviewCustomer[];
  activeSubscriptions: CustomerOverviewSubscription[];
  pendingSubscriptions: CustomerOverviewSubscription[];
  stoppedSubscriptions: CustomerOverviewSubscription[];
  onNavigate: (tab: string) => void;
}

const formatDate = (value?: string) => {
  if (!value) return "N/A";

  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const getPercent = (value: number, total: number) => {
  if (!total) return 0;
  return Math.min(100, Math.round((value / total) * 100));
};

const getPlanDistribution = (subscriptions: CustomerOverviewSubscription[]) =>
  Object.entries(
    subscriptions.reduce<Record<string, number>>((acc, subscription) => {
      const key = subscription.plan_name || "Custom Plan";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

export function CustomerOverview({
  customers,
  activeSubscriptions,
  pendingSubscriptions,
  stoppedSubscriptions,
  onNavigate,
}: CustomerOverviewProps) {
  const metrics = useMemo(() => {
    const totalCustomers = customers.length;
    const activeCustomers = customers.filter(
      (customer) => customer.status === "Active",
    ).length;
    const noPlanCustomers = customers.filter(
      (customer) => customer.status === "No Plan",
    ).length;
    const allergyCustomers = customers.filter((customer) => {
      const allergy = customer.allergies?.trim().toLowerCase();
      return allergy && allergy !== "none" && allergy !== "no allergy";
    }).length;
    const medicalHistoryCustomers = customers.filter(
      (customer) => customer.hasMedicalHistory,
    ).length;

    const dietDistribution = customers.reduce<Record<string, number>>(
      (acc, customer) => {
        const key = customer.dietary_preference || "N/A";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      },
      {},
    );

    const pauseCreditsTotal = activeSubscriptions.reduce(
      (sum, subscription) => sum + (subscription.pause_credits_total || 0),
      0,
    );
    const pauseCreditsUsed = activeSubscriptions.reduce(
      (sum, subscription) => sum + (subscription.pause_credits_used || 0),
      0,
    );

    const endingSoon = [...activeSubscriptions]
      .filter((subscription) => subscription.ends_on)
      .sort(
        (a, b) =>
          new Date(a.ends_on).getTime() - new Date(b.ends_on).getTime(),
      )
      .slice(0, 4);

    return {
      totalCustomers,
      activeCustomers,
      noPlanCustomers,
      allergyCustomers,
      medicalHistoryCustomers,
      activeSubscriptionsCount: activeSubscriptions.length,
      pendingSubscriptionsCount: pendingSubscriptions.length,
      stoppedSubscriptionsCount: stoppedSubscriptions.length,
      dietDistribution: Object.entries(dietDistribution).sort(
        (a, b) => b[1] - a[1],
      ),
      activePlanDistribution: getPlanDistribution(activeSubscriptions),
      pendingPlanDistribution: getPlanDistribution(pendingSubscriptions),
      stoppedPlanDistribution: getPlanDistribution(stoppedSubscriptions),
      pauseCreditsTotal,
      pauseCreditsUsed,
      pauseCreditsPercent: getPercent(pauseCreditsUsed, pauseCreditsTotal),
      endingSoon,
    };
  }, [customers, activeSubscriptions, pendingSubscriptions, stoppedSubscriptions]);

  const kpis = [
    {
      title: "Total Customers",
      value: metrics.totalCustomers,
      helper: "Complete subscriber base",
      icon: Users,
      accent: "bg-primary/10 text-primary border-primary/20",
    },
    {
      title: "Active Customers",
      value: metrics.activeCustomers,
      helper: `${getPercent(metrics.activeCustomers, metrics.totalCustomers)}% currently subscribed`,
      icon: UserCheck,
      accent: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
    },
    {
      title: "No Active Plan",
      value: metrics.noPlanCustomers,
      helper: "Customers needing follow-up",
      icon: UserRoundX,
      accent: "bg-zinc-500/10 text-zinc-700 border-zinc-200",
    },
    {
      title: "Active Subscriptions",
      value: metrics.activeSubscriptionsCount,
      helper: "Running subscriptions",
      icon: Activity,
      accent: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
    },
    {
      title: "Pending Subscriptions",
      value: metrics.pendingSubscriptionsCount,
      helper: "Scheduled (pending)",
      icon: CalendarClock,
      accent: "bg-amber-500/10 text-amber-700 border-amber-200",
    },
    {
      title: "Expired / Stopped",
      value: metrics.stoppedSubscriptionsCount,
      helper: "Inactive lifecycle records",
      icon: CirclePause,
      accent: "bg-red-500/10 text-red-700 border-red-200",
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Card className="relative overflow-hidden border-primary/20 bg-linear-to-br from-primary/10 via-background to-emerald-500/10 shadow-sm">
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
        <CardContent className="relative p-6 md:p-7">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/15">
                <Sparkles className="h-3 w-3" />
                Customer command overview
              </Badge>
              <div>
                <h2 className="text-2xl font-black tracking-tight text-foreground md:text-3xl">
                  Customer & Subscription Overview
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  A quick operational snapshot of customer health, subscription
                  activity, and plan movement before the full admin dashboard is
                  introduced.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="bg-background/70">
                  {metrics.totalCustomers} Customers
                </Badge>
                <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-200">
                  {metrics.activeSubscriptionsCount} Active Subs
                </Badge>
                <Badge className="bg-amber-500/10 text-amber-700 border-amber-200">
                  {metrics.pendingSubscriptionsCount} Pending
                </Badge>
                <Badge className="bg-red-500/10 text-red-700 border-red-200">
                  {metrics.stoppedSubscriptionsCount} Stopped / Expired
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-2xl border bg-background/70 p-3 shadow-sm backdrop-blur-sm lg:min-w-[280px]">
              <HeroMiniStat label="Active Sub" value={metrics.activeCustomers} />
              <HeroMiniStat label="No Plan" value={metrics.noPlanCustomers} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {kpis.map((item) => (
          <KpiCard key={item.title} {...item} />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="border-border shadow-sm">
          <CardHeader className="border-b bg-muted/20 pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg font-bold">
                  <HeartPulse className="h-5 w-5 text-primary" />
                  Customer Health
                </CardTitle>
                <CardDescription>
                  Profile readiness, dietary mix, and health flags.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onNavigate("Customer Directory")}
              >
                View Directory
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 p-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <InsightPill
                label="Medical history"
                value={metrics.medicalHistoryCustomers}
                icon={ShieldCheck}
                className="bg-blue-50 text-blue-700 border-blue-100"
              />
              <InsightPill
                label="Allergy notes"
                value={metrics.allergyCustomers}
                icon={AlertTriangle}
                className="bg-red-50 text-red-700 border-red-100"
              />
              <InsightPill
                label="Diet profiles"
                value={metrics.dietDistribution.length}
                icon={Salad}
                className="bg-emerald-50 text-emerald-700 border-emerald-100"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-foreground">
                  Customer Status Mix
                </h3>
                <Badge variant="outline" className="bg-muted/40">
                  {metrics.totalCustomers} total
                </Badge>
              </div>
              <DistributionRow
                label="Customer with Active Sub"
                value={metrics.activeCustomers}
                total={metrics.totalCustomers}
                barClassName="bg-emerald-500"
              />
              <DistributionRow
                label="Customer with No Subscription Plan"
                value={metrics.noPlanCustomers}
                total={metrics.totalCustomers}
                barClassName="bg-zinc-500"
              />
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-bold text-foreground">
                Dietary Distribution
              </h3>
              {metrics.dietDistribution.length === 0 ? (
                <EmptyState label="No dietary data available." />
              ) : (
                metrics.dietDistribution.slice(0, 4).map(([label, value]) => (
                  <DistributionRow
                    key={label}
                    label={label}
                    value={value}
                    total={metrics.totalCustomers}
                    barClassName="bg-primary"
                  />
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm">
          <CardHeader className="border-b bg-muted/20 pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg font-bold">
                  <ClipboardList className="h-5 w-5 text-primary" />
                  Subscription Snapshot
                </CardTitle>
                <CardDescription>
                  Active plan spread, pause usage, and upcoming endings.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onNavigate("Active Subscriptions")}
              >
                View Active
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 p-5">
            <div className="rounded-xl border bg-primary/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-foreground">
                    Pause Credit Utilization
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Across all active subscriptions
                  </p>
                </div>
                <Badge className="bg-primary/10 text-primary border-primary/20">
                  {metrics.pauseCreditsUsed} / {metrics.pauseCreditsTotal}
                </Badge>
              </div>
              <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-background">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${metrics.pauseCreditsPercent}%` }}
                />
              </div>
            </div>

            <div className="space-y-3">
              <PlanDistributionSection
                title="Active Distribution by Plan"
                emptyLabel="No active subscription plans yet."
                distribution={metrics.activePlanDistribution}
                total={metrics.activeSubscriptionsCount}
                barClassName="bg-emerald-500"
              />
              <PlanDistributionSection
                title="Pending Distribution by Plan"
                emptyLabel="No pending subscription plans yet."
                distribution={metrics.pendingPlanDistribution}
                total={metrics.pendingSubscriptionsCount}
                barClassName="bg-amber-500"
              />
              <PlanDistributionSection
                title="Expired / Stopped Distribution by Plan"
                emptyLabel="No expired or stopped subscription plans yet."
                distribution={metrics.stoppedPlanDistribution}
                total={metrics.stoppedSubscriptionsCount}
                barClassName="bg-red-500"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-foreground">
                  Ending Soon
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => onNavigate("Pending Subscriptions")}
                >
                  View Pending
                </Button>
              </div>
              {metrics.endingSoon.length === 0 ? (
                <EmptyState label="No active subscriptions ending soon." />
              ) : (
                <div className="space-y-2">
                  {metrics.endingSoon.map((subscription) => (
                    <div
                      key={subscription.id}
                      className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {subscription.customer_name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {subscription.plan_name}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0 bg-muted/40">
                        {formatDate(subscription.ends_on)}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function HeroMiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-4 text-center shadow-sm">
      <div className="text-2xl font-black text-foreground">{value}</div>
      <div className="mt-1 text-xs font-medium text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function KpiCard({
  title,
  value,
  helper,
  icon: Icon,
  accent,
}: {
  title: string;
  value: number;
  helper: string;
  icon: typeof Users;
  accent: string;
}) {
  return (
    <Card className="border-border shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <div className="mt-2 text-3xl font-black tracking-tight text-foreground">
              {value}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
          </div>
          <div className={`rounded-xl border p-2.5 ${accent}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function InsightPill({
  label,
  value,
  icon: Icon,
  className,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  className: string;
}) {
  return (
    <div className={`rounded-xl border p-3 ${className}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-semibold">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-black">{value}</div>
    </div>
  );
}

function PlanDistributionSection({
  title,
  emptyLabel,
  distribution,
  total,
  barClassName,
}: {
  title: string;
  emptyLabel: string;
  distribution: [string, number][];
  total: number;
  barClassName: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        <Badge variant="outline" className="bg-muted/40">
          {total} total
        </Badge>
      </div>
      {distribution.length === 0 ? (
        <EmptyState label={emptyLabel} />
      ) : (
        distribution.slice(0, 5).map(([label, value]) => (
          <DistributionRow
            key={label}
            label={label}
            value={value}
            total={total}
            barClassName={barClassName}
          />
        ))
      )}
    </div>
  );
}

function DistributionRow({
  label,
  value,
  total,
  barClassName,
}: {
  label: string;
  value: number;
  total: number;
  barClassName: string;
}) {
  const percent = getPercent(value, total);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="truncate font-medium text-foreground">{label}</span>
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">
          {value} ({percent}%)
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${barClassName}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}
