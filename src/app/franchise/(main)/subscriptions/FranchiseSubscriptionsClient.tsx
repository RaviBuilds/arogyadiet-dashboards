"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/shared/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Input } from "@/shared/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import {
  CreditCard,
  Search,
  Users,
  Clock,
  CheckCircle2,
  XCircle,
  Info,
} from "lucide-react";
import { StatCard, SectionCard } from "@/shared/components/franchise/ui/GlassCard";

interface SubRow {
  id: string;
  customer_name: string;
  email: string;
  mobile: string;
  plan_name: string;
  total_days: number;
  starts_on: string;
  ends_on: string;
  pause_credits_total: number;
  pause_credits_used: number;
  status: string;
}

interface Plan {
  id: string;
  name: string;
  code: string;
  duration_days: number;
  price: number;
  pause_credits: number;
  is_active: boolean;
}

interface Props {
  plans: Plan[];
  activeSubscriptions: SubRow[];
  pendingSubscriptions: SubRow[];
  stoppedSubscriptions: SubRow[];
}

export default function FranchiseSubscriptionsClient({
  plans,
  activeSubscriptions,
  pendingSubscriptions,
  stoppedSubscriptions,
}: Props) {
  const [search, setSearch] = useState("");

  const filterSubs = (subs: SubRow[]) => {
    if (!search) return subs;
    const term = search.toLowerCase();
    return subs.filter(
      (s) =>
        s.customer_name.toLowerCase().includes(term) ||
        s.email.toLowerCase().includes(term) ||
        s.plan_name.toLowerCase().includes(term)
    );
  };

  const filteredActive = useMemo(() => filterSubs(activeSubscriptions), [search, activeSubscriptions]);
  const filteredPending = useMemo(() => filterSubs(pendingSubscriptions), [search, pendingSubscriptions]);
  const filteredStopped = useMemo(() => filterSubs(stoppedSubscriptions), [search, stoppedSubscriptions]);

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
        <StatCard icon={CheckCircle2} label="Active" value={activeSubscriptions.length} accent="text-emerald-600" accentBg="bg-emerald-50" />
        <StatCard icon={Clock} label="Pending" value={pendingSubscriptions.length} accent="text-blue-600" accentBg="bg-blue-50" />
        <StatCard icon={XCircle} label="Expired / Stopped" value={stoppedSubscriptions.length} accent="text-rose-600" accentBg="bg-rose-50" />
        <StatCard icon={CreditCard} label="Available Plans" value={plans.length} accent="text-violet-600" accentBg="bg-violet-50" />
      </div>

      {/* Plans Display (read-only) */}
      <SectionCard
        icon={CreditCard}
        title="Available Subscription Plans"
        subtitle={`${plans.length} active plans`}
        actions={
          <Badge variant="outline" className="rounded-lg text-[10px]">
            Managed by Admin
          </Badge>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="rounded-xl bg-white/60 p-4 ring-1 ring-slate-100 transition-all hover:ring-slate-200"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-800">{plan.name}</h3>
                <Badge variant="outline" className="rounded-lg text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                  Active
                </Badge>
              </div>
              <p className="text-2xl font-semibold tracking-tight text-primary">
                ₹{plan.price?.toLocaleString() ?? "0"}
                <span className="text-xs font-normal text-slate-400 ml-1">
                  /{plan.duration_days} days
                </span>
              </p>
              <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                <span>✓ {plan.duration_days} Delivery Days</span>
                <span>⏸ {plan.pause_credits} Pauses</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
          <Info className="h-3.5 w-3.5" />
          Subscription plans are centrally managed. Contact admin to request changes.
        </div>
      </SectionCard>

      {/* Subscription Tables */}
      <SectionCard
        icon={Users}
        title="Customer Subscriptions"
        subtitle={`${filteredActive.length + filteredPending.length + filteredStopped.length} total`}
        actions={
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              placeholder="Search by name, email, or plan..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 rounded-xl border-slate-200/80 bg-white/60 pl-9 text-sm shadow-sm"
            />
          </div>
        }
        note={
          <p className="text-xs text-slate-400">
            To add a new subscription, go to Customers → select a customer → Add Subscription.
          </p>
        }
      >
        <Tabs defaultValue="active" className="w-full">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="active">Active ({filteredActive.length})</TabsTrigger>
            <TabsTrigger value="pending">Pending ({filteredPending.length})</TabsTrigger>
            <TabsTrigger value="stopped">Expired / Stopped ({filteredStopped.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-4">
            <SubTable subs={filteredActive} />
          </TabsContent>
          <TabsContent value="pending" className="mt-4">
            <SubTable subs={filteredPending} />
          </TabsContent>
          <TabsContent value="stopped" className="mt-4">
            <SubTable subs={filteredStopped} />
          </TabsContent>
        </Tabs>
      </SectionCard>
    </div>
  );
}

function SubTable({ subs }: { subs: SubRow[] }) {
  if (subs.length === 0) {
    return <p className="text-sm text-slate-400 py-12 text-center">No subscriptions found.</p>;
  }

  return (
    <div className="overflow-auto rounded-xl ring-1 ring-slate-100">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50/60 hover:bg-slate-50/60">
            <TableHead className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Customer</TableHead>
            <TableHead className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Plan</TableHead>
            <TableHead className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Duration</TableHead>
            <TableHead className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Period</TableHead>
            <TableHead className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Pause Credits</TableHead>
            <TableHead className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {subs.map((sub) => (
            <TableRow key={sub.id} className="border-slate-100 transition-colors hover:bg-slate-50/40">
              <TableCell>
                <div>
                  <p className="text-sm font-medium text-slate-800">{sub.customer_name}</p>
                  <p className="text-[11px] text-slate-400">{sub.email}</p>
                </div>
              </TableCell>
              <TableCell className="text-sm text-slate-600">{sub.plan_name}</TableCell>
              <TableCell className="text-sm text-slate-600">{sub.total_days} days</TableCell>
              <TableCell className="text-xs text-slate-500">
                {sub.starts_on ? new Date(sub.starts_on).toLocaleDateString("en-IN") : "—"}
                {" → "}
                {sub.ends_on ? new Date(sub.ends_on).toLocaleDateString("en-IN") : "—"}
              </TableCell>
              <TableCell className="text-xs text-slate-600">
                {sub.pause_credits_used}/{sub.pause_credits_total} used
              </TableCell>
              <TableCell>
                <StatusBadge status={sub.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
    PENDING: "bg-blue-50 text-blue-700 border-blue-200",
    STOPPED: "bg-rose-50 text-rose-700 border-rose-200",
    CANCELLED: "bg-rose-50 text-rose-700 border-rose-200",
    EXPIRED: "bg-slate-100 text-slate-600 border-slate-200",
  };

  return (
    <Badge variant="outline" className={`rounded-lg text-[10px] ${colors[status] ?? "text-slate-500"}`}>
      {status}
    </Badge>
  );
}
