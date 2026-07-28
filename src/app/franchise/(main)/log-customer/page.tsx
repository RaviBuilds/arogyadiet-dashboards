// src/app/franchise/(main)/log-customer/page.tsx
// Franchise Portal — the Dietitian's Log Customer workspace (dietitian-management
// — Task 13.1, Req 23.4, 23.5).
//
// Server Component: guards the page to an active Franchise Dietitian via
// `guardDietitianPage("/franchise")` (redirects any other caller to
// `/unauthorized`, mirroring the admin equivalent), then renders the shared,
// portal-neutral `LogCustomerList` wired to `listDietitianCustomers` and a
// Customer_360 row href under `/customers/[id]`.
//
// Imports nothing from `src/app/admin` (Req 23.7) — only shared, portal-neutral
// modules (`src/lib`, `src/shared`, `src/actions/dietitian-actions`).

import { guardDietitianPage } from "@/lib/auth/adminAccess";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import { LogCustomerList } from "@/shared/components/dietitian/LogCustomerList";
import { listDietitianCustomers } from "@/actions/dietitian-actions/dietitianCustomerActions";
import { ClipboardList } from "lucide-react";

export const revalidate = false;

export default async function FranchiseLogCustomerPage() {
  await guardDietitianPage("/franchise");

  return (
    <div className="flex flex-col gap-6 pb-4">
      <PageHeader
        title="Log Customer"
        subtitle="Find a customer in your scope and record today's health log."
        icon={ClipboardList}
      />
      <LogCustomerList
        listAction={listDietitianCustomers}
        hrefPrefix="/log-customer"
      />
    </div>
  );
}
