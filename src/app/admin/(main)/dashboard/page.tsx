import ExecutiveDashboard from "@/shared/components/admin/dashboard/ExecutiveDashboard";
import ConflictClinicList from "@/shared/components/admin/dashboard/ConflictClinicList";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { getExecutiveSummary } from "@/services/dashboardMetrics";
import { getCurrentAdminContext } from "@/lib/auth/adminAccess";

export const revalidate = 0;

// Roles permitted to view the Conflict_Clinic_List (Req 22.7). The server
// action enforces this too; the page-level check is defense-in-depth that
// keeps the surface (and its fetch) off the dashboard for other roles.
const CONFLICT_LIST_ROLES = new Set(["ADMIN", "MASTER_ADMIN"]);

export default async function AdminDashboardPage() {
  const [summary, { accessLevel, roleCode }] = await Promise.all([
    getExecutiveSummary(),
    getCurrentAdminContext(),
  ]);

  const canViewConflicts = roleCode != null && CONFLICT_LIST_ROLES.has(roleCode);

  return (
    <div className="flex animate-in fade-in flex-col gap-6 pb-2 duration-500">
      <AdminPageHeader
        title="Executive Overview"
        description="Real-time pulse across customers, subscriptions, operations, and inventory."
      />
      <ExecutiveDashboard data={summary} accessLevel={accessLevel} />
      {canViewConflicts && <ConflictClinicList />}
    </div>
  );
}
