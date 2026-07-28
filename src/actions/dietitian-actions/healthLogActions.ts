"use server";

// src/actions/dietitian-actions/healthLogActions.ts
// Feature: dietitian-management — the `'use server'` boundary for Health_Log
// capture and reads (task 9.5).
//
// LAYERING: This module is a thin Server Action wrapper. It owns exactly two
// things `HealthLogService`/`healthLogRepository` deliberately do not:
//   1. Resolving the acting Dietitian via `checkDietitianScope` and passing
//      the result in as a `HealthLogActor` — the self-gating choke point for
//      Req 5.8, 5.9 (every function below calls it FIRST, before touching any
//      customer data).
//   2. Mapping the service/repository outcome onto the established
//      `{ success, data } | { success, error, fieldErrors? }` action shape.
//
// Field-level validation (`healthLogSchemaFor(category)`) and the write-gate
// decisions (future-date, Paused_Day, one-log-per-day, same-day edit window,
// authorship, no deletion) already live in `HealthLogService.submitHealthLog`
// — this module does not re-implement them.
//
// Portal-neutral: both the admin and franchise portals call this same module
// (design "Dietitian actions live in a new `src/actions/dietitian-actions/`
// folder"). It must never import from `src/app/admin` or `src/app/franchise`.
//
// No write path to Self_Logs: `getSelfLogForDate` only ever reads
// `v_health_log_timeline` filtered to `author_type = 'CUSTOMER'`; there is no
// insert/update/delete exported anywhere in this file for a Self_Log
// (Req 25.4).
//
// Requirements: 5.8, 5.9, 15.9, 15.12, 25.1, 25.2, 25.3, 25.4, 25.6

import { checkDietitianScope } from "@/lib/auth/adminAccess";
import {
  submitHealthLog as submitHealthLogService,
  type HealthLogActor,
  type SubmitHealthLogInput,
} from "@/services/HealthLogService";
import {
  getHealthLogTimeline as getHealthLogTimelineRepo,
  getSelfLogForDate as getSelfLogForDateRepo,
  type TimelineRow,
} from "@/repositories/dietitian/healthLogRepository";
import { getGoverningRecords } from "@/repositories/dietitian/cadenceRepository";
import { createAdminClient } from "@/lib/supabase/admin";
import { deserializeCustomParameters } from "@/lib/dietitian/customParameters";
import { getISTDateString, istDateStringOf } from "@/lib/dates/ist";
import type {
  CustomerCategory,
  CustomParameter,
  HealthLog,
  ParameterValue,
} from "@/types/dietitian";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The established Server Action result shape (design "Result convention"),
 * extended with `fieldErrors` — the per-field map `HealthLogService` already
 * returns on a validation failure — rather than the single `field?: string`
 * some other actions use, since a Health_Log submission can fail on more than
 * one parameter at once.
 */
type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string> };

// ---------------------------------------------------------------------------
// 1. submitHealthLog — Req 5.8, 5.9, 15.9, 15.12
// ---------------------------------------------------------------------------

/**
 * Submit (create or same-day update) a Dietitian_Log.
 *
 * `checkDietitianScope(input.customerProfileId)` runs first: an out-of-scope
 * or unauthenticated caller never reaches `HealthLogService`, so no
 * validation, write-gate decision or audit entry is evaluated for a customer
 * outside the caller's scope (Req 5.8, 5.9). The resolved `DietitianContext`
 * is then passed to the service as a `HealthLogActor` — this action never
 * lets the caller supply their own author identity.
 *
 * Every other decision (field validation, CREATE vs UPDATE, the future-date /
 * Paused_Day / same-day-edit-window / authorship checks, the submission
 * timestamp, the audit entry) is `HealthLogService.submitHealthLog`'s, not
 * this wrapper's (Req 15.9, 15.12).
 */
export async function submitHealthLog(
  input: SubmitHealthLogInput,
): Promise<ActionResult<HealthLog>> {
  const scope = await checkDietitianScope(input.customerProfileId);
  if (!scope.ok) {
    return { success: false, error: scope.error };
  }

  const actor: HealthLogActor = {
    userId: scope.ctx.userId,
    clinicId: scope.ctx.clinicId,
    franchiseId: scope.ctx.franchiseId,
  };

  try {
    const result = await submitHealthLogService(input, actor);
    if (!result.ok) {
      return { success: false, error: result.error, fieldErrors: result.fieldErrors };
    }
    return { success: true, data: result.healthLog };
  } catch (err) {
    console.error("[healthLogActions] submitHealthLog error", err);
    return { success: false, error: "Failed to save this log. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// 2. getHealthLogTimeline — Req 5.8, 5.9, 25.1, 25.2, 25.3
// ---------------------------------------------------------------------------

/**
 * Read a Customer_Record's full Health_Log timeline — every Dietitian_Log and
 * every Self_Log, date-ordered and author-type-labelled (Req 25.3) — gated by
 * `checkDietitianScope` so a Dietitian only ever sees the timeline for a
 * Customer_Record within their Clinic/Franchise scope or Dietitian_Link
 * (Req 25.1, 25.2, 5.8, 5.9).
 */
export async function getHealthLogTimeline(
  customerProfileId: string,
): Promise<ActionResult<HealthLog[]>> {
  const scope = await checkDietitianScope(customerProfileId);
  if (!scope.ok) {
    return { success: false, error: scope.error };
  }

  try {
    const [timeline, governingRecords] = await Promise.all([
      getHealthLogTimelineRepo(customerProfileId),
      getGoverningRecords([customerProfileId]),
    ]);

    const category = governingRecords.get(customerProfileId)?.category ?? "MEAL";
    const authorNames = await resolveAuthorNames(
      timeline.map((row) => row.author_user_id),
    );

    const healthLogs = timeline.map((row) => toHealthLog(row, category, authorNames));
    return { success: true, data: healthLogs };
  } catch (err) {
    console.error("[healthLogActions] getHealthLogTimeline error", err);
    return { success: false, error: "Failed to load the health log timeline." };
  }
}

// ---------------------------------------------------------------------------
// 3. getSelfLogForDate — Req 5.8, 5.9, 25.4, 25.6 (read-only, no write path)
// ---------------------------------------------------------------------------

/**
 * Read the Self_Log(s) recorded for one Customer_Record on one log date, for
 * the SelfLogReferencePanel rendered beside the Dietitian's log form
 * (Req 25.6). Gated by `checkDietitianScope` like every other function here.
 *
 * This is read-only reference data: the result is meant to be displayed
 * beside the log form, never used to pre-fill it (design Property 31 — the
 * caller UI, not this action, is responsible for keeping the form fields
 * empty). There is no corresponding write/delete export in this module or in
 * `healthLogRepository` — a Dietitian has no path to write a Self_Log
 * (Req 25.4).
 */
export async function getSelfLogForDate(
  customerProfileId: string,
  date: string,
): Promise<ActionResult<HealthLog[]>> {
  const scope = await checkDietitianScope(customerProfileId);
  if (!scope.ok) {
    return { success: false, error: scope.error };
  }

  try {
    const [rows, governingRecords] = await Promise.all([
      getSelfLogForDateRepo(customerProfileId, date),
      getGoverningRecords([customerProfileId]),
    ]);

    const category = governingRecords.get(customerProfileId)?.category ?? "MEAL";
    // Self_Log rows never carry an author_user_id (the legacy tables record
    // no author), so there is nothing to resolve here.
    const noAuthorNames = new Map<string, string>();

    const selfLogs = rows.map((row) => toHealthLog(row, category, noAuthorNames));
    return { success: true, data: selfLogs };
  } catch (err) {
    console.error("[healthLogActions] getSelfLogForDate error", err);
    return { success: false, error: "Failed to load self-log reference data." };
  }
}

// ---------------------------------------------------------------------------
// 4. getDietitianLogForDate — Req 5.8, 5.9, 15.9, 18.1, 18.2
// ---------------------------------------------------------------------------

/** A prefill snapshot of a Dietitian_Log for one date, for the slot form. */
export interface DietitianLogForDate {
  parameters: Record<string, ParameterValue>;
  customParameters: CustomParameter[];
  closingComment: string;
  /**
   * Whether the log is still inside its same-day edit window AND authored by
   * the current Dietitian — i.e. whether this caller may update it now
   * (Req 18.1, 18.2, 18.3).
   */
  editable: boolean;
}

/**
 * Read the current Dietitian's editable view of the Dietitian_Log for one
 * date, or `null` when none exists. Used by the Log_Slot selector to prefill
 * the form when a Dietitian revisits an already-logged slot (Req 15.9), and to
 * decide whether that slot is still editable today (Req 18.1, 18.2, 18.3).
 * Gated by `checkDietitianScope` like every other function here (Req 5.8, 5.9).
 */
export async function getDietitianLogForDate(
  customerProfileId: string,
  date: string,
): Promise<ActionResult<DietitianLogForDate | null>> {
  const scope = await checkDietitianScope(customerProfileId);
  if (!scope.ok) {
    return { success: false, error: scope.error };
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("health_logs")
      .select(
        "parameters, custom_parameters, closing_comment, submission_date_ist, author_user_id",
      )
      .eq("customer_profile_id", customerProfileId)
      .eq("log_date", date)
      .eq("author_type", "DIETITIAN")
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }
    if (!data) return { success: true, data: null };

    const editable =
      data.author_user_id === scope.ctx.userId &&
      data.submission_date_ist === getISTDateString();

    return {
      success: true,
      data: {
        parameters: (data.parameters as Record<string, ParameterValue>) ?? {},
        customParameters: deserializeCustomParameters(data.custom_parameters),
        closingComment: (data.closing_comment as string | null) ?? "",
        editable,
      },
    };
  } catch (err) {
    console.error("[healthLogActions] getDietitianLogForDate error", err);
    return { success: false, error: "Failed to load this log entry." };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Maps one `v_health_log_timeline` row to the domain `HealthLog` shape. */
function toHealthLog(
  row: TimelineRow,
  category: CustomerCategory,
  authorNames: ReadonlyMap<string, string>,
): HealthLog {
  return {
    id: row.id,
    customerProfileId: row.customer_profile_id,
    logDate: row.log_date,
    authorType: row.author_type,
    authorUserId: row.author_user_id,
    authorName: row.author_user_id ? authorNames.get(row.author_user_id) ?? null : null,
    category,
    parameters: row.parameters ?? {},
    customParameters: deserializeCustomParameters(row.custom_parameters),
    closingComment: row.closing_comment,
    submittedAt: row.submitted_at,
    // The view carries no `submission_date_ist` column (only `health_logs`
    // itself does); deriving it from `submitted_at` agrees with that column
    // for every row this action reads and needs no extra query.
    submissionDateIst: istDateStringOf(new Date(row.submitted_at)),
    source: row.source,
  };
}

/**
 * Resolve author display names for a batch of `author_user_id`s in one query
 * (Req 25.3's author labelling), mirroring `DietitianReportService`'s private
 * `resolveAuthorNames`. A `null` id (every legacy Self_Log source) resolves to
 * no lookup.
 */
async function resolveAuthorNames(
  authorUserIds: readonly (string | null)[],
): Promise<Map<string, string>> {
  const distinct = Array.from(
    new Set(authorUserIds.filter((id): id is string => id !== null)),
  );
  if (distinct.length === 0) return new Map();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("id, full_name")
    .in("id", distinct);

  if (error) {
    throw new Error(`Failed to resolve author names: ${error.message}`);
  }

  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ id: string; full_name: string | null }>) {
    if (row.full_name) map.set(row.id, row.full_name);
  }
  return map;
}
