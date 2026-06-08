"use client";

import { useState } from "react";
import TodaysDeliveries from "@/shared/components/admin/operations/TodaysDeliveries";
import PlannedDeliveries from "@/shared/components/admin/operations/PlannedDeliveries";
import DailyMealRoster from "@/shared/components/admin/operations/DailyMealRoster";
import LiveRoutingBoard from "@/shared/components/admin/operations/LiveRoutingBoard";
import AdminLiveTracking from "@/shared/components/admin/operations/AdminLiveTracking";
import AutomationLogs from "@/shared/components/admin/operations/AutomationLogs";
import RoutingSandbox from "@/shared/components/admin/operations/RoutingSandbox";
import { AdminSubmenuBar } from "../core/AdminSubmenuBar";

export default function OperationsDashboard({
  deliveries,
  plannedDeliveries,
  rosterData,
  automationLogs,
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

      {activeTab === "Live Routing" && <LiveRoutingBoard />}

      {activeTab === "Daily Meal Roster" && (
        <DailyMealRoster initialRosterData={rosterData} />
      )}

      {activeTab === "Live Tracking" && <AdminLiveTracking />}

      {activeTab === "Automation Logs" && (
        <AutomationLogs initialLogs={automationLogs} />
      )}

      {activeTab === "Sandbox" && <RoutingSandbox />}
    </div>
  );
}
