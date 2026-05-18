"use client";

import { useState } from "react";
import {
  CustomerClientTable,
  Customer,
} from "@/shared/components/admin/customers/CustomerClientTable";
import { AdminSubmenu } from "../core/AdminSubmenu";

interface CustomerDashboardProps {
  customers: Customer[];
}

export default function CustomerDashboard({
  customers,
}: CustomerDashboardProps) {
  const [activeTab, setActiveTab] = useState("All Customers");

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-500">
      <AdminSubmenu
        tabs={["All Customers", "Active Subscriptions", "Archived"]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {activeTab === "All Customers" && (
        <CustomerClientTable data={customers} />
      )}

      {activeTab === "Active Subscriptions" && (
        <div className="text-center py-12 text-muted-foreground bg-card border rounded-md shadow-sm">
          Active subscriptions view will be built here.
        </div>
      )}

      {activeTab === "Archived" && (
        <div className="text-center py-12 text-muted-foreground bg-card border rounded-md shadow-sm">
          Archived customers view will be built here.
        </div>
      )}
    </div>
  );
}
