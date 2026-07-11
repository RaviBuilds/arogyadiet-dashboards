import { redirect } from "next/navigation";

import { getCustomerSession } from "@/lib/customer/get-session";
import { getAddonServiceRequestsAction } from "@/actions/addonServiceActions";
import { AddonServicesClient } from "@/shared/components/customer/addon-services/AddonServicesClient";
import type { AddonServiceRequest } from "@/types/accommodation";

/**
 * Add-on Services Page (Server Component)
 *
 * Displays available wellness service cards and the customer's previously
 * submitted service requests (ordered by timestamp desc).
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 15.5
 */

export const revalidate = 0;

export default async function AddonServicesPage() {
  const { user, customerProfileId, error } = await getCustomerSession();
  if (error || !user) redirect("/login");

  let initialRequests: AddonServiceRequest[] = [];

  if (customerProfileId) {
    const result = await getAddonServiceRequestsAction(customerProfileId);
    if ("success" in result && result.success) {
      initialRequests = result.data.map((row) => ({
        id: row.id,
        customerProfileId: row.customer_profile_id,
        stayEntryId: row.stay_entry_id,
        serviceType: row.service_type,
        status: row.status as AddonServiceRequest["status"],
        requestedAt: row.requested_at,
      }));
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Add-on Services
        </h1>
        <p className="text-sm text-muted-foreground">
          Request additional wellness services to enhance your stay.
        </p>
      </div>

      <AddonServicesClient
        customerProfileId={customerProfileId}
        initialRequests={initialRequests}
      />
    </div>
  );
}
