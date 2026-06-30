import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import FranchiseOversight from "@/shared/components/admin/FranchiseOversight";
import FranchisePincodeRequests from "@/shared/components/admin/FranchisePincodeRequests";
import { guardAdminGroup } from "@/lib/auth/adminAccess";

export const revalidate = 0;

export default async function AdminFranchisesPage() {
  await guardAdminGroup("franchises");
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Franchise Pincodes"
        description="Manage service area pincodes for franchises. Assign, remove, and resolve conflicts."
      />
      <FranchisePincodeRequests />
      <FranchiseOversight />
    </div>
  );
}
