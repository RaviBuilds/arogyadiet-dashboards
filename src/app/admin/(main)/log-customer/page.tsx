// src/app/admin/(main)/log-customer/page.tsx
// Admin Portal — the Dietitian's Log Customer workspace (dietitian-management
// — Task 12.1, Req 5.4, 15.3, 19.1).
//
// Server Component: guards the page to an active Core_Business Dietitian via
// `guardDietitianPage("/admin")` (redirects any other caller to
// `/unauthorized`, mirroring every other Dietitian-only page), then renders
// the shared, portal-neutral `LogCustomerList` wired to
// `listDietitianCustomers` and a Customer_360 row href under `/customers/[id]`.

import { guardDietitianPage } from "@/lib/auth/adminAccess";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { LogCustomerList } from "@/shared/components/dietitian/LogCustomerList";
import { listDietitianCustomers } from "@/actions/dietitian-actions/dietitianCustomerActions";

export const revalidate = false;

export default async function AdminLogCustomerPage() {
  await guardDietitianPage("/admin");

  return (
    <div className="flex flex-col gap-6 pb-4">
      <AdminPageHeader
        title="Log Customer"
        description="Find a customer in your scope and record today's health log."
      />
      <LogCustomerList
        listAction={listDietitianCustomers}
        hrefPrefix="/log-customer"
      />
    </div>
  );
}
