// src/repositories/dietitian/auditRepository.ts
// Data-access layer for the append-only Log_Audit_Trail
// (`health_log_audit_entries`).
//
// LAYERING: Data-access ONLY. This module performs all Supabase reads/writes
// for the Log_Audit_Trail. It applies NO business validation (that lives in
// `src/services/HealthLogService.ts`) and contains NO `'use server'` wrappers
// (those live in `src/actions/*`). Uses the service-role admin client,
// mirroring `src/repositories/clinic/` and `src/repositories/dietitian/`.
//
// The table itself is append-only at the database layer: a `BEFORE UPDATE OR
// DELETE` trigger raises even for the service-role key (Req 18.7), so this
// module exposes only `insert` and `read` operations by construction — there
// is no `update`/`delete` export to remove.
//
// Requirements: 18.5, 18.6, 18.8

import { createAdminClient } from "@/lib/supabase/admin";
import type { AuditEntry } from "@/types/dietitian";

const AUDIT_COLUMNS =
  "id, health_log_id, customer_profile_id, log_date, actor_user_id, action, outcome, rejection_reason, changed_values, created_at, actor:users!health_log_audit_entries_actor_user_id_fkey(full_name)";

/** Shape of a `health_log_audit_entries` row as read via the join above. */
interface AuditEntryRow {
  id: string;
  health_log_id: string | null;
  customer_profile_id: string;
  log_date: string;
  actor_user_id: string | null;
  action: "CREATE" | "UPDATE" | "DELETE";
  outcome: "ACCEPTED" | "REJECTED";
  rejection_reason: string | null;
  changed_values: Record<string, unknown> | null;
  created_at: string;
  actor: { full_name: string | null } | { full_name: string | null }[] | null;
}

/** Input for appending a Log_Audit_Trail entry (Req 18.5, 18.6). */
export interface InsertAuditEntryInput {
  healthLogId: string | null;
  customerProfileId: string;
  logDate: string;
  actorUserId: string | null;
  action: "CREATE" | "UPDATE" | "DELETE";
  outcome: "ACCEPTED" | "REJECTED";
  rejectionReason?: string | null;
  changedValues?: Record<string, unknown> | null;
}

function toAuditEntry(row: AuditEntryRow): AuditEntry {
  const actor = Array.isArray(row.actor) ? row.actor[0] : row.actor;
  return {
    id: row.id,
    healthLogId: row.health_log_id,
    customerProfileId: row.customer_profile_id,
    logDate: row.log_date,
    actorUserId: row.actor_user_id,
    actorName: actor?.full_name ?? null,
    action: row.action,
    outcome: row.outcome,
    rejectionReason: row.rejection_reason,
    changedValues: row.changed_values,
    createdAt: row.created_at,
  };
}

/**
 * Append a Log_Audit_Trail entry for one Health_Log write attempt.
 *
 * Called for every accepted and every rejected create/update attempt (Req
 * 18.5, 18.6), so the accounting invariant of Req 18.9 holds by construction:
 * one call site (`HealthLogService`), one insert per attempt. The table
 * accepts no `UPDATE`/`DELETE` (Req 18.7); this module never attempts one.
 *
 * Req 18.5, 18.6
 */
export async function insertAuditEntry(
  input: InsertAuditEntryInput
): Promise<AuditEntry> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("health_log_audit_entries")
    .insert({
      health_log_id: input.healthLogId,
      customer_profile_id: input.customerProfileId,
      log_date: input.logDate,
      actor_user_id: input.actorUserId,
      action: input.action,
      outcome: input.outcome,
      rejection_reason: input.rejectionReason ?? null,
      changed_values: input.changedValues ?? null,
    })
    .select(AUDIT_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to insert audit entry for customer ${input.customerProfileId} on ${input.logDate}: ${
        error?.message ?? "unknown error"
      }`
    );
  }

  return toAuditEntry(data as unknown as AuditEntryRow);
}

/**
 * Read the Log_Audit_Trail for one Customer_Record in reverse chronological
 * order (Req 18.8), using the `idx_health_log_audit_customer` index.
 *
 * Returns an empty array when the Customer_Record has no audit entries.
 *
 * Req 18.8
 */
export async function listAuditEntriesForCustomer(
  customerProfileId: string
): Promise<AuditEntry[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("health_log_audit_entries")
    .select(AUDIT_COLUMNS)
    .eq("customer_profile_id", customerProfileId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(
      `Failed to list audit entries for customer ${customerProfileId}: ${error.message}`
    );
  }

  return ((data ?? []) as unknown as AuditEntryRow[]).map(toAuditEntry);
}
