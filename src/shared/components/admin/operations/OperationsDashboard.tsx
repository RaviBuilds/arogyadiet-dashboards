"use client";

import { useState } from "react";
import TodaysDeliveries from "@/shared/components/admin/operations/TodaysDeliveries";
import PlannedDeliveries from "@/shared/components/admin/operations/PlannedDeliveries";
import DailyMealRoster from "@/shared/components/admin/operations/DailyMealRoster";
import LiveRoutingBoard from "@/shared/components/admin/operations/LiveRoutingBoard";
import { AdminSubmenu } from "../core/AdminSubmenu";

export default function OperationsDashboard({
  deliveries,
  plannedDeliveries,
  rosterData,
}: any) {
  const [activeTab, setActiveTab] = useState("Today's Scheduled");

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-500">
      <AdminSubmenu
        tabs={[
          "Today's Scheduled",
          "Planned (Tomorrow)",
          "Live Routing",
          "Daily Meal Roster",
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {activeTab === "Today's Scheduled" && (
        <TodaysDeliveries data={deliveries} />
      )}

      {activeTab === "Planned (Tomorrow)" && (
        <PlannedDeliveries data={plannedDeliveries} />
      )}

      {activeTab === "Live Routing" && <LiveRoutingBoard />}

      {activeTab === "Daily Meal Roster" && (
        <DailyMealRoster data={rosterData} /> // Fixed the prop error here!
      )}
    </div>
  );
}
