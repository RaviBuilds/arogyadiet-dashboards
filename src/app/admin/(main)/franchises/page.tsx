import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import FranchiseOversight from "@/shared/components/admin/FranchiseOversight";

export const revalidate = 0;

export default function AdminFranchisesPage() {
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Franchise Pincodes"
        description="Manage service area pincodes for franchises. Assign, remove, and resolve conflicts."
      />
      <FranchiseOversight />
    </div>
  );
}
