"use client";

import { useState } from "react";
import TodaysDeliveries from "@/shared/components/admin/operations/TodaysDeliveries";
import PlannedDeliveries from "@/shared/components/admin/operations/PlannedDeliveries";
import DailyMealRoster from "@/shared/components/admin/operations/DailyMealRoster";
import ClinicWorkloadView from "@/shared/components/admin/operations/ClinicWorkloadView";
import LiveRoutingBoard from "@/shared/components/admin/operations/LiveRoutingBoard";
import AdminLiveTracking from "@/shared/components/admin/operations/AdminLiveTracking";
import AutomationLogs from "@/shared/components/admin/operations/AutomationLogs";
import RoutingSandbox from "@/shared/components/admin/operations/RoutingSandbox";
import { ShopOrdersTab } from "@/shared/components/admin/operations/ShopOrdersTab";
import { AdminSubmenuBar } from "../core/AdminSubmenuBar";
import { getSelectableClinics } from "@/actions/admin-actions/clinicSelectorActions";

export default function OperationsDashboard({
  deliveries,
  plannedDeliveries,
  rosterData,
  automationLogs,
  scope,
  shopOrders = [],
}: any) {
  const [activeTab, setActiveTab] = useState("Today's Scheduled");

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-500">
      <AdminSubmenuBar
        tabs={[
          "Today's Scheduled",
          "Planned (Tomorrow)",
          "Live Routing",
          "Daily Meal Roster",
          "Live Tracking",
          "Automation Logs",
          "Shop Orders",
          "Sandbox",
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {activeTab === "Today's Scheduled" && (
        <TodaysDeliveries data={deliveries} />
      )}

      {activeTab === "Planned (Tomorrow)" && (
        <PlannedDeliveries
          data={plannedDeliveries}
          automationLogs={automationLogs}
        />
      )}

      {activeTab === "Live Routing" && (
        <LiveRoutingBoard scope={scope} getClinics={getSelectableClinics} />
      )}

      {activeTab === "Daily Meal Roster" && (
        <div className="space-y-6">
          <ClinicWorkloadView />
          <DailyMealRoster initialRosterData={rosterData} scope={scope} />
        </div>
      )}

      {activeTab === "Live Tracking" && (
        <AdminLiveTracking scope={scope} getClinics={getSelectableClinics} />
      )}

      {activeTab === "Automation Logs" && (
        <AutomationLogs initialLogs={automationLogs} />
      )}

      {activeTab === "Shop Orders" && <ShopOrdersTab shopOrders={shopOrders} />}

      {activeTab === "Sandbox" && (
        <RoutingSandbox scope={scope} getClinics={getSelectableClinics} />
      )}
    </div>
  );
}
