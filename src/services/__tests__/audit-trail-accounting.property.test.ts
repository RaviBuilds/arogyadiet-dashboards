/* eslint-disable @typescript-eslint/no-explicit-any */
// src/services/__tests__/audit-trail-accounting.property.test.ts
// Feature: dietitian-management, Property 23
//
// Property 23 (design.md): For any sequence of Health_Log create and update
// attempts, the number of audit entries equals the number of attempted
// operations; the number of entries whose outcome is `ACCEPTED` equals the
// number of persisted Health_Log versions; every accepted entry records the
// acting user, action, timestamp, Customer_Record, log date and changed
// parameter values; every rejected entry additionally records the rejection
// reason; and the rendered Master view lists entries in reverse chronological
// order with each entry's outcome.
//
// Validates: Requirements 18.5, 18.6, 18.8, 18.9, 18.10
//
// SUT: `submitHealthLog` (src/services/HealthLogService.ts), which is the
// single call site that appends exactly one Log_Audit_Trail entry per write
// attempt via `tryRecordAudit` → `insertAuditEntry`
// (src/repositories/dietitian/auditRepository.ts), and reads that trail back
// via `listAuditEntriesForCustomer`.
//
// `submitHealthLog` performs I/O through:
//   - `@/lib/supabase/admin`                          → fake createAdminClient,
//     used directly by the service for the pre-write "existing Dietitian_Log"
//     lookup and for compensating a failed CREATE. Backed by the SAME
//     in-memory `healthLogs` array the repository mock below writes to, so
//     both stay consistent.
//   - `@/repositories/dietitian/healthLogRepository`  → fake `upsertHealthLog`,
//     an in-memory check-then-write against `healthLogs`. Every successful
//     call — insert OR update — increments `healthLogVersions`, modeling
//     "persisted Health_Log versions" distinctly from row count (an UPDATE
//     does not create a new row, but it does produce a new version).
//   - `@/repositories/dietitian/auditRepository`       → fake `insertAuditEntry`
//     / `listAuditEntriesForCustomer` over an in-memory, append-only
//     `auditEntries` array with monotonically increasing `createdAt`.
//   - `@/repositories/dietitian/cadenceRepository`     → fake
//     `getPausedDatesSince`, driven by a per-customer configured set of
//     Paused_Days.
//
// `getISTDateString` (src/lib/dates/ist.ts) is left REAL (not mocked) so
// every submission in a test run is attributed to the actual current IST
// date — this keeps the same-day edit window open for every "update by the
// same author" attempt without needing to fake the clock.
//
// vitest + fast-check, >=100 runs.

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";
import { addDaysToISODate, getISTDateString } from "@/lib/dates/ist";
import {
  LOG_DATE_IN_FUTURE,
  CAN_ONLY_EDIT_OWN_LOGS,
  LOG_DATE_IS_PAUSED,
} from "@/lib/dietitian/messages";

// ─── Shared in-memory world (hoisted so the vi.mock factories can close over it)
const H = vi.hoisted(() => {
  const cfg: any = {
    pausedDatesByCustomer: new Map<string, string[]>(),
  };
  const db: any = {
    healthLogs: [] as any[],
    auditEntries: [] as any[],
    healthLogVersions: 0,
    seq: 0,
    auditSeq: 0,
    baseTime: Date.now(),
  };

  function reset() {
    cfg.pausedDatesByCustomer = new Map<string, string[]>();
    db.healthLogs = [];
    db.auditEntries = [];
    db.healthLogVersions = 0;
    db.seq = 0;
    db.auditSeq = 0;
    db.baseTime = Date.now();
  }

  // ── fake `@/lib/supabase/admin` — health_logs reads/deletes only ──────────
  function makeFakeAdmin() {
    return {
      from(table: string) {
        if (table !== "health_logs") {
          throw new Error(`Unexpected table access in test fake: ${table}`);
        }
        const filters: Record<string, unknown> = {};
        const builder: any = {
          select: () => builder,
          eq: (col: string, val: unknown) => {
            filters[col] = val;
            return builder;
          },
          maybeSingle: async () => {
            const row = db.healthLogs.find(
              (r: any) =>
                r.customer_profile_id === filters["customer_profile_id"] &&
                r.log_date === filters["log_date"] &&
                r.author_type === (filters["author_type"] ?? "DIETITIAN"),
            );
            return { data: row ?? null, error: null };
          },
          delete: () => ({
            eq: async (col: string, val: unknown) => {
              const idx = db.healthLogs.findIndex((r: any) => r[col] === val);
              if (idx >= 0) db.healthLogs.splice(idx, 1);
              return { data: null, error: null };
            },
          }),
        };
        return builder;
      },
    };
  }

  // ── fake healthLogRepository.upsertHealthLog — check-then-write ───────────
  async function upsertHealthLog(input: any) {
    const now = new Date().toISOString();
    const idx = db.healthLogs.findIndex(
      (r: any) =>
        r.customer_profile_id === input.customer_profile_id &&
        r.log_date === input.log_date &&
        r.author_type === "DIETITIAN",
    );

    if (idx >= 0) {
      const updated = {
        ...db.healthLogs[idx],
        author_user_id: input.author_user_id,
        customer_category: input.customer_category,
        parameters: input.parameters,
        custom_parameters: input.custom_parameters,
        closing_comment: input.closing_comment,
        submitted_at: input.submitted_at,
        submission_date_ist: input.submission_date_ist,
        clinic_id: input.clinic_id ?? null,
        franchise_id: input.franchise_id ?? null,
        updated_at: now,
      };
      db.healthLogs[idx] = updated;
      db.healthLogVersions += 1;
      return updated;
    }

    const row = {
      id: `hl-${++db.seq}`,
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
      created_at: now,
      updated_at: now,
    };
    db.healthLogs.push(row);
    db.healthLogVersions += 1;
    return row;
  }

  // ── fake auditRepository — append-only, in-memory ──────────────────────────
  async function insertAuditEntry(input: any) {
    const seq = ++db.auditSeq;
    const entry = {
      id: `audit-${seq}`,
      healthLogId: input.healthLogId,
      customerProfileId: input.customerProfileId,
      logDate: input.logDate,
      actorUserId: input.actorUserId,
      actorName: null,
      action: input.action,
      outcome: input.outcome,
      rejectionReason: input.rejectionReason ?? null,
      changedValues: input.changedValues ?? null,
      createdAt: new Date(db.baseTime + seq * 1000).toISOString(),
    };
    db.auditEntries.push(entry);
    return entry;
  }

  async function listAuditEntriesForCustomer(customerProfileId: string) {
    return db.auditEntries
      .filter((e: any) => e.customerProfileId === customerProfileId)
      .slice()
      .sort((a: any, b: any) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  // ── fake cadenceRepository.getPausedDatesSince ─────────────────────────────
  async function getPausedDatesSince(customerProfileIds: readonly string[], sinceDate: string) {
    const result = new Map<string, string[]>();
    for (const id of customerProfileIds) {
      const dates: string[] = (cfg.pausedDatesByCustomer.get(id) ?? []).filter(
        (d: string) => d >= sinceDate,
      );
      if (dates.length) result.set(id, dates);
    }
    return result;
  }

  reset();
  return {
    cfg,
    db,
    reset,
    makeFakeAdmin,
    upsertHealthLog,
    insertAuditEntry,
    listAuditEntriesForCustomer,
    getPausedDatesSince,
  };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.makeFakeAdmin(),
}));

vi.mock("@/repositories/dietitian/healthLogRepository", () => ({
  upsertHealthLog: (input: any) => H.upsertHealthLog(input),
}));

vi.mock("@/repositories/dietitian/auditRepository", () => ({
  insertAuditEntry: (input: any) => H.insertAuditEntry(input),
  listAuditEntriesForCustomer: (customerProfileId: string) =>
    H.listAuditEntriesForCustomer(customerProfileId),
}));

vi.mock("@/repositories/dietitian/cadenceRepository", () => ({
  getPausedDatesSince: (ids: readonly string[], sinceDate: string) =>
    H.getPausedDatesSince(ids, sinceDate),
}));

// ─── System under test (imported after the mocks are registered) ───────────────
import { submitHealthLog } from "@/services/HealthLogService";

const { cfg, db } = H;

// ─── Fixed pools (valid syntactic UUIDs) ─────────────────────────────────────
const CUSTOMERS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
const ACTORS = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
];

const LOG_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function submitAttempt(customerProfileId: string, logDate: string, actorUserId: string) {
  return submitHealthLog(
    {
      customerProfileId,
      logDate,
      category: "MEAL",
      parameters: {},
      customParameters: [],
      closingComment: "ok",
    },
    { userId: actorUserId },
  );
}

// ─── Generators ────────────────────────────────────────────────────────────────
const arbStep = fc.record({
  kind: fc.constantFrom("create", "update_same", "update_wrong", "future", "paused"),
  customerPick: fc.nat({ max: 2 }),
  actorPick: fc.nat({ max: 1 }),
  targetPick: fc.nat({ max: 9999 }),
});
const arbSteps = fc.array(arbStep, { minLength: 1, maxLength: 20 });

beforeEach(() => {
  H.reset();
});

// ─── Property 23 (task 7.15) ────────────────────────────────────────────────────
// Property 23: Audit-trail accounting.
// Validates: Requirements 18.5, 18.6, 18.8, 18.9, 18.10
describe("Property 23: Audit-trail accounting", () => {
  it("records exactly one audit entry per attempt, with accepted count == persisted versions, complete fields, and reverse-chronological reads", async () => {
    await fc.assert(
      fc.asyncProperty(arbSteps, async (steps) => {
        H.reset();
        const TODAY = getISTDateString();

        type Created = { customerProfileId: string; logDate: string; actorUserId: string };
        const created: Created[] = [];
        let dateCounter = 0;
        let expectedAccepted = 0;
        let expectedRejected = 0;

        async function doCreate(customerId: string, actorId: string) {
          dateCounter += 1;
          const logDate = addDaysToISODate(TODAY, -dateCounter);
          const result = await submitAttempt(customerId, logDate, actorId);
          expect(result.ok).toBe(true);
          created.push({ customerProfileId: customerId, logDate, actorUserId: actorId });
          expectedAccepted += 1;
        }

        for (const step of steps) {
          const customerId = CUSTOMERS[step.customerPick % CUSTOMERS.length];
          const actorId = ACTORS[step.actorPick % ACTORS.length];

          if (step.kind === "create") {
            await doCreate(customerId, actorId);
          } else if (step.kind === "update_same") {
            if (created.length === 0) {
              await doCreate(customerId, actorId);
            } else {
              const target = created[step.targetPick % created.length];
              const result = await submitAttempt(
                target.customerProfileId,
                target.logDate,
                target.actorUserId,
              );
              expect(result.ok).toBe(true);
              expectedAccepted += 1;
            }
          } else if (step.kind === "update_wrong") {
            if (created.length === 0) {
              await doCreate(customerId, actorId);
            } else {
              const target = created[step.targetPick % created.length];
              const wrongActor = ACTORS.find((a) => a !== target.actorUserId)!;
              const result = await submitAttempt(
                target.customerProfileId,
                target.logDate,
                wrongActor,
              );
              expect(result.ok).toBe(false);
              if (!result.ok) expect(result.error).toBe(CAN_ONLY_EDIT_OWN_LOGS);
              expectedRejected += 1;
            }
          } else if (step.kind === "future") {
            dateCounter += 1;
            const futureDate = addDaysToISODate(TODAY, 1 + (step.targetPick % 30));
            const result = await submitAttempt(customerId, futureDate, actorId);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error).toBe(LOG_DATE_IN_FUTURE);
            expectedRejected += 1;
          } else {
            // "paused" — a fresh (customer, date) pair, with that date marked
            // Paused for this customer before the create is attempted.
            dateCounter += 1;
            const pausedDate = addDaysToISODate(TODAY, -(1000 + dateCounter));
            const existing = cfg.pausedDatesByCustomer.get(customerId) ?? [];
            cfg.pausedDatesByCustomer.set(customerId, [...existing, pausedDate]);
            const result = await submitAttempt(customerId, pausedDate, actorId);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error).toBe(LOG_DATE_IS_PAUSED);
            expectedRejected += 1;
          }
        }

        // ── Accounting invariant (Req 18.9): one audit entry per attempt ──────
        expect(db.auditEntries.length).toBe(steps.length);
        expect(expectedAccepted + expectedRejected).toBe(steps.length);

        const acceptedEntries = db.auditEntries.filter((e: any) => e.outcome === "ACCEPTED");
        const rejectedEntries = db.auditEntries.filter((e: any) => e.outcome === "REJECTED");
        expect(acceptedEntries.length).toBe(expectedAccepted);
        expect(rejectedEntries.length).toBe(expectedRejected);

        // ── ACCEPTED count == persisted Health_Log versions (Req 18.9) ────────
        expect(db.healthLogVersions).toBe(acceptedEntries.length);

        // ── Every accepted entry: actor, action, timestamp, customer, log
        // date, and changed values (Req 18.5) ─────────────────────────────────
        for (const entry of acceptedEntries) {
          expect(typeof entry.actorUserId).toBe("string");
          expect(entry.actorUserId.length).toBeGreaterThan(0);
          expect(["CREATE", "UPDATE"]).toContain(entry.action);
          expect(typeof entry.createdAt).toBe("string");
          expect(entry.createdAt.length).toBeGreaterThan(0);
          expect(typeof entry.customerProfileId).toBe("string");
          expect(CUSTOMERS).toContain(entry.customerProfileId);
          expect(entry.logDate).toMatch(LOG_DATE_RE);
          expect(entry.changedValues).not.toBeNull();
          expect(typeof entry.changedValues).toBe("object");
          expect(entry.rejectionReason).toBeNull();
        }

        // ── Every rejected entry additionally records the rejection reason
        // (Req 18.6) ────────────────────────────────────────────────────────────
        for (const entry of rejectedEntries) {
          expect(typeof entry.rejectionReason).toBe("string");
          expect(entry.rejectionReason.length).toBeGreaterThan(0);
          expect([LOG_DATE_IN_FUTURE, CAN_ONLY_EDIT_OWN_LOGS, LOG_DATE_IS_PAUSED]).toContain(
            entry.rejectionReason,
          );
        }

        // ── Reverse-chronological read per Customer_Record, outcome intact
        // (Req 18.8, 18.10) ─────────────────────────────────────────────────────
        for (const customerId of CUSTOMERS) {
          const expectedForCustomer = db.auditEntries.filter(
            (e: any) => e.customerProfileId === customerId,
          );
          const listed = await H.listAuditEntriesForCustomer(customerId);

          expect(listed.length).toBe(expectedForCustomer.length);

          // Sorted strictly non-increasing by createdAt (newest first).
          for (let i = 0; i + 1 < listed.length; i++) {
            expect(listed[i].createdAt >= listed[i + 1].createdAt).toBe(true);
          }

          // Each listed entry's outcome matches the entry originally recorded.
          const byId = new Map<string, any>(
            expectedForCustomer.map((e: any) => [e.id, e] as [string, any]),
          );
          for (const entry of listed) {
            const original = byId.get(entry.id);
            expect(original).toBeDefined();
            expect(entry.outcome).toBe(original!.outcome);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
