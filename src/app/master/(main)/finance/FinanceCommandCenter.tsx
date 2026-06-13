"use client";

import { useState, useEffect, useTransition } from "react";
import { IndianRupee, Truck } from "lucide-react";
import {
  getFinanceOverview,
  getSubscriptionPayments,
  getAllRidersWithEarnings,
  getSystemSettings,
} from "@/actions/admin-actions/financeActions";
import { SubscriptionRevenueView } from "./SubscriptionRevenueView";
import { RiderPayoutsView } from "./RiderPayoutsView";

export default function FinanceCommandCenter() {
  const [tab, setTab] = useState<"revenue" | "payouts">("revenue");
  const [overviewData, setOverviewData] = useState<any>(null);
  const [paymentsData, setPaymentsData] = useState<any[]>([]);
  const [ridersData, setRidersData] = useState<any[]>([]);
  const [settingsData, setSettingsData] = useState<any>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const [overview, payments, riders, settings] = await Promise.all([
        getFinanceOverview(),
        getSubscriptionPayments(),
        getAllRidersWithEarnings(),
        getSystemSettings(),
      ]);
      setOverviewData(overview);
      setPaymentsData(payments);
      setRidersData(riders);
      setSettingsData(settings);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabBar = (
    <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50/60 p-1 w-fit">
      <TabButton
        active={tab === "revenue"}
        onClick={() => setTab("revenue")}
        icon={<IndianRupee className="h-3.5 w-3.5" />}
        label="Subscription Revenue"
      />
      <TabButton
        active={tab === "payouts"}
        onClick={() => setTab("payouts")}
        icon={<Truck className="h-3.5 w-3.5" />}
        label="Rider Payouts"
      />
    </div>
  );

  if (!overviewData) {
    return (
      <div className="space-y-6">
        {tabBar}
        <div className="space-y-6 animate-pulse">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-24 rounded-2xl bg-slate-100 border border-slate-200"
              />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-72 rounded-2xl bg-slate-100 border border-slate-200"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {tabBar}

      {tab === "revenue" && (
        <SubscriptionRevenueView
          overviewData={overviewData}
          initialPayments={paymentsData}
        />
      )}

      {tab === "payouts" && (
        <RiderPayoutsView
          overviewData={overviewData}
          initialRiders={ridersData}
          settingsData={settingsData}
        />
      )}
    </div>
  );
}

// ─── Pill Tab Button (matches Inventory Intelligence pattern) ──────────

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-all ${
        active
          ? "bg-slate-900 text-white shadow-sm"
          : "text-slate-600 hover:bg-white hover:text-slate-900"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
