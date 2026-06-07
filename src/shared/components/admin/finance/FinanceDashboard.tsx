"use client";

import { useState } from "react";
import { AdminSubmenuBar } from "@/shared/components/admin/core/AdminSubmenuBar";
import { OverviewTab } from "./OverviewTab";
import { SubscriptionRevenueTab } from "./SubscriptionRevenueTab";
import { RiderPayoutsTab } from "./RiderPayoutsTab";
import { SettingsTab } from "./SettingsTab";

interface FinanceDashboardProps {
  overviewData: any;
  paymentsData: any[];
  ridersData: any[];
  settingsData: any;
}

const TABS = ["Overview", "Subscription Revenue", "Rider Payouts", "Settings"];

export default function FinanceDashboard({
  overviewData,
  paymentsData,
  ridersData,
  settingsData,
}: FinanceDashboardProps) {
  const [activeTab, setActiveTab] = useState("Overview");

  return (
    <div className="space-y-6">
      <AdminSubmenuBar
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {activeTab === "Overview" && <OverviewTab data={overviewData} />}

      {activeTab === "Subscription Revenue" && (
        <SubscriptionRevenueTab initialPayments={paymentsData} />
      )}

      {activeTab === "Rider Payouts" && (
        <RiderPayoutsTab initialRiders={ridersData} />
      )}

      {activeTab === "Settings" && (
        <SettingsTab initialSettings={settingsData} />
      )}
    </div>
  );
}
