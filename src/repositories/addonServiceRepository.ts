// src/repositories/addonServiceRepository.ts
// Data-access layer for addon wellness service requests.
//
// LAYERING: Data-access ONLY. This module performs all Supabase reads/writes
// for add-on service request operations. It applies NO business validation
// (that lives in `src/services/AccommodationService.ts`) and contains NO
// `'use server'` wrappers (those live in `src/actions/*`). Uses the
// service-role admin client, mirroring the kitLifecycleRepository pattern.
//
// Requirements: 11.2, 11.3

import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of an addon_service_requests row in the database (snake_case). */
export interface AddonServiceRequestRow {
  id: string;
  customer_profile_id: string;
  stay_entry_id: string;
  service_type: string;
  status: string;
  requested_at: string;
  updated_at: string;
}

/** Input for creating a new addon service request. */
export interface CreateServiceRequestInput {
  customerProfileId: string;
  stayEntryId: string;
  serviceType: string;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Insert a new addon service request with PENDING status.
 *
 * Returns the created row.
 *
 * Req 11.2
 */
export async function createServiceRequest(
  input: CreateServiceRequestInput
): Promise<AddonServiceRequestRow> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("addon_service_requests")
    .insert({
      customer_profile_id: input.customerProfileId,
      stay_entry_id: input.stayEntryId,
      service_type: input.serviceType,
      status: "PENDING",
    })
    .select(
      "id, customer_profile_id, stay_entry_id, service_type, status, requested_at, updated_at"
    )
    .single();

  if (error) {
    throw new Error(
      `Failed to create addon service request: ${error.message}`
    );
  }

  return data as AddonServiceRequestRow;
}

/**
 * Update the status of an addon service request.
 *
 * Accepts only "CONFIRMED" or "COMPLETED" as valid target statuses.
 *
 * Req 11.3
 */
export async function updateServiceStatus(
  requestId: string,
  status: "CONFIRMED" | "COMPLETED"
): Promise<AddonServiceRequestRow> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("addon_service_requests")
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .select(
      "id, customer_profile_id, stay_entry_id, service_type, status, requested_at, updated_at"
    )
    .single();

  if (error) {
    throw new Error(
      `Failed to update addon service request ${requestId} to ${status}: ${error.message}`
    );
  }

  return data as AddonServiceRequestRow;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Get all addon service requests for a customer, ordered by requested_at desc.
 *
 * Req 11.3
 */
export async function getServiceRequests(
  customerProfileId: string
): Promise<AddonServiceRequestRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("addon_service_requests")
    .select(
      "id, customer_profile_id, stay_entry_id, service_type, status, requested_at, updated_at"
    )
    .eq("customer_profile_id", customerProfileId)
    .order("requested_at", { ascending: false });

  if (error) {
    throw new Error(
      `Failed to get addon service requests for ${customerProfileId}: ${error.message}`
    );
  }

  return (data ?? []) as AddonServiceRequestRow[];
}
