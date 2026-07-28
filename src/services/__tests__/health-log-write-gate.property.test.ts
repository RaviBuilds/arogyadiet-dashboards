/* eslint-disable @typescript-eslint/no-explicit-any */
// src/services/__tests__/health-log-write-gate.property.test.ts
// Feature: dietitian-management, Property 22

//
// Property 22 (design.md): "For any sequence of Health_Log submissions and
// delete attempts over a Customer_Record, the persisted state never contains
// more than one Dietitian_Log per log date; a resubmission by the same
// Dietitian for an existing log date updates that log rather than creating a
// second one; a create on a Paused_Day is rejected with `The selected date is
// paused for this customer` while an update to an existing log on a date that
// has since become paused is permitted; an update is permitted iff the
// current IST date equals the log's submission date, otherwise rejected with
// `This log can no longer be edited`; an update by a different Dietitian is
// rejected with `You can only edit your own logs`; a log date after the
// current IST date is rejected with `Log date cannot be in the future`; a
// missing author identifier or timestamp is rejected with `Could not identify
// the author of this log`; and every delete attempt is rejected with `Health
// logs cannot be deleted` leaving the state unchanged."
//
// Validates: Requirements 15.7, 15.8, 15.9, 15.10, 15.11, 15.13, 18.1, 18.2,
// 18.3, 18.4
//
// `HealthLogService.submitHealthLog`/`deleteHealthLog` run for REAL. The
// modules that perform I/O — `@/repositories/dietitian/healthLogRepository`,
// `@/repositories/dietitian/cadenceRepository` (only `getPausedDatesSince` is
// used by the service) and `@/repositories/dietitian/auditRepository` — are
// mocked with in-memory fakes so the write-gate DECISION logic in the service
// runs deterministically. `@/lib/dates/ist` is mocked so "today" (the current
// IST date) can be driven explicitly across a simulated day boundary,
// mirroring how `onboardingService.property.test.ts` fakes its I/O
// dependencies with hoisted in-memory state.
//
// vitest + fast-check, >=100 runs.

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory world (hoisted so vi.mock factories can close over it) ─
const H = vi.hoisted(() => {
  const db: any = {};
  let seq = 0;
  let todayIst = "2025-06-15";

  function reset() {
    db.health_logs = [] as any[]; // { id, customer_profile_id, log_date, author_user_id, submission_date_ist, ... }
    db.audit_entries = [] as any[];
    db.paused_dates = new Map<string, Set<string>>(); // customerProfileId -> Set<logDate>
    seq = 0;
    todayIst = "2025-06-15";
  }

  function setToday(date: string) {
    todayIst = date;
  }

  function getToday(): string {
    return todayIst;
  }

  function findExisting(customerProfileId: string, logDate: string) {
    return db.health_logs.find(
      (r: any) =>
        r.customer_profile_id === customerProfileId && r.log_date === logDate,
    );
  }

  reset();
  return { db, reset, setToday, getToday, findExisting, nextId: () => `hl-${++seq}` };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/dates/ist", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getISTDateString: () => H.getToday(),
  };
});

vi.mock("@/repositories/dietitian/healthLogRepository", () => ({
  upsertHealthLog: vi.fn(async (input: any) => {
    const existing = H.findExisting(input.customer_profile_id, input.log_date);
    if (existing) {
      Object.assign(existing, {
        author_user_id: input.author_user_id,
        customer_category: input.customer_category,
        parameters: input.parameters,
        custom_parameters: input.custom_parameters,
        closing_comment: input.closing_comment,
        submitted_at: input.submitted_at,
        submission_date_ist: input.submission_date_ist,
        clinic_id: input.clinic_id ?? null,
        franchise_id: input.franchise_id ?? null,
        updated_at: new Date().toISOString(),
      });
      return { ...existing };
    }
    const row = {
      id: H.nextId(),
      customer_profile_id: input.customer_profile_id,
      log_date: input.log_date,
      author_type: "DIETITIAN",
      author_user_id: input.author_user_id,
      customer_category: input.customer_category,
      parameters: input.parameters,
      custom_parameters: input.custom_parameters,
      closing_comment: input.closing_comment,
      submitted_at: input.submitted_at,
      submission_date_ist: input.submission_date_ist,
      clinic_id: input.clinic_id ?? null,
      franchise_id: input.franchise_id ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    H.db.health_logs.push(row);
    return { ...row };
  }),
}));

vi.mock("@/repositories/dietitian/cadenceRepository", () => ({
  getPausedDatesSince: vi.fn(
    async (customerProfileIds: string[], _sinceDate: string) => {
      const result = new Map<string, string[]>();
      for (const id of customerProfileIds) {
        const set = H.db.paused_dates.get(id);
        if (set && set.size > 0) result.set(id, [...set].sort());
      }
      return result;
    },
  ),
}));

vi.mock("@/repositories/dietitian/auditRepository", () => ({
  insertAuditEntry: vi.fn(async (input: any) => {
    const entry = {
      id: `audit-${H.db.audit_entries.length + 1}`,
      health_log_id: input.healthLogId,
      customer_profile_id: input.customerProfileId,
      log_date: input.logDate,
      actor_user_id: input.actorUserId,
      action: input.action,
      outcome: input.outcome,
      rejection_reason: input.rejectionReason ?? null,
      changed_values: input.changedValues ?? null,
      created_at: new Date().toISOString(),
    };
    H.db.audit_entries.push(entry);
    return entry;
  }),
}));

// `getExistingDietitianLog` in HealthLogService reads directly through
// `@/lib/supabase/admin` rather than through healthLogRepository — mock it
// too, backed by the same in-memory `health_logs` table.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "health_logs") {
        throw new Error(`unexpected table access in test fake: ${table}`);
      }
      const filters: Array<{ col: string; val: unknown }> = [];
      const builder: any = {
        select: () => builder,
        delete: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push({ col, val });
          return builder;
        },
        maybeSingle: async () => {
          const row = H.db.health_logs.find((r: any) =>
            filters.every((f) => r[f.col] === f.val),
          );
          return { data: row ?? null, error: null };
        },
      };
      return builder;
    },
  }),
}));

// ─── System under test (imported after the mocks are registered) ───────────
import {
  submitHealthLog,
  deleteHealthLog,
  type HealthLogActor,
  type SubmitHealthLogInput,
} from "@/services/HealthLogService";
import {
  LOG_DATE_IN_FUTURE,
  LOG_DATE_IS_PAUSED,
  LOG_NO_LONGER_EDITABLE,
  CAN_ONLY_EDIT_OWN_LOGS,
  AUTHOR_NOT_IDENTIFIED,
  HEALTH_LOGS_CANNOT_BE_DELETED,
} from "@/lib/dietitian/messages";
import {
  customerCategoryArb,
  sparseParameterMapArb,
  uniqueCustomParameterListArb,
  addDays,
} from "@/test/dietitian/arbitraries";

// ─── Generators ──────────────────────────────────────────────────────────────

/** Deterministic, Zod-`.uuid()`-valid ids for two customers and two dietitians. */
const CUSTOMER_IDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
] as const;
const DIETITIAN_IDS = [
  "00000000-0000-4000-8000-000000000011",
  "00000000-0000-4000-8000-000000000012",
] as const;

const ANCHOR_TODAY = "2025-06-15";

const closingCommentArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length >= 1 && s.trim().length <= 2000);

/** One submission "step": a customer/dietitian pair, a log date offset from
 * today, and a payload. `logDateOffset` is applied against the CURRENT
 * simulated "today" at the time the step runs, letting the sequence probe
 * future dates, today, and past dates uniformly. */
const submitStepArb = customerCategoryArb.chain((category) =>
  fc.record({
    kind: fc.constant("submit" as const),
    customerProfileId: fc.constantFrom(...CUSTOMER_IDS),
    dietitianUserId: fc.constantFrom(...DIETITIAN_IDS),
    logDateOffset: fc.integer({ min: -3, max: 2 }), // relative to "today" at run time
    category: fc.constant(category),
    closingComment: closingCommentArb,
    parameters: sparseParameterMapArb(category, { allowEmpty: true }),
    customParameters: uniqueCustomParameterListArb({ maxLength: 3 }),
    markPaused: fc.boolean(), // whether to mark the target log date as paused before this step
    dayAdvance: fc.integer({ min: 0, max: 2 }), // advance "today" by this many days before the step
    missingActor: fc.boolean(), // simulate an unresolvable author
  }),
);

const deleteStepArb = fc.record({
  kind: fc.constant("delete" as const),
  dayAdvance: fc.integer({ min: 0, max: 2 }),
});

const stepArb = fc.oneof(
  { arbitrary: submitStepArb, weight: 4 },
  { arbitrary: deleteStepArb, weight: 1 },
);

const sequenceArb = fc.array(stepArb, { minLength: 1, maxLength: 20 });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function countLogsFor(customerProfileId: string, logDate: string): number {
  return H.db.health_logs.filter(
    (r: any) => r.customer_profile_id === customerProfileId && r.log_date === logDate,
  ).length;
}

function markPausedIfRequested(customerProfileId: string, logDate: string) {
  const set = H.db.paused_dates.get(customerProfileId) ?? new Set<string>();
  set.add(logDate);
  H.db.paused_dates.set(customerProfileId, set);
}

beforeEach(() => {
  H.reset();
});

// ─── Property 22 (task 7.14) ─────────────────────────────────────────────────
describe("Property 22: The Health_Log write gate", () => {
  it(
    "never persists more than one Dietitian_Log per (customer, log date); resubmission by " +
      "the same Dietitian updates the log; every rejection returns the pinned message and " +
      "changes nothing; deletes never mutate state",
    async () => {
      await fc.assert(
        fc.asyncProperty(sequenceArb, async (steps) => {
          H.reset();

          // Tracks the last-accepted (author, submissionDateIst) per
          // (customer, logDate) so we can assert the edit-window/authorship
          // outcomes independently of the service's own bookkeeping.
          const lastAccepted = new Map<
            string,
            { authorUserId: string; submissionDateIst: string }
          >();
          const keyOf = (customerProfileId: string, logDate: string) =>
            `${customerProfileId}::${logDate}`;

          for (const step of steps) {
            if (step.dayAdvance > 0) {
              H.setToday(addDays(H.getToday(), step.dayAdvance));
            }

            if (step.kind === "delete") {
              const before = JSON.parse(JSON.stringify(H.db.health_logs));
              const result = await deleteHealthLog();
              expect(result.ok).toBe(false);
              if (!result.ok) expect(result.error).toBe(HEALTH_LOGS_CANNOT_BE_DELETED);
              // Delete never mutates state.
              expect(H.db.health_logs).toEqual(before);
              continue;
            }

            // --- submit step ---
            const today = H.getToday();
            const logDate = addDays(today, step.logDateOffset);
            const k = keyOf(step.customerProfileId, logDate);

            if (step.markPaused) {
              markPausedIfRequested(step.customerProfileId, logDate);
            }

            const input: SubmitHealthLogInput = {
              customerProfileId: step.customerProfileId,
              logDate,
              category: step.category,
              parameters: step.parameters,
              customParameters: step.customParameters,
              closingComment: step.closingComment,
            };
            const actor: HealthLogActor = step.missingActor
              ? ({ userId: undefined as any })
              : { userId: step.dietitianUserId, clinicId: null, franchiseId: null };

            const existingBefore = H.findExisting(step.customerProfileId, logDate);
            const countBefore = countLogsFor(step.customerProfileId, logDate);
            const snapshotBefore = existingBefore ? { ...existingBefore } : null;

            const result = await submitHealthLog(input, actor);

            // 1. Missing author identifier is rejected first, regardless of
            // anything else (Req 15.13).
            if (step.missingActor) {
              expect(result.ok).toBe(false);
              if (!result.ok) expect(result.error).toBe(AUTHOR_NOT_IDENTIFIED);
              expect(countLogsFor(step.customerProfileId, logDate)).toBe(countBefore);
              if (snapshotBefore) {
                expect(H.findExisting(step.customerProfileId, logDate)).toEqual(
                  snapshotBefore,
                );
              }
              continue;
            }

            // 2. A future log date is always rejected (Req 15.7).
            if (logDate > today) {
              expect(result.ok).toBe(false);
              if (!result.ok) expect(result.error).toBe(LOG_DATE_IN_FUTURE);
              expect(countLogsFor(step.customerProfileId, logDate)).toBe(countBefore);
              if (snapshotBefore) {
                expect(H.findExisting(step.customerProfileId, logDate)).toEqual(
                  snapshotBefore,
                );
              }
              continue;
            }

            const priorAccepted = lastAccepted.get(k);

            if (existingBefore) {
              // UPDATE path.
              if (existingBefore.author_user_id !== step.dietitianUserId) {
                // 3. Update by a different Dietitian is rejected (Req 18.3).
                expect(result.ok).toBe(false);
                if (!result.ok) expect(result.error).toBe(CAN_ONLY_EDIT_OWN_LOGS);
                expect(H.findExisting(step.customerProfileId, logDate)).toEqual(
                  snapshotBefore,
                );
                continue;
              }
              if (existingBefore.submission_date_ist !== today) {
                // 4. Edit window closed — same-day only (Req 18.1, 18.2).
                expect(result.ok).toBe(false);
                if (!result.ok) expect(result.error).toBe(LOG_NO_LONGER_EDITABLE);
                expect(H.findExisting(step.customerProfileId, logDate)).toEqual(
                  snapshotBefore,
                );
                continue;
              }
              // Same Dietitian, same-day submission_date_ist → permitted,
              // even on a date that has since become paused (Req 15.10).
              expect(result.ok).toBe(true);
              const after = H.findExisting(step.customerProfileId, logDate);
              expect(after.id).toBe(existingBefore.id); // updates, not a second row
              expect(countLogsFor(step.customerProfileId, logDate)).toBe(1);
              lastAccepted.set(k, {
                authorUserId: step.dietitianUserId,
                submissionDateIst: today,
              });
            } else {
              // CREATE path: a Paused_Day blocks creation (Req 15.8).
              const pausedSet = H.db.paused_dates.get(step.customerProfileId);
              const isPaused = pausedSet?.has(logDate) ?? false;
              if (isPaused) {
                expect(result.ok).toBe(false);
                if (!result.ok) expect(result.error).toBe(LOG_DATE_IS_PAUSED);
                expect(countLogsFor(step.customerProfileId, logDate)).toBe(0);
                continue;
              }
              expect(result.ok).toBe(true);
              expect(countLogsFor(step.customerProfileId, logDate)).toBe(1);
              lastAccepted.set(k, {
                authorUserId: step.dietitianUserId,
                submissionDateIst: today,
              });
            }

            void priorAccepted; // documented via existingBefore branch above

            // Global invariant after every accepted/attempted step: at most
            // one Dietitian_Log per (customer, log date) (Req 15.9, 15.11).
            expect(countLogsFor(step.customerProfileId, logDate)).toBeLessThanOrEqual(1);
          }

          // Final-state invariant across the whole sequence.
          const seen = new Set<string>();
          for (const row of H.db.health_logs) {
            const rowKey = keyOf(row.customer_profile_id, row.log_date);
            expect(seen.has(rowKey)).toBe(false);
            seen.add(rowKey);
          }
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    "rejects a create on a Paused_Day but permits an update to an existing log on a date " +
      "that has since become paused (Req 15.8, 15.10)",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...CUSTOMER_IDS),
          fc.constantFrom(...DIETITIAN_IDS),
          customerCategoryArb,
          closingCommentArb,
          async (customerProfileId, dietitianUserId, category, closingComment) => {
            H.reset();
            const today = ANCHOR_TODAY;
            H.setToday(today);
            const logDate = today;
            const actor: HealthLogActor = { userId: dietitianUserId, clinicId: null, franchiseId: null };
            const basePayload: SubmitHealthLogInput = {
              customerProfileId,
              logDate,
              category,
              parameters: {},
              customParameters: [],
              closingComment,
            };

            // Paused BEFORE any log exists → CREATE is rejected.
            markPausedIfRequested(customerProfileId, logDate);
            const createResult = await submitHealthLog(basePayload, actor);
            expect(createResult.ok).toBe(false);
            if (!createResult.ok) expect(createResult.error).toBe(LOG_DATE_IS_PAUSED);
            expect(countLogsFor(customerProfileId, logDate)).toBe(0);

            // Unpause, create for real, then pause again — the existing
            // log's same-day UPDATE must still be permitted.
            H.db.paused_dates.set(customerProfileId, new Set());
            const firstCreate = await submitHealthLog(basePayload, actor);
            expect(firstCreate.ok).toBe(true);
            expect(countLogsFor(customerProfileId, logDate)).toBe(1);

            markPausedIfRequested(customerProfileId, logDate);
            const updateResult = await submitHealthLog(
              { ...basePayload, closingComment: `${closingComment} updated` },
              actor,
            );
            expect(updateResult.ok).toBe(true);
            expect(countLogsFor(customerProfileId, logDate)).toBe(1);
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it("rejects every delete attempt with the pinned message and never mutates state", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...CUSTOMER_IDS),
        fc.constantFrom(...DIETITIAN_IDS),
        customerCategoryArb,
        closingCommentArb,
        async (customerProfileId, dietitianUserId, category, closingComment) => {
          H.reset();
          H.setToday(ANCHOR_TODAY);
          const actor: HealthLogActor = { userId: dietitianUserId, clinicId: null, franchiseId: null };
          await submitHealthLog(
            {
              customerProfileId,
              logDate: ANCHOR_TODAY,
              category,
              parameters: {},
              customParameters: [],
              closingComment,
            },
            actor,
          );
          const before = JSON.parse(JSON.stringify(H.db.health_logs));

          const result = await deleteHealthLog();

          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.error).toBe(HEALTH_LOGS_CANNOT_BE_DELETED);
          expect(H.db.health_logs).toEqual(before);
        },
      ),
      { numRuns: 100 },
    );
  });
});
