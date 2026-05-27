import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import UserManagement from "@/shared/components/master/UserManagement";
import { getAdminUsers } from "@/actions/master-actions/adminActions";

export const revalidate = 0;

export default async function UserManagementPage() {
  const admins = await getAdminUsers();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="User Management"
        description="Manage admin accounts — create, edit, activate, or remove admin users."
      />
      <UserManagement initialAdmins={admins} />
    </div>
  );
}
