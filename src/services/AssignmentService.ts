// src/services/AssignmentService.ts
// Business service for the Dietitian_Link (`customer_profiles.dietitian_id`).
//
// LAYERING: Business service. It composes the data-access layer
// (`src/repositories/dietitian/assignmentRepository.ts`,
// `src/repositories/dietitian/dietitianRepository.ts`) with the validity and
// clinic-membership rules that the repositories deliberately leave to their
// caller. It holds NO `'use server'` wrappers (those live in
// `src/actions/admin-actions/dietitianAssignmentActions.ts` and the onboarding
// Server Actions) and does NO HTTP/auth-context resolution — every caller
// passes an already-resolved `actingUserId` (the caller's Supabase Auth id,
// i.e. what `admin_activity_logs.admin_id` stores — see `src/lib/logger.ts`).
//
// Responsibilities (design.md §9, "Services"):
//   * Read/write the Dietitian_Link with a dietitian-validity check (Req 6.4)
//     and, for a clinic-scoped write, a clinic-membership check (Req 7.8, 8.2,
//     8.8, 8.9).
//   * `reconcileOnClinicChange(profileId, category, newClinicId)` — the
//     per-Customer_Category clinic-change reconciliation table (Req 8.4, 8.5,
//     8.6), invoked from the existing `adminAssignCustomerClinic` action so
//     there is a single place where a Clinic change can touch a Dietitian_Link.
//   * `validateDietitianForClinic` — the clinic-membership check the onboarding
//     Server Actions run before submitting a Meal/KIT onboarding payload,
//     returning the pinned rejection message rather than persisting anything
//     (Req 7.8). The actual persistence of a validated Dietitian_Link during
//     onboarding happens inside the SAME atomic operation that creates the
//     Customer_Record (Req 7.7, 8.8, 9.4) — i.e. the onboarding RPC payload,
//     not a follow-up call into this service — so this function is a pure
//     pre-check with no write.
//   * `clearLinksForDeletedDietitian` — the explicit, audited path for Req 6.5,
//     called by `DietitianAccountService` before the `users` row is removed
//     (the affected Customer_Record ids must be known before the FK's
//     `ON DELETE SET NULL` clears them at the database layer regardless).
//   * Retention of links across a Dietitian's reassignment and deactivation
//     (Req 3.8, 3.10, 6.5) is a property of what this service does NOT do:
//     neither `DietitianAccountService.updateDietitian` (reassign a Clinic) nor
//     a deactivation ever calls a Dietitian_Link write, so every
//     Dietitian_Link is left byte-for-byte unchanged by construction. Only a
//     hard delete calls `clearLinksForDeletedDietitian`.
//   * An `admin_activity_logs` entry naming both endpoints (the previous and
//     the new Dietitian) for every Dietitian_Link change (Req 6.8) — written
//     directly here (not via `logAdminAction`, which resolves the acting user
//     from the request's session and this service is called from contexts,
//     like onboarding, that already resolved a different actor). Mirrors the
//     `logAdminAction` convention of swallowing write failures: `admin_activity_logs`
//     is operational telemetry, not the clinical Log_Audit_Trail, so a failed
//     insert must never block the Dietitian_Link write itself.
//
// Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.7, 6.8, 7.7, 7.8, 8.4, 8.5, 8.6,
//               8.8, 8.9, 9.4

import { createAdminClient } from "@/lib/supabase/admin";
import {
  clearDietitianLinksForUser,
  getDietitianLink as readDietitianLink,
  isDietitianUser,
  setDietitianLink as writeDietitianLink,
} from "@/repositories/dietitian/assignmentRepository";
import {
  getDietitianById,
  listActiveDietitiansForClinic,
} from "@/repositories/dietitian/dietitianRepository";
import {
  DIETITIAN_NOT_IN_RESOLVED_CLINIC,
  SELECTED_USER_IS_NOT_A_DIETITIAN,
} from "@/lib/dietitian/messages";
import type { CustomerCategory } from "@/types/dietitian";

// ─── Read ────────────────────────────────────────────────────────────────────

/**
 * Read the current Dietitian_Link of a Customer_Record. Returns `null` when
 * the Customer_Record has no linked Dietitian (Req 6.2).
 */
export async function getDietitianLink(
  customerProfileId: string,
): Promise<string | null> {
  return readDietitianLink(customerProfileId);
}

// ─── Write ───────────────────────────────────────────────────────────────────

/** Input for {@link setDietitianLink}. */
export interface SetDietitianLinkInput {
  customerProfileId: string;
  /** `null` clears the link — every Customer_Category may hold an empty link (Req 6.2). */
  dietitianUserId: string | null;
  /**
   * The Supabase Auth id of the user performing the write, recorded as
   * `admin_activity_logs.admin_id` (Req 6.8). `null` for a system-initiated
   * write (e.g. an automated reconciliation with no human actor).
   */
  actingUserId: string | null;
  /**
   * The Clinic the Dietitian must belong to for a clinic-scoped write — the
   * onboarding Dietitian dropdown (Req 7.8) and the Customer_360 Clinic
   * Assignment card for a KIT customer (Req 8.2, 8.9). Omit or pass `null` for
   * an unscoped write (Accommodation's all-Dietitians dropdown, Req 9.2, or a
   * clear).
   */
  requiredClinicId?: string | null;
}

/** Why a {@link setDietitianLink} call was rejected. */
export type SetDietitianLinkRejectionReason = "NOT_A_DIETITIAN" | "NOT_IN_CLINIC";

/** The outcome of {@link setDietitianLink}. */
export type SetDietitianLinkResult =
  | {
      ok: true;
      previousDietitianId: string | null;
      dietitianId: string | null;
      /** Whether the stored value actually changed (drives the audit write). */
      changed: boolean;
    }
  | {
      ok: false;
      reason: SetDietitianLinkRejectionReason;
      message: string;
    };

/**
 * Write the Dietitian_Link of a Customer_Record, with the dietitian-validity
 * check (Req 6.4) and, when `requiredClinicId` is supplied, the
 * clinic-membership check (Req 7.8, 8.2, 8.8, 8.9).
 *
 * Behaviour:
 *   1. `dietitianUserId === null` always succeeds — clearing a link never
 *      needs validation (Req 6.2).
 *   2. Otherwise, verify the candidate is a Dietitian (Req 6.4). A non-Dietitian
 *      `users` row is rejected with `Selected user is not a dietitian` and
 *      nothing is stored.
 *   3. When `requiredClinicId` is supplied, additionally verify the candidate
 *      is active and linked to that Clinic. A mismatch is rejected with
 *      `Selected dietitian does not belong to the resolved clinic` and
 *      nothing is stored (Req 7.8, 8.2, 8.8).
 *   4. Persist the write via the repository, which returns the value stored
 *      immediately before the write (Req 6.6 idempotence and Req 6.7
 *      round-trip both fall out of the repository's plain column update).
 *   5. When the stored value actually changed, record one `admin_activity_logs`
 *      entry naming the acting user, the Customer_Record, the previous
 *      Dietitian and the new Dietitian (Req 6.8). Writing the same value twice
 *      produces exactly one audit entry, not two, since the second write is a
 *      no-op change.
 */
export async function setDietitianLink(
  input: SetDietitianLinkInput,
): Promise<SetDietitianLinkResult> {
  const { customerProfileId, dietitianUserId, actingUserId, requiredClinicId } = input;

  if (dietitianUserId !== null) {
    const isDietitian = await isDietitianUser(dietitianUserId);
    if (!isDietitian) {
      return {
        ok: false,
        reason: "NOT_A_DIETITIAN",
        message: SELECTED_USER_IS_NOT_A_DIETITIAN,
      };
    }

    if (requiredClinicId !== undefined && requiredClinicId !== null) {
      const belongsToClinic = await isDietitianLinkedToClinic(
        dietitianUserId,
        requiredClinicId,
      );
      if (!belongsToClinic) {
        return {
          ok: false,
          reason: "NOT_IN_CLINIC",
          message: DIETITIAN_NOT_IN_RESOLVED_CLINIC,
        };
      }
    }
  }

  const { previousDietitianId, dietitianId } = await writeDietitianLink(
    customerProfileId,
    dietitianUserId,
  );
  const changed = previousDietitianId !== dietitianId;

  if (changed) {
    await recordDietitianLinkChange({
      actingUserId,
      customerProfileId,
      previousDietitianId,
      dietitianId,
    });
  }

  return { ok: true, previousDietitianId, dietitianId, changed };
}

// ─── Clinic-change reconciliation ────────────────────────────────────────────

/** The outcome of {@link reconcileOnClinicChange}. */
export interface ReconcileOnClinicChangeResult {
  ok: true;
  /** The Dietitian_Link after reconciliation. */
  dietitianId: string | null;
  /** Whether the stored value actually changed. */
  changed: boolean;
}

/**
 * Reconcile a Customer_Record's Dietitian_Link after its assigned Clinic
 * changes, per the Customer_Category table (Req 8.4, 8.5, 8.6):
 *
 * | Customer_Category | Clinic changes → Dietitian_Link |
 * |---|---|
 * | `KIT` | New Clinic has exactly one active Dietitian → set to that Dietitian. Existing link not on the new Clinic → set to empty. Otherwise unchanged. |
 * | `MEAL` | Unchanged. |
 * | `ACCOMMODATION` | Unchanged. |
 *
 * Invoked from the existing `adminAssignCustomerClinic` action so there is a
 * single place where a Clinic change can touch a Dietitian_Link.
 *
 * `actingUserId` is an addition beyond the design's bare
 * `reconcileOnClinicChange(profileId, category, newClinicId)` signature: Req
 * 6.8 requires every Dietitian_Link change to be attributed to an acting user,
 * and the caller (the Clinic-change action) already has that context. It
 * defaults to `null` for a system-initiated reconciliation with no human actor.
 */
export async function reconcileOnClinicChange(
  profileId: string,
  category: CustomerCategory,
  newClinicId: string | null,
  actingUserId: string | null = null,
): Promise<ReconcileOnClinicChangeResult> {
  if (category !== "KIT") {
    const dietitianId = await getDietitianLink(profileId);
    return { ok: true, dietitianId, changed: false };
  }

  const activeDietitians = newClinicId
    ? await listActiveDietitiansForClinic(newClinicId)
    : [];

  // New Clinic has exactly one active Dietitian → set to that Dietitian,
  // regardless of what the existing link was (Req 8.4).
  if (activeDietitians.length === 1) {
    const result = await setDietitianLink({
      customerProfileId: profileId,
      dietitianUserId: activeDietitians[0].id,
      actingUserId,
    });
    if (result.ok) {
      return { ok: true, dietitianId: result.dietitianId, changed: result.changed };
    }
    // The candidate was just read from the active-Dietitian list for this
    // Clinic, so a validity/clinic-membership rejection here would indicate a
    // race (the Dietitian was deactivated/reassigned between the read and the
    // write). Fall through to leaving the link unchanged rather than throwing.
    const currentDietitianId = await getDietitianLink(profileId);
    return { ok: true, dietitianId: currentDietitianId, changed: false };
  }

  // Otherwise: existing link not on the new Clinic → set to empty (Req 8.5).
  const currentDietitianId = await getDietitianLink(profileId);
  const isCurrentLinkOnNewClinic =
    currentDietitianId !== null &&
    activeDietitians.some((d) => d.id === currentDietitianId);

  if (currentDietitianId !== null && !isCurrentLinkOnNewClinic) {
    const result = await setDietitianLink({
      customerProfileId: profileId,
      dietitianUserId: null,
      actingUserId,
    });
    return {
      ok: true,
      dietitianId: result.ok ? result.dietitianId : currentDietitianId,
      changed: result.ok ? result.changed : false,
    };
  }

  // Otherwise: leave the link unchanged (Req 8.6 for MEAL/ACCOMMODATION is
  // handled above; this is the KIT "otherwise" branch of the table).
  return { ok: true, dietitianId: currentDietitianId, changed: false };
}

// ─── Onboarding clinic-membership validation ─────────────────────────────────

/** The outcome of {@link validateDietitianForClinic}. */
export type ValidateDietitianForClinicResult = { ok: true } | { ok: false; message: string };

/**
 * Validate that a candidate Dietitian belongs to the resolved Clinic, for the
 * Meal onboarding Dietitian dropdown and the KIT Customer_360 Clinic
 * Assignment card (Req 7.8, 8.2, 8.8). A pure pre-check with no write: the
 * onboarding Server Action calls this BEFORE submitting the atomic
 * onboard-customer payload and rejects the submission without persisting
 * anything on a mismatch (Req 7.7 — the validated Dietitian is persisted
 * inside that same atomic operation, not by a follow-up call into this
 * service).
 *
 * `dietitianUserId === null` always succeeds — onboarding may complete with an
 * empty Dietitian_Link (Req 6.2, 7.5, 9.3).
 */
export async function validateDietitianForClinic(
  dietitianUserId: string | null,
  clinicId: string | null,
): Promise<ValidateDietitianForClinicResult> {
  if (dietitianUserId === null) {
    return { ok: true };
  }

  const belongsToClinic =
    clinicId !== null && (await isDietitianLinkedToClinic(dietitianUserId, clinicId));

  if (!belongsToClinic) {
    return { ok: false, message: DIETITIAN_NOT_IN_RESOLVED_CLINIC };
  }
  return { ok: true };
}

// ─── Dietitian deletion ──────────────────────────────────────────────────────

/** The outcome of {@link clearLinksForDeletedDietitian}. */
export interface ClearLinksForDeletedDietitianResult {
  ok: true;
  /** The Customer_Record ids whose Dietitian_Link was cleared. */
  clearedCustomerProfileIds: string[];
}

/**
 * Clear every Dietitian_Link referencing a Dietitian who is about to be
 * deleted, retaining every referencing Customer_Record (Req 6.5), and record
 * one `admin_activity_logs` entry per affected Customer_Record naming the
 * deleted Dietitian as the previous value and an empty link as the new value
 * (Req 6.8).
 *
 * Called by `DietitianAccountService` BEFORE the `users` row is removed, so
 * the affected Customer_Record ids are read before the FK's
 * `ON DELETE SET NULL` clears them at the database layer regardless — this is
 * the explicit, audited path, not the sole enforcement mechanism.
 *
 * Idempotent: once no Customer_Record references the Dietitian, this returns
 * an empty `clearedCustomerProfileIds` and writes no audit entries.
 */
export async function clearLinksForDeletedDietitian(
  dietitianUserId: string,
  actingUserId: string | null = null,
): Promise<ClearLinksForDeletedDietitianResult> {
  const clearedCustomerProfileIds = await clearDietitianLinksForUser(dietitianUserId);

  for (const customerProfileId of clearedCustomerProfileIds) {
    await recordDietitianLinkChange({
      actingUserId,
      customerProfileId,
      previousDietitianId: dietitianUserId,
      dietitianId: null,
    });
  }

  return { ok: true, clearedCustomerProfileIds };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Whether an active Dietitian is linked to a given Clinic. Reads the
 * Dietitian's own Dietitian_Clinic_Link rather than listing every active
 * Dietitian for the Clinic, since a single-row lookup is enough to answer the
 * membership question.
 */
async function isDietitianLinkedToClinic(
  dietitianUserId: string,
  clinicId: string,
): Promise<boolean> {
  const account = await getDietitianById(dietitianUserId);
  return Boolean(account && account.isActive && account.clinicId === clinicId);
}

/**
 * Record one `admin_activity_logs` entry for a Dietitian_Link change,
 * identifying the acting user, the Customer_Record, the previous Dietitian and
 * the new Dietitian (Req 6.8).
 *
 * Mirrors the `logAdminAction` convention (`src/lib/logger.ts`) of swallowing
 * write failures rather than throwing: `admin_activity_logs` is operational
 * telemetry, so a failed insert must never block the Dietitian_Link write
 * that already succeeded.
 */
async function recordDietitianLinkChange(params: {
  actingUserId: string | null;
  customerProfileId: string;
  previousDietitianId: string | null;
  dietitianId: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("admin_activity_logs").insert({
      admin_id: params.actingUserId,
      action_type: "UPDATE",
      entity_type: "customer",
      entity_id: params.customerProfileId,
      details: {
        action: "dietitian_assignment",
        previous_dietitian_id: params.previousDietitianId,
        dietitian_id: params.dietitianId,
      },
    });
    if (error) {
      console.error("recordDietitianLinkChange insert error:", error);
    }
  } catch (err) {
    console.error("recordDietitianLinkChange failed:", err);
  }
}
