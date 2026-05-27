import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import ActivityLogs from "@/shared/components/master/ActivityLogs";
import { getAdminActivityLogs } from "@/actions/master-actions/logActions";

export const revalidate = 0;

export default async function LogsPage() {
  const logs = await getAdminActivityLogs();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Activity Logs"
        description="Audit trail of all create, update, and delete actions performed from the admin dashboard."
      />
      <ActivityLogs initialLogs={logs} />
    </div>
  );
}
