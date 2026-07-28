// src/services/HealthLogService.ts
// Feature: dietitian-management — business rules for recording a Health_Log.
//
// LAYERING: Business rules only. Validation is delegated to
// `healthLogSchemaFor(category)` (`src/validations/healthLogSchema.ts`);
// persistence is delegated to `src/repositories/dietitian/healthLogRepository.ts`
// and `src/repositories/dietitian/auditRepository.ts`. This module owns the
// decisions those layers do not: resolving the author/author type/submission
// timestamp, the Health_Log write gate (future-date, Paused_Day, one-log-per-
// day, same-day edit window, authorship, no deletion), and writing exactly one
// Log_Audit_Trail entry per write attempt — accepted **and** rejected.
//
// No `'use server'` wrapper here — that lives in
// `src/actions/dietitian-actions/healthLogActions.ts` (task 9.5), which is
// also responsible for resolving the acting Dietitian via
// `checkDietitianScope`/`getCurrentDietitianContext` and passing the result in
// as `HealthLogActor`. This service never calls into `next/headers` or reads
// a session itself, mirroring `AccommodationService`/`KitLifecycleService`.
//
// Requirements: 11.5, 11.12, 11.13, 11.14, 12.2, 13.4, 15.7, 15.8, 15.9,
// 15.10, 15.11, 15.12, 15.13, 15.14, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 25.8

import { createAdminClient } from "@/lib/supabase/admin";
import { getISTDateString } from "@/lib/dates/ist";
import {
  serializeCustomParameters,
  deserializeCustomParameters,
} from "@/lib/dietitian/customParameters";
import {
  AUTHOR_NOT_IDENTIFIED,
  CAN_ONLY_EDIT_OWN_LOGS,
  HEALTH_LOGS_CANNOT_BE_DELETED,
  LOG_DATE_IN_FUTURE,
  LOG_DATE_IS_PAUSED,
  LOG_NO_LONGER_EDITABLE,
} from "@/lib/dietitian/messages";
import { healthLogSchemaFor } from "@/validations/healthLogSchema";
import {
  upsertHealthLog,
  type HealthLogRow,
  type UpsertHealthLogInput,
} from "@/repositories/dietitian/healthLogRepository";
import {
  insertAuditEntry,
  type InsertAuditEntryInput,
} from "@/repositories/dietitian/auditRepository";
import { getPausedDatesSince } from "@/repositories/dietitian/cadenceRepository";
import type { CustomerCategory, HealthLog, ParameterValue } from "@/types/dietitian";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Postgres uuid text form — the only shape an id may take. */
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** IST calendar date, `YYYY-MM-DD`. */
const LOG_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The identity of the acting Dietitian, resolved by the caller (the
 * `"use server"` action layer, via `checkDietitianScope`/
 * `getCurrentDietitianContext`) and handed in — this service never resolves
 * its own actor (Req 15.12, 15.13).
 */
export interface HealthLogActor {
  /** `public.users.id` of the authoring Dietitian. */
  userId: string;
  /** Stamped onto the Health_Log for reporting; optional (Req 15.14). */
  clinicId?: string | null;
  /** Stamped onto the Health_Log for reporting; optional (Req 15.14). */
  franchiseId?: string | null;
}

/**
 * The raw payload a Health_Log submission carries. `category` selects the
 * validation schema (`healthLogSchemaFor`) and is supplied by the caller,
 * which already resolved it to render the log form — the same category the
 * repository persists on the row.
 */
export interface SubmitHealthLogInput {
  customerProfileId: string;
  /** IST calendar date the log applies to, `YYYY-MM-DD`. */
  logDate: string;
  category: CustomerCategory;
  /** Sparse map keyed by `FieldDefinition.key` — validated by the schema. */
  parameters: unknown;
  customParameters: unknown;
  closingComment: unknown;
}

/** The outcome of a `submitHealthLog` call. */
export type SubmitHealthLogResult =
  | { ok: true; healthLog: HealthLog }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** The outcome of a `deleteHealthLog` call — always a rejection (Req 18.4). */
export type DeleteHealthLogResult = { ok: false; error: string };

/** The pre-write snapshot of an existing Dietitian_Log for one day. */
interface ExistingDietitianLog {
  id: string;
  authorUserId: string;
  /** The log's own submission date, `YYYY-MM-DD` — the edit-window anchor. */
  submissionDateIst: string;
  parameters: Record<string, ParameterValue>;
  customParameters: unknown;
  closingComment: string;
  clinicId: string | null;
  franchiseId: string | null;
}

// ---------------------------------------------------------------------------
// Delete — always rejected (Req 18.4)
// ---------------------------------------------------------------------------

/**
 * Every delete request is refused. No Health_Log lookup or database access is
 * necessary: deletion is categorically forbidden regardless of which log, who
 * is asking, or why (Req 18.4). Kept as an explicit exported function — rather
 * than simply omitting a delete path — so the Server Action layer has a single
 * documented symbol to wire a "Delete" control to, one that can never
 * accidentally succeed.
 */
export async function deleteHealthLog(): Promise<DeleteHealthLogResult> {
  return { ok: false, error: HEALTH_LOGS_CANNOT_BE_DELETED };
}

// ---------------------------------------------------------------------------
// Submit (create or same-day update)
// ---------------------------------------------------------------------------

/**
 * Validate and persist one Health_Log submission.
 *
 * Order of decisions (mirrors design Property 22 and the write-gate
 * requirements):
 *   1. The author identity must be resolvable (Req 15.13) — checked first
 *      because no audit entry can be attributed without it.
 *   2. The payload is validated against `healthLogSchemaFor(category)`
 *      (Req 11, 12, 13) — parameter ranges, Custom_Parameters, Closing_Comment.
 *   3. The existing Dietitian_Log for this Customer_Record and log date (if
 *      any) is read, which fixes whether this is a CREATE or an UPDATE
 *      (Req 15.9, 15.11) before any of the date-gate rules are applied, so
 *      every rejection is tagged with the correct action.
 *   4. A future log date is rejected regardless of CREATE/UPDATE (Req 15.7).
 *   5. For an UPDATE: authorship (Req 18.3) then the same-day edit window,
 *      keyed on the log's own submission date, not the log date it describes
 *      (Req 18.1, 18.2). A Paused_Day is never checked on an update — Req
 *      15.10 explicitly overrides Req 15.8 for the update path.
 *   6. For a CREATE: a Paused_Day is rejected (Req 15.8).
 *   7. The write is persisted, then exactly one Log_Audit_Trail entry is
 *      appended. Every rejection above also appends one entry with outcome
 *      `REJECTED` (Req 18.6) before returning.
 *
 * Requirements: 11.5, 11.12, 11.13, 11.14, 12.2, 13.4, 15.7, 15.8, 15.9,
 * 15.10, 15.11, 15.12, 15.13, 15.14, 18.1, 18.2, 18.3, 18.5, 18.6, 25.8
 */
export async function submitHealthLog(
  input: SubmitHealthLogInput,
  actor: HealthLogActor,
): Promise<SubmitHealthLogResult> {
  // Ids usable for a REJECTED audit entry even before the payload validates —
  // an audit row still needs a real customer_profile_id and log_date (both
  // NOT NULL / FK columns), so a structurally malformed value is dropped
  // rather than sent to the database.
  const auditableCustomerProfileId =
    typeof input.customerProfileId === "string" && UUID_RE.test(input.customerProfileId)
      ? input.customerProfileId
      : null;
  const auditableLogDate =
    typeof input.logDate === "string" && LOG_DATE_RE.test(input.logDate)
      ? input.logDate
      : null;
  const auditableActorUserId =
    typeof actor?.userId === "string" && UUID_RE.test(actor.userId) ? actor.userId : null;

  const reject = async (
    error: string,
    action: "CREATE" | "UPDATE",
  ): Promise<SubmitHealthLogResult> => {
    if (auditableCustomerProfileId && auditableLogDate) {
      await tryRecordAudit({
        healthLogId: null,
        customerProfileId: auditableCustomerProfileId,
        logDate: auditableLogDate,
        actorUserId: auditableActorUserId,
        action,
        outcome: "REJECTED",
        rejectionReason: error,
        changedValues: null,
      });
    }
    return { ok: false, error };
  };

  // 1. Author identity (Req 15.13). Checked before validation: without it, no
  // audit entry can name an actor and no write can be attributed.
  if (auditableActorUserId === null) {
    return reject(AUTHOR_NOT_IDENTIFIED, "CREATE");
  }

  let submittedAt: string;
  try {
    submittedAt = new Date().toISOString();
    if (!submittedAt) throw new Error("empty timestamp");
  } catch {
    // Req 15.13 — an unresolvable submission timestamp is treated the same
    // as an unresolvable author.
    return reject(AUTHOR_NOT_IDENTIFIED, "CREATE");
  }
  const submissionDateIst = getISTDateString();

  // 2. Category-scoped validation (Req 11.5–11.14, 12.2–12.6, 13.2–13.4).
  const schema = healthLogSchemaFor(input.category);
  const parsed = schema.safeParse({
    customerProfileId: input.customerProfileId,
    logDate: input.logDate,
    parameters: input.parameters,
    customParameters: input.customParameters,
    closingComment: input.closingComment,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "form";
      if (!(key in fieldErrors)) fieldErrors[key] = issue.message;
    }
    const firstMessage = parsed.error.issues[0]?.message ?? "Invalid health log submission";
    await reject(firstMessage, "CREATE");
    return { ok: false, error: firstMessage, fieldErrors };
  }

  const validated = parsed.data;

  // 3. Resolve CREATE vs UPDATE before applying any date-gate rule, so every
  // rejection below is tagged with the correct action (Req 15.9, 15.11).
  const existing = await getExistingDietitianLog(
    validated.customerProfileId,
    validated.logDate,
  );
  const action: "CREATE" | "UPDATE" = existing ? "UPDATE" : "CREATE";

  // 4. Future log dates are always rejected (Req 15.7).
  if (validated.logDate > submissionDateIst) {
    return reject(LOG_DATE_IN_FUTURE, action);
  }

  if (existing) {
    // 5a. Authorship — an update by a different Dietitian is refused
    // (Req 18.3) before the edit window is even considered.
    if (existing.authorUserId !== actor.userId) {
      return reject(CAN_ONLY_EDIT_OWN_LOGS, action);
    }
    // 5b. Same-day edit window, anchored to the log's own submission date —
    // NOT the log date it describes (Req 18.1, 18.2).
    if (existing.submissionDateIst !== submissionDateIst) {
      return reject(LOG_NO_LONGER_EDITABLE, action);
    }
    // Req 15.10 — a Paused_Day never blocks an update to an existing log.
  } else {
    // 6. A Paused_Day blocks a CREATE only (Req 15.8).
    const pausedByCustomer = await getPausedDatesSince(
      [validated.customerProfileId],
      validated.logDate,
    );
    const pausedDates = pausedByCustomer.get(validated.customerProfileId) ?? [];
    if (pausedDates.includes(validated.logDate)) {
      return reject(LOG_DATE_IS_PAUSED, action);
    }
  }

  // 7. Persist, then append exactly one ACCEPTED audit entry.
  const serializedCustomParameters = serializeCustomParameters(validated.customParameters);

  const upsertInput: UpsertHealthLogInput = {
    customer_profile_id: validated.customerProfileId,
    log_date: validated.logDate,
    author_user_id: actor.userId,
    customer_category: input.category,
    // Req 25.8 — only the values the Dietitian entered in this submission are
    // ever persisted; no Self_Log value is read or merged in above.
    parameters: validated.parameters,
    custom_parameters: serializedCustomParameters,
    closing_comment: validated.closingComment,
    submitted_at: submittedAt,
    submission_date_ist: submissionDateIst,
    clinic_id: actor.clinicId ?? existing?.clinicId ?? null,
    franchise_id: actor.franchiseId ?? existing?.franchiseId ?? null,
  };

  const persisted = await upsertHealthLog(upsertInput);

  const changedValues = {
    parameters: validated.parameters,
    customParameters: serializedCustomParameters,
    closingComment: validated.closingComment,
  };

  const auditOutcome = await tryRecordAudit({
    healthLogId: persisted.id,
    customerProfileId: validated.customerProfileId,
    logDate: validated.logDate,
    actorUserId: actor.userId,
    action,
    outcome: "ACCEPTED",
    changedValues,
  });

  if (!auditOutcome.ok) {
    // Req 18.9's accounting invariant cannot hold if a Health_Log is
    // persisted without a matching ACCEPTED audit entry — the write is
    // aborted by compensating it, and the caller sees a failure rather than a
    // silently unrecorded success.
    await compensateFailedWrite(action, existing, upsertInput, persisted.id);
    return {
      ok: false,
      error: "Could not record this log. Please try again.",
    };
  }

  return { ok: true, healthLog: toHealthLog(persisted) };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read the existing Dietitian_Log for a Customer_Record and log date, if any.
 *
 * Not exposed by `healthLogRepository` — that module's `upsertHealthLog`
 * performs an equivalent lookup internally but does not surface it, since the
 * service needs the pre-write snapshot for the write-gate decisions (Req 18.1,
 * 18.2, 18.3) and, if the subsequent audit write fails, to revert an UPDATE
 * (see {@link compensateFailedWrite}).
 */
async function getExistingDietitianLog(
  customerProfileId: string,
  logDate: string,
): Promise<ExistingDietitianLog | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("health_logs")
    .select(
      "id, author_user_id, submission_date_ist, parameters, custom_parameters, closing_comment, clinic_id, franchise_id",
    )
    .eq("customer_profile_id", customerProfileId)
    .eq("log_date", logDate)
    .eq("author_type", "DIETITIAN")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to look up existing dietitian log for customer ${customerProfileId} on ${logDate}: ${error.message}`,
    );
  }
  if (!data) return null;

  return {
    id: data.id as string,
    authorUserId: data.author_user_id as string,
    submissionDateIst: data.submission_date_ist as string,
    parameters: (data.parameters ?? {}) as Record<string, ParameterValue>,
    customParameters: data.custom_parameters,
    closingComment: data.closing_comment as string,
    clinicId: (data.clinic_id as string | null) ?? null,
    franchiseId: (data.franchise_id as string | null) ?? null,
  };
}

/**
 * Appends one Log_Audit_Trail entry, never throwing: a failure is reported as
 * `{ ok: false }` so the caller decides how to respond (a REJECTED entry's
 * failure is logged and swallowed since no Health_Log write is in flight to
 * protect; an ACCEPTED entry's failure triggers {@link compensateFailedWrite}).
 */
async function tryRecordAudit(
  input: InsertAuditEntryInput,
): Promise<{ ok: true } | { ok: false }> {
  try {
    await insertAuditEntry(input);
    return { ok: true };
  } catch (error) {
    console.error("[HealthLogService] audit write failed", error);
    return { ok: false };
  }
}

/**
 * Reverses a Health_Log write whose matching audit entry failed to persist,
 * so a write is never left observable without its audit trail (Req 18.9).
 *
 * - UPDATE: replays the pre-write snapshot through the same upsert path,
 *   restoring the row exactly as it was.
 * - CREATE: removes the just-inserted row directly. This is a system-internal
 *   consistency repair, not the user-facing delete path Req 18.4 forbids —
 *   it is unreachable from any request and exists solely to stop an
 *   unrecorded write from surviving.
 *
 * Best effort: a failure here is logged, not thrown, since the caller has
 * already decided to report the original operation as failed either way.
 */
async function compensateFailedWrite(
  action: "CREATE" | "UPDATE",
  existing: ExistingDietitianLog | null,
  attempted: UpsertHealthLogInput,
  persistedId: string,
): Promise<void> {
  try {
    if (action === "UPDATE" && existing) {
      await upsertHealthLog({
        customer_profile_id: attempted.customer_profile_id,
        log_date: attempted.log_date,
        author_user_id: existing.authorUserId,
        customer_category: attempted.customer_category,
        parameters: existing.parameters,
        custom_parameters: existing.customParameters,
        closing_comment: existing.closingComment,
        submitted_at: new Date().toISOString(),
        submission_date_ist: existing.submissionDateIst,
        clinic_id: existing.clinicId,
        franchise_id: existing.franchiseId,
      });
      return;
    }

    const admin = createAdminClient();
    const { error } = await admin.from("health_logs").delete().eq("id", persistedId);
    if (error) {
      throw new Error(error.message);
    }
  } catch (compensationError) {
    console.error(
      "[HealthLogService] failed to compensate for an audit write failure",
      compensationError,
    );
  }
}

/** Maps a persisted `health_logs` row to the domain `HealthLog` shape. */
function toHealthLog(row: HealthLogRow): HealthLog {
  return {
    id: row.id,
    customerProfileId: row.customer_profile_id,
    logDate: row.log_date,
    authorType: row.author_type,
    authorUserId: row.author_user_id,
    // Not resolved here — the author name is a join the read paths perform
    // (e.g. `auditRepository`'s `actor:users(...)` embed); the caller can
    // resolve it separately if the confirmation UI needs it.
    authorName: null,
    category: row.customer_category,
    parameters: row.parameters,
    customParameters: deserializeCustomParameters(row.custom_parameters),
    closingComment: row.closing_comment,
    submittedAt: row.submitted_at,
    submissionDateIst: row.submission_date_ist,
    source: "health_logs",
  };
}
