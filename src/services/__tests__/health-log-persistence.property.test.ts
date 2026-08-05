/* eslint-disable @typescript-eslint/no-explicit-any */
// src/services/__tests__/health-log-persistence.property.test.ts
// Feature: dietitian-management, Property 17
//
// Property 17 (design.md): For any valid Health_Log, persisting it and then
// reading it yields equal parameter values, equal units, an equal ordered
// Custom_Parameter list and an equal Closing_Comment, together with the
// authoring user identifier, author type and submission timestamp; a unit is
// stored for a numeric parameter iff that parameter carries a value.
//
// Validates: Requirements 11.12, 11.13, 11.14, 12.2, 13.4, 15.12
//
// `HealthLogService.submitHealthLog` runs for REAL against
// `healthLogRepository.upsertHealthLog` (also real). Only the Supabase admin
// client (`@/lib/supabase/admin`) is mocked, backed by an in-memory
// `health_logs` table (plus empty stand-ins for the other tables the write
// path touches: `subscription_daily_preferences` for the Paused_Day check and
// `health_log_audit_entries` for the audit write), mirroring the house style
// in `onboardingService.property.test.ts`.
//
// vitest + fast-check, >=100 runs.

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory world (hoisted so the vi.mock factory can close over it)
const H = vi.hoisted(() => {
  const db: any = {};
  let seq = 0;

  function reset() {
    db.health_logs = [];
    db.subscription_daily_preferences = [];
    db.health_log_audit_entries = [];
    seq = 0;
  }

  function matchesFilters(
    row: any,
    filters: Array<{ col: string; op: string; val: unknown }>,
  ): boolean {
    return filters.every((f) => {
      const cell = row[f.col];
      switch (f.op) {
        case "eq":
          return cell === f.val;
        case "in":
          return Array.isArray(f.val) && (f.val as unknown[]).includes(cell);
        case "gte":
          return cell >= (f.val as any);
        case "lte":
          return cell <= (f.val as any);
        default:
          return true;
      }
    });
  }

  /** A minimal fake PostgREST query builder: chainable AND awaitable. */
  function makeBuilder(table: string) {
    const state: {
      op: "select" | "insert" | "update" | "delete" | null;
      filters: Array<{ col: string; op: string; val: unknown }>;
      payload: any;
    } = { op: null, filters: [], payload: null };

    async function execute(): Promise<{ data: any; error: any }> {
      const rows: any[] = db[table] ?? (db[table] = []);

      if (state.op === "insert") {
        const row = {
          id: `${table}-${++seq}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...state.payload,
        };
        rows.push(row);
        return { data: row, error: null };
      }

      if (state.op === "update") {
        const idx = rows.findIndex((r) => matchesFilters(r, state.filters));
        if (idx === -1) return { data: null, error: { message: "not found" } };
        rows[idx] = { ...rows[idx], ...state.payload };
        return { data: rows[idx], error: null };
      }

      if (state.op === "delete") {
        const idx = rows.findIndex((r) => matchesFilters(r, state.filters));
        if (idx !== -1) rows.splice(idx, 1);
        return { data: null, error: null };
      }

      // select (default)
      return { data: rows.filter((r) => matchesFilters(r, state.filters)), error: null };
    }

    const builder: any = {
      select() {
        if (!state.op) state.op = "select";
        return builder;
      },
      insert(payload: any) {
        state.op = "insert";
        state.payload = payload;
        return builder;
      },
      update(payload: any) {
        state.op = "update";
        state.payload = payload;
        return builder;
      },
      delete() {
        state.op = "delete";
        return builder;
      },
      eq(col: string, val: unknown) {
        state.filters.push({ col, op: "eq", val });
        return builder;
      },
      in(col: string, val: unknown[]) {
        state.filters.push({ col, op: "in", val });
        return builder;
      },
      gte(col: string, val: unknown) {
        state.filters.push({ col, op: "gte", val });
        return builder;
      },
      lte(col: string, val: unknown) {
        state.filters.push({ col, op: "lte", val });
        return builder;
      },
      order() {
        return builder;
      },
      maybeSingle: async () => {
        const { data, error } = await execute();
        const arr = Array.isArray(data) ? data : data ? [data] : [];
        return { data: arr[0] ?? (state.op === "select" ? null : data), error };
      },
      single: async () => {
        const { data, error } = await execute();
        const arr = Array.isArray(data) ? data : data ? [data] : [];
        if (arr.length === 0) return { data: null, error: error ?? { message: "no rows" } };
        return { data: arr[0], error };
      },
      then(resolve: any, reject: any) {
        return execute().then(resolve, reject);
      },
    };

    return builder;
  }

  function makeFakeAdmin() {
    return { from: (table: string) => makeBuilder(table) };
  }

  reset();
  return { db, reset, makeFakeAdmin };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.makeFakeAdmin(),
}));

// The write gate consults the Report_Card lock (report-card-lifecycle Phase 3);
// this suite is about PERSISTENCE, so the lock is stubbed to "no covering
// report" — the state that leaves the persistence path unchanged.
vi.mock("@/services/ReportCardService", () => ({
  findReportCardForDate: vi.fn(async () => null),
}));

// ─── System under test (imported after the mock is registered) ─────────────
import { submitHealthLog, type HealthLogActor } from "@/services/HealthLogService";
import { fieldSetFor } from "@/lib/dietitian/fieldSets";
import { healthLogSchemaFor } from "@/validations/healthLogSchema";
import { getISTDateString } from "@/lib/dates/ist";
import {
  customerCategoryArb,
  sparseParameterMapArb,
  uniqueCustomParameterListArb,
} from "@/test/dietitian/arbitraries";

// ─── Generators ──────────────────────────────────────────────────────────────

/** A Closing_Comment that survives the schema's trim + 1..2000 length gate. */
const closingCommentArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 300 })
  .filter((s) => {
    const trimmed = s.trim();
    return trimmed.length >= 1 && trimmed.length <= 2000;
  });

/** A full, category-coherent Health_Log submission payload. */
const healthLogSubmissionArb = customerCategoryArb.chain((category) =>
  fc.record({
    category: fc.constant(category),
    customerProfileId: fc.uuid(),
    authorUserId: fc.uuid(),
    closingComment: closingCommentArb,
    parameters: sparseParameterMapArb(category),
    customParameters: uniqueCustomParameterListArb({ maxLength: 8 }),
  }),
);

beforeEach(() => {
  H.reset();
});

// ─── Property 17 (task 7.13) ─────────────────────────────────────────────────
// Property 17: Health_Log persistence round-trip.
// Validates: Requirements 11.12, 11.13, 11.14, 12.2, 13.4, 15.12
describe("Property 17: Health_Log persistence round-trip", () => {
  it(
    "reads back equal parameter values/units, an equal ordered Custom_Parameter list, " +
      "an equal Closing_Comment, and the authoring user id/type/submission timestamp",
    async () => {
      await fc.assert(
        fc.asyncProperty(healthLogSubmissionArb, async (input) => {
          H.reset();

          const logDate = getISTDateString(); // never in the future
          const actor: HealthLogActor = {
            userId: input.authorUserId,
            clinicId: null,
            franchiseId: null,
          };

          // Ground truth: the exact same schema `submitHealthLog` validates
          // against internally — this is what a "valid Health_Log" resolves to.
          const parsed = healthLogSchemaFor(input.category).safeParse({
            customerProfileId: input.customerProfileId,
            logDate,
            parameters: input.parameters,
            customParameters: input.customParameters,
            closingComment: input.closingComment,
          });
          expect(parsed.success).toBe(true);
          if (!parsed.success) return;
          const validated = parsed.data;

          const result = await submitHealthLog(
            {
              customerProfileId: input.customerProfileId,
              logDate,
              category: input.category,
              parameters: input.parameters,
              customParameters: input.customParameters,
              closingComment: input.closingComment,
            },
            actor,
          );

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const row = H.db.health_logs.find(
            (r: any) =>
              r.customer_profile_id === input.customerProfileId &&
              r.log_date === logDate &&
              r.author_type === "DIETITIAN",
          );
          expect(row).toBeDefined();

          // Equal parameter values (Req 11.12, 11.14).
          expect(row.parameters).toEqual(validated.parameters);
          expect(result.healthLog.parameters).toEqual(validated.parameters);

          // A unit is stored for a numeric parameter iff it carries a value
          // (Req 11.12, 11.13).
          for (const field of fieldSetFor(input.category)) {
            if (field.kind !== "number") continue;
            const persisted = row.parameters[field.key] as
              | { value: number; unit: string | null }
              | undefined;
            const carriesValue = persisted !== undefined;
            const hasUnit =
              carriesValue && persisted!.unit !== null && persisted!.unit !== undefined;
            expect(hasUnit).toBe(carriesValue);
          }

          // Equal, ordered Custom_Parameter list (Req 12.2).
          expect(row.custom_parameters).toEqual(
            validated.customParameters.map(({ label, value, unit }) => ({
              label,
              value,
              unit,
            })),
          );
          expect(result.healthLog.customParameters).toEqual(validated.customParameters);

          // Equal Closing_Comment (Req 13.4).
          expect(row.closing_comment).toBe(validated.closingComment);
          expect(result.healthLog.closingComment).toBe(validated.closingComment);

          // Authoring user identifier, author type, submission timestamp
          // (Req 15.12).
          expect(row.author_user_id).toBe(actor.userId);
          expect(row.author_type).toBe("DIETITIAN");
          expect(result.healthLog.authorUserId).toBe(actor.userId);
          expect(result.healthLog.authorType).toBe("DIETITIAN");
          expect(row.submitted_at).toBe(result.healthLog.submittedAt);
          expect(typeof row.submitted_at).toBe("string");
          expect(Number.isNaN(Date.parse(row.submitted_at))).toBe(false);
        }),
        { numRuns: 100 },
      );
    },
  );
});
