"use client";

import { useState, useTransition, useEffect } from "react";
import type { DateWindow, KPISummary, CustomerSegmentData, RiderSegmentData, OperationsSegmentData } from "@/types/dashboard";
import {
  getKPISummary,
  getCustomerSegmentData,
  getRiderSegmentData,
  getOperationsSegmentData,
} from "@/actions/master-actions/dashboardActions";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import KPIRibbon from "./KPIRibbon";
import CustomerSegment from "./segments/CustomerSegment";
import RiderSegment from "./segments/RiderSegment";
import OperationsSegment from "./segments/OperationsSegment";

const DATE_WINDOWS: { value: DateWindow; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "wow", label: "WoW" },
  { value: "mom", label: "MoM" },
  { value: "yoy", label: "YoY" },
];

type SegmentTab = "customers" | "fleet" | "operations";

export default function DashboardShell() {
  const [dateWindow, setDateWindow] = useState<DateWindow>("mom");
  const [activeSegment, setActiveSegment] = useState<SegmentTab>("customers");
  const [isPending, startTransition] = useTransition();

  const [kpiData, setKpiData] = useState<KPISummary | null>(null);
  const [customerData, setCustomerData] = useState<CustomerSegmentData | null>(null);
  const [riderData, setRiderData] = useState<RiderSegmentData | null>(null);
  const [operationsData, setOperationsData] = useState<OperationsSegmentData | null>(null);

  // Load KPI on window change
  useEffect(() => {
    startTransition(async () => {
      const data = await getKPISummary(dateWindow);
      setKpiData(data);
    });
  }, [dateWindow]);

  // Load segment data on tab change
  useEffect(() => {
    if (activeSegment === "customers" && !customerData) {
      startTransition(async () => {
        const data = await getCustomerSegmentData();
        setCustomerData(data);
      });
    } else if (activeSegment === "fleet" && !riderData) {
      startTransition(async () => {
        const data = await getRiderSegmentData();
        setRiderData(data);
      });
    } else if (activeSegment === "operations" && !operationsData) {
      startTransition(async () => {
        const data = await getOperationsSegmentData();
        setOperationsData(data);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSegment]);

  return (
    <div className="space-y-6">
      {/* Date Window Controls */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-slate-500">Reporting Window:</span>
        <div className="flex gap-1.5">
          {DATE_WINDOWS.map((w) => (
            <button
              key={w.value}
              onClick={() => setDateWindow(w.value)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                dateWindow === w.value
                  ? "bg-slate-900 text-white shadow-sm"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:border-slate-300"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        {isPending && (
          <div className="ml-3 flex items-center gap-2 text-xs text-slate-400">
            <div className="h-3 w-3 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
            Loading...
          </div>
        )}
      </div>

      {/* KPI Ribbon */}
      {kpiData ? (
        <KPIRibbon data={kpiData} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 rounded-2xl bg-slate-100 border border-slate-200" />
          ))}
        </div>
      )}

      {/* Segment Tabs */}
      <Tabs
        value={activeSegment}
        onValueChange={(v) => setActiveSegment(v as SegmentTab)}
      >
        <TabsList className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-xl p-1 h-auto">
          <TabsTrigger
            value="customers"
            className="rounded-lg px-5 py-2.5 text-sm font-medium data-[state=active]:bg-slate-900 data-[state=active]:text-white"
          >
            Customer Intelligence
          </TabsTrigger>
          <TabsTrigger
            value="fleet"
            className="rounded-lg px-5 py-2.5 text-sm font-medium data-[state=active]:bg-slate-900 data-[state=active]:text-white"
          >
            Fleet & Logistics
          </TabsTrigger>
          <TabsTrigger
            value="operations"
            className="rounded-lg px-5 py-2.5 text-sm font-medium data-[state=active]:bg-slate-900 data-[state=active]:text-white"
          >
            Operations & Kitchen
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Segment Content */}
      <div className="min-h-[400px]">
        {activeSegment === "customers" && (
          customerData ? (
            <CustomerSegment data={customerData} />
          ) : (
            <SegmentSkeleton />
          )
        )}
        {activeSegment === "fleet" && (
          riderData ? (
            <RiderSegment data={riderData} />
          ) : (
            <SegmentSkeleton />
          )
        )}
        {activeSegment === "operations" && (
          operationsData ? (
            <OperationsSegment data={operationsData} />
          ) : (
            <SegmentSkeleton />
          )
        )}
      </div>
    </div>
  );
}

function SegmentSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 animate-pulse">
      <div className="h-80 rounded-2xl bg-slate-100 border border-slate-200" />
      <div className="h-80 rounded-2xl bg-slate-100 border border-slate-200" />
    </div>
  );
}
