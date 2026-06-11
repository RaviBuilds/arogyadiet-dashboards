"use client";

import { useState, useEffect, useTransition, useRef } from "react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
} from "recharts";
import { Leaf, CreditCard, PauseCircle, Eye } from "lucide-react";
import {
  getDietaryPreferenceSplit,
  getPlanPopularity,
  getPauseCreditUtilization,
} from "@/actions/master-actions/biGrowthActions";
import {
  getMasterCustomerList,
} from "@/actions/master-actions/customerReportActions";
import type {
  DietaryPieSlice,
  PlanPopularityBar,
  PauseCreditRadial,
} from "@/types/bi-dashboard";
import type { MasterCustomerRow } from "@/actions/master-actions/customerReportActions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import {
  BiDateFilter,
  BiDownloadButton,
  getDefaultBiDateRange,
  type BiDateRange,
} from "@/shared/components/bi";

const PIE_COLORS = ["#059669", "#dc2626", "#f59e0b", "#6366f1", "#8b5cf6", "#06b6d4"];

export default function GrowthShell() {
  const [dietary, setDietary] = useState<DietaryPieSlice[]>([]);
  const [plans, setPlans] = useState<PlanPopularityBar[]>([]);
  const [pauseCredit, setPauseCredit] = useState<PauseCreditRadial | null>(null);
  const [isPending, startTransition] = useTransition();
  const [dateRange, setDateRange] = useState<BiDateRange>(getDefaultBiDateRange());
  const dietaryChartRef = useRef<HTMLDivElement>(null);
  const plansChartRef = useRef<HTMLDivElement>(null);
  const pauseChartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startTransition(async () => {
      const [dietaryData, planData, pauseData] = await Promise.all([
        getDietaryPreferenceSplit(dateRange.from, dateRange.to),
        getPlanPopularity(dateRange.from, dateRange.to),
        getPauseCreditUtilization(dateRange.from, dateRange.to),
      ]);
      setDietary(dietaryData);
      setPlans(planData);
      setPauseCredit(pauseData);
    });
  }, [dateRange]);

  if (!pauseCredit) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 animate-pulse">
        <div className="h-80 rounded-2xl bg-slate-100 border border-slate-200" />
        <div className="h-80 rounded-2xl bg-slate-100 border border-slate-200" />
        <div className="h-80 rounded-2xl bg-slate-100 border border-slate-200" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Date Filter - Right aligned */}
      <div className="flex items-center justify-end gap-3">
        {isPending && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <div className="h-3 w-3 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
            Loading...
          </div>
        )}
        <BiDateFilter value={dateRange} onChange={setDateRange} />
      </div>

      {/* Top Row: Pie + Bar + Radial */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Dietary Preferences Pie */}
        <div ref={dietaryChartRef} className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Leaf className="h-4 w-4 text-emerald-600" />
              <h3 className="text-sm font-semibold text-slate-800">Dietary Preferences</h3>
            </div>
            <BiDownloadButton
              data={dietary.map((d) => ({ Preference: d.name, Count: d.value }))}
              fileName="dietary_preferences"
              chartRef={dietaryChartRef}
            />
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={dietary}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  innerRadius={45}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {dietary.map((_, idx) => (
                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    borderRadius: "12px",
                    border: "1px solid #e2e8f0",
                    fontSize: "12px",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* Legend */}
          <div className="mt-2 space-y-1.5">
            {dietary.slice(0, 5).map((item, idx) => (
              <div key={item.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                  />
                  <span className="text-slate-600">{item.name}</span>
                </div>
                <span className="font-semibold text-slate-800">{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Plan Popularity Bar */}
        <div ref={plansChartRef} className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-red-600" />
              <h3 className="text-sm font-semibold text-slate-800">Plan Popularity</h3>
            </div>
            <BiDownloadButton
              data={plans.map((d) => ({ Plan: d.plan, Subscriptions: d.count }))}
              fileName="plan_popularity"
              chartRef={plansChartRef}
            />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={plans} layout="vertical" barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="plan"
                  tick={{ fontSize: 11, fill: "#334155" }}
                  axisLine={false}
                  tickLine={false}
                  width={100}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: "12px",
                    border: "1px solid #e2e8f0",
                    fontSize: "12px",
                  }}
                />
                <Bar
                  dataKey="count"
                  name="Subscriptions"
                  fill="#dc2626"
                  radius={[0, 6, 6, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Pause Credit Radial */}
        <div ref={pauseChartRef} className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <PauseCircle className="h-4 w-4 text-amber-600" />
              <h3 className="text-sm font-semibold text-slate-800">Pause Credit Utilization</h3>
            </div>
            <BiDownloadButton
              data={[{
                Allocated: pauseCredit.allocated,
                Consumed: pauseCredit.consumed,
                "Utilization %": pauseCredit.utilizationPercent,
              }]}
              fileName="pause_credit_utilization"
              chartRef={pauseChartRef}
            />
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                cx="50%"
                cy="50%"
                innerRadius="60%"
                outerRadius="90%"
                data={[
                  {
                    name: "Consumed",
                    value: pauseCredit.utilizationPercent,
                    fill: "#f59e0b",
                  },
                ]}
                startAngle={180}
                endAngle={0}
              >
                <RadialBar
                  dataKey="value"
                  cornerRadius={10}
                  background={{ fill: "#f1f5f9" }}
                />
              </RadialBarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-center -mt-8">
            <p className="text-3xl font-bold text-slate-800">
              {pauseCredit.utilizationPercent}%
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {pauseCredit.consumed.toLocaleString("en-IN")} of{" "}
              {pauseCredit.allocated.toLocaleString("en-IN")} credits used
            </p>
          </div>
        </div>
      </div>

      {/* On-Demand: View Raw Customer Data */}
      <div className="flex justify-end">
        <RawCustomerDataDialog />
      </div>
    </div>
  );
}

// ─── Raw Data Dialog (On-Demand) ───────────────

function RawCustomerDataDialog() {
  const [customers, setCustomers] = useState<MasterCustomerRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const handleOpen = async (open: boolean) => {
    if (open && !loaded) {
      setIsLoading(true);
      const data = await getMasterCustomerList();
      setCustomers(data);
      setIsLoading(false);
      setLoaded(true);
    }
  };

  return (
    <Dialog onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 border-slate-200">
          <Eye className="h-3.5 w-3.5" />
          View Raw Customer Data
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Customer Data (Raw)</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="h-6 w-6 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Email</TableHead>
                <TableHead className="text-xs">Diet</TableHead>
                <TableHead className="text-xs text-center">Subs</TableHead>
                <TableHead className="text-xs text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.slice(0, 100).map((c) => (
                <TableRow key={c.profileId}>
                  <TableCell className="text-sm font-medium">{c.fullName}</TableCell>
                  <TableCell className="text-sm text-slate-600">{c.email}</TableCell>
                  <TableCell className="text-sm">{c.dietaryPreference || "—"}</TableCell>
                  <TableCell className="text-sm text-center">{c.totalSubscriptions}</TableCell>
                  <TableCell className="text-center">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        c.isActive ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                      }`}
                    >
                      {c.isActive ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
