"use client";

import { useState } from "react";
import { Clock, CheckCircle2, Info } from "lucide-react";

import { AdminSubmenuBar } from "@/shared/components/admin/core/AdminSubmenuBar";
import TodaysDeliveries from "@/shared/components/admin/operations/TodaysDeliveries";
import PlannedDeliveries from "@/shared/components/admin/operations/PlannedDeliveries";
import LiveRoutingBoard from "@/shared/components/admin/operations/LiveRoutingBoard";
import DailyMealRoster from "@/shared/components/admin/operations/DailyMealRoster";
import AdminLiveTracking from "@/shared/components/admin/operations/AdminLiveTracking";
import RoutingSandbox from "@/shared/components/admin/operations/RoutingSandbox";
import FailedDeliveryApprovals from "@/shared/components/admin/operations/FailedDeliveryApprovals";
import type {
  AutomationLogRow,
  PendingFailureApprovalRow,
} from "@/actions/admin-actions/operationsActions";
import {
  franchiseUpdateOrderStatusAction,
  franchiseMarkBatchPickedUpAction,
  franchiseApproveFailedDeliveryAction,
  franchiseRejectFailedDeliveryAction,
  revalidateFranchiseOperationsPage,
  franchiseDeletePlannedOrder,
  franchiseUpdateOrderMeal,
  franchiseGetAddressesForOrder,
  franchiseUpdateOrderAddress,
  franchiseGetRoutingData,
  franchiseCommitRouteChanges,
  franchiseGetFixedAssignments,
  franchiseGetAssignableRiders,
  franchiseSearchCustomers,
  franchiseUpsertFixedAssignment,
  franchiseRemoveFixedAssignment,
  franchiseFetchRosterData,
  franchiseGetLiveTrackingRiders,
  franchiseGetLiveTrackingData,
  franchiseGetSandboxMeta,
  franchiseGetSandboxRiders,
  franchiseGetSandboxRiderRoute,
} from "@/actions/franchise-actions/franchiseOperationsActions";

interface Props {
  franchiseId: string;
  todayDeliveries: any[];
  plannedDeliveries: any[];
  rosterData: any[];
  automationLogs: AutomationLogRow[];
  pendingFailures: PendingFailureApprovalRow[];
}

const AUTOMATION_DISPLAY: { type: string; label: string; desc: string }[] = [
  { type: "ORDER_GEN", label: "Order Creation", desc: "Daily delivery orders from active subscriptions (5:15 PM IST)." },
  { type: "PRODUCT_LINK", label: "Product Linking", desc: "Attaches paid add-on shop products to delivery meals." },
  { type: "ROUTING", label: "Routing & Batching", desc: "Creates rider batches and delivery sequences." },
];

const AUTOMATION_ALIASES: Record<string, string> = {
  ORDER_GEN: "ORDER_GEN",
  PRODUCT_LINK: "PRODUCT_LINK",
  PRODUCT_LINKING: "PRODUCT_LINK",
  ROUTING: "ROUTING",
};

function formatRunTime(dateStr?: string | null) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Read-only "good to know" panel: shows when each central automation last ran.
 * Franchise owners do not run automations — these are managed centrally.
 */
function AutomationInfo({ logs }: { logs: AutomationLogRow[] }) {
  const latestByType = new Map<string, AutomationLogRow>();
  for (const log of logs) {
    const canonical = AUTOMATION_ALIASES[log.automation_type];
    if (!canonical) continue;
    const existing = latestByType.get(canonical);
    const existingTime = existing?.last_run_at
      ? new Date(existing.last_run_at).getTime()
      : 0;
    const currentTime = log.last_run_at ? new Date(log.last_run_at).getTime() : 0;
    if (!existing || currentTime >= existingTime) latestByType.set(canonical, log);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 rounded-2xl border border-amber-200/70 bg-amber-50/70 px-4 py-3">
        <Info className="h-4 w-4 text-amber-600 shrink-0" />
        <p className="text-xs text-amber-800">
          System automations are managed centrally by the Admin team. This is a
          read-only status of when each automation last completed successfully.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {AUTOMATION_DISPLAY.map((a) => {
          const log = latestByType.get(a.type);
          const runTime = formatRunTime(log?.last_run_at);
          return (
            <div
              key={a.type}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                {a.label}
              </p>
              <p className="mt-1 text-xs text-slate-500">{a.desc}</p>
              <div
                className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                  runTime
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-slate-50 text-slate-500"
                }`}
              >
                {runTime ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span>
                      Last run {runTime} IST
                      {log?.target_date ? ` · for ${log.target_date}` : ""}
                    </span>
                  </>
                ) : (
                  <>
                    <Clock className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    <span>No recent run recorded</span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TABS = [
  "Today's Scheduled",
  "Planned (Tomorrow)",
  "Live Routing",
  "Daily Meal Roster",
  "Live Tracking",
  "Sandbox",
];

export default function FranchiseOperationsClient({
  franchiseId,
  todayDeliveries,
  plannedDeliveries,
  rosterData,
  automationLogs,
  pendingFailures,
}: Props) {
  const [activeTab, setActiveTab] = useState("Today's Scheduled");

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-500">
      <AdminSubmenuBar
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {activeTab === "Today's Scheduled" && (
        <div className="space-y-8">
          <TodaysDeliveries
            data={todayDeliveries}
            onUpdateStatus={franchiseUpdateOrderStatusAction}
            onMarkBatchPickup={franchiseMarkBatchPickedUpAction}
            onRevalidate={revalidateFranchiseOperationsPage}
          />
          {pendingFailures.length > 0 && (
            <FailedDeliveryApprovals
              approvals={pendingFailures}
              onApprove={franchiseApproveFailedDeliveryAction}
              onReject={franchiseRejectFailedDeliveryAction}
            />
          )}
        </div>
      )}

      {activeTab === "Planned (Tomorrow)" && (
        <div className="space-y-8">
          <AutomationInfo logs={automationLogs} />
          <PlannedDeliveries
            data={plannedDeliveries}
            showAutomationControl={false}
            onDeleteOrder={franchiseDeletePlannedOrder}
            onUpdateMeal={franchiseUpdateOrderMeal}
            onGetAddresses={franchiseGetAddressesForOrder}
            onUpdateAddress={franchiseUpdateOrderAddress}
            onRevalidate={revalidateFranchiseOperationsPage}
          />
        </div>
      )}

      {activeTab === "Live Routing" && (
        <LiveRoutingBoard
          getData={franchiseGetRoutingData}
          commit={franchiseCommitRouteChanges}
          fixedAssignmentsProps={{
            getAssignments: franchiseGetFixedAssignments,
            getRiders: franchiseGetAssignableRiders,
            searchCustomers: franchiseSearchCustomers,
            upsert: franchiseUpsertFixedAssignment,
            remove: franchiseRemoveFixedAssignment,
          }}
        />
      )}

      {activeTab === "Daily Meal Roster" && (
        <DailyMealRoster
          initialRosterData={rosterData}
          scope={franchiseId}
          onFetchRoster={franchiseFetchRosterData}
        />
      )}

      {activeTab === "Live Tracking" && (
        <AdminLiveTracking
          getRiders={franchiseGetLiveTrackingRiders}
          getTrackingData={franchiseGetLiveTrackingData}
        />
      )}

      {activeTab === "Sandbox" && (
        <RoutingSandbox
          getMeta={franchiseGetSandboxMeta}
          getRiders={franchiseGetSandboxRiders}
          getRiderRoute={franchiseGetSandboxRiderRoute}
        />
      )}
    </div>
  );
}
