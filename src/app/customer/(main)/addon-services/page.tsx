import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";

import { getCustomerSession } from "@/lib/customer/get-session";
import { getAddonServiceRequestsAction } from "@/actions/addonServiceActions";
import { getActiveStayAction } from "@/actions/stayActions";
import { AddonServicesClient } from "@/shared/components/customer/addon-services/AddonServicesClient";
import { IconChip } from "@/shared/components/customer/profile-ui/IconChip";
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
  let hasActiveStay = false;

  if (customerProfileId) {
    const [requestsResult, stayResult] = await Promise.all([
      getAddonServiceRequestsAction(customerProfileId),
      getActiveStayAction(customerProfileId),
    ]);

    if ("success" in requestsResult && requestsResult.success) {
      initialRequests = requestsResult.data.map((row) => ({
        id: row.id,
        customerProfileId: row.customer_profile_id,
        stayEntryId: row.stay_entry_id,
        serviceType: row.service_type,
        status: row.status as AddonServiceRequest["status"],
        requestedAt: row.requested_at,
      }));
    }

    // getActiveStayAction falls back to the earliest PENDING stay when
    // there's no ACTIVE one — add-on services are only available once the
    // stay has actually started, and stop being available once the
    // customer checks out (FINISHED) or is marked a no-show (EXPIRED).
    hasActiveStay =
      "success" in stayResult &&
      stayResult.success &&
      stayResult.data?.status === "ACTIVE";
  }

  return (
    <div className="relative z-10 mx-auto max-w-5xl space-y-6 sm:space-y-8">
      {/* Page header — same tone-tinted IconChip-beside-title convention used
          on every other customer page (Stay History, Kit History, Health
          Report) rather than a bare heading. */}
      <div
        className="reveal-rise flex items-start gap-3"
        style={{ ["--reveal-delay" as string]: "150ms" }}
      >
        <IconChip icon={Sparkles} tone="amber" size="lg" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Add-on Services
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Request additional wellness services to enhance your stay.
          </p>
        </div>
      </div>

      <AddonServicesClient
        customerProfileId={customerProfileId}
        initialRequests={initialRequests}
        hasActiveStay={hasActiveStay}
      />
    </div>
  );
}
