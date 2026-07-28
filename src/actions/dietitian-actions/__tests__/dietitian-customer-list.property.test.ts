/* eslint-disable @typescript-eslint/no-explicit-any */
// src/actions/dietitian-actions/__tests__/dietitian-customer-list.property.test.ts
// Feature: dietitian-management, Property 25
//
// Property 25 (design.md): "For any set of Customer_Records in scope and any
// search query, the rendered list contains exactly the records whose name,
// mobile or customer code matches the query, and every rendered row carries
// that record's name, mobile, Customer_Category, Last_Dietitian_Log_Date,
// Days_Not_Logged, Pending_Log_Count and assigned Dietitian name."
// Validates: Requirements 15.3, 15.4, 16.6
//
// `listDietitianCustomers` (src/actions/dietitian-actions/dietitianCustomerActions.ts)
// composes `guardDietitianPage`/`dietitianScopeFromContext` (auth),
// `listInScopeCustomerListRows` (scope + identity read),
// `computeCadenceForCustomers` + `getLastDietitianLogDates` (cadence), and the
// real, unmocked `applyDietitianFilters` (src/lib/dietitian/listFilters.ts) for
// the search matching semantics. We mock every I/O seam with in-memory fakes
// driven by an arbitrary set of in-scope customer rows and an arbitrary search
// query — sometimes a genuine substring of one of the searchable fields,
// sometimes not — and assert the rendered rows are exactly the matching set,
// each carrying the source record's own field values.
//
// vitest + fast-check, >=100 runs.

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory world (hoisted so the vi.mock factories can close over it)
const H = vi.hoisted(() => {
  const state: any = {};

  function reset() {
    state.listRows = [] as Array<{
      customerProfileId: string;
      customerCode: string | null;
      name: string;
      mobile: string | null;
      category: "MEAL" | "KIT" | "ACCOMMODATION";
      assignedDietitianName: string | null;
    }>;
    state.cadenceByCustomer = new Map<
      string,
      { daysNotLogged: number; pendingLogCount: number }
    >();
    state.lastLogDates = new Map<string, string>();
  }

  reset();
  return { state, reset };
});

vi.mock("@/lib/auth/adminAccess", () => ({
  guardDietitianPage: vi.fn(async () => ({
    userId: "dietitian-1",
    roleCode: "ADMIN",
    clinicId: null,
    franchiseId: null,
  })),
  dietitianScopeFromContext: vi.fn(() => ({
    kind: "core",
    dietitianUserId: "dietitian-1",
    clinicId: null,
  })),
  checkDietitianScope: vi.fn(async () => ({ ok: false, error: "not used" })),
}));

vi.mock("@/repositories/dietitian/assignmentRepository", () => ({
  listInScopeCustomerListRows: vi.fn(async () => H.state.listRows),
  getCustomerDetailRow: vi.fn(async () => null),
}));

vi.mock("@/repositories/dietitian/cadenceRepository", () => ({
  getLastDietitianLogDates: vi.fn(async (ids: readonly string[]) => {
    const result = new Map<string, string>();
    for (const id of ids) {
      const date = H.state.lastLogDates.get(id);
      if (date !== undefined) result.set(id, date);
    }
    return result;
  }),
}));

vi.mock("@/repositories/dietitian/healthLogRepository", () => ({
  getCustomParameterLabelSuggestions: vi.fn(async () => []),
}));

vi.mock("@/services/CadenceService", () => ({
  computeCadenceForCustomers: vi.fn(async (ids: readonly string[]) => {
    const result = new Map<string, any>();
    for (const id of ids) {
      const cadence = H.state.cadenceByCustomer.get(id);
      result.set(id, {
        cadenceInterval: 0,
        effectiveLastLogDate: "2024-01-01",
        daysNotLogged: cadence?.daysNotLogged ?? 0,
        pendingLogCount: cadence?.pendingLogCount ?? 0,
        pausedDaysCount: 0,
        eligibleDaysInWindow: 0,
        skippedSelfLogCount: 0,
        datesWithoutSelfLogCount: 0,
      });
    }
    return result;
  }),
  getCadenceForCustomer: vi.fn(async () => ({
    cadenceInterval: 0,
    effectiveLastLogDate: "2024-01-01",
    daysNotLogged: 0,
    pendingLogCount: 0,
    pausedDaysCount: 0,
    eligibleDaysInWindow: 0,
    skippedSelfLogCount: 0,
    datesWithoutSelfLogCount: 0,
  })),
}));

// ─── System under test (imported after the mocks are registered) ───────────
import { listDietitianCustomers } from "@/actions/dietitian-actions/dietitianCustomerActions";

beforeEach(() => {
  H.reset();
});

// ─── Generators ──────────────────────────────────────────────────────────────

const arbCategory = fc.constantFrom<"MEAL" | "KIT" | "ACCOMMODATION">(
  "MEAL",
  "KIT",
  "ACCOMMODATION",
);

const arbIsoDate = fc
  .tuple(
    fc.integer({ min: 2023, max: 2025 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(
    ([y, m, d]) =>
      `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
  );

const arbName = fc
  .string({ minLength: 1, maxLength: 15 })
  .filter((s) => s.trim().length > 0);

const arbMobile = fc.option(
  fc.stringMatching(/^[6-9][0-9]{9}$/),
  { nil: null },
);

const arbCustomerCode = fc.option(
  fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.trim().length > 0),
  { nil: null },
);

const arbAssignedDietitianName = fc.option(
  fc.string({ minLength: 1, maxLength: 15 }).filter((s) => s.trim().length > 0),
  { nil: null },
);

const arbRow = fc.record({
  customerProfileId: fc.uuid(),
  customerCode: arbCustomerCode,
  name: arbName,
  mobile: arbMobile,
  category: arbCategory,
  assignedDietitianName: arbAssignedDietitianName,
  lastDietitianLogDate: fc.option(arbIsoDate, { nil: null }),
  daysNotLogged: fc.nat({ max: 60 }),
  pendingLogCount: fc.nat({ max: 30 }),
});

const arbRows = fc.uniqueArray(arbRow, {
  selector: (r) => r.customerProfileId,
  minLength: 1,
  maxLength: 10,
});

/** Picks a field + optional substring bounds so the query is sometimes a
 * genuine substring of one of the seeded rows' searchable fields. */
const arbQueryPlan = fc.record({
  useExisting: fc.boolean(),
  rowIndex: fc.nat({ max: 9999 }),
  field: fc.constantFrom<"name" | "mobile" | "customerCode">(
    "name",
    "mobile",
    "customerCode",
  ),
  sliceStart: fc.nat({ max: 20 }),
  sliceLen: fc.nat({ max: 20 }),
  fallback: fc.string({ maxLength: 12 }),
});

function buildQuery(plan: any, rows: any[]): string {
  if (plan.useExisting && rows.length > 0) {
    const row = rows[plan.rowIndex % rows.length] as any;
    const value = row[plan.field] as string | null;
    if (typeof value === "string" && value.length > 0) {
      const start = plan.sliceStart % value.length;
      const end = Math.min(value.length, start + (plan.sliceLen % value.length || 1));
      const substring = value.slice(start, end);
      if (substring.length > 0) return substring;
    }
  }
  return plan.fallback;
}

/** Mirrors `matchesDietitianSearch` (case-insensitive substring on name/mobile/customerCode). */
function expectedMatch(row: { name: string; mobile: string | null; customerCode: string | null }, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (needle.length === 0) return true;
  return [row.name, row.mobile, row.customerCode].some(
    (value) => typeof value === "string" && value.toLowerCase().includes(needle),
  );
}

// ─── Property 25 ─────────────────────────────────────────────────────────────
describe("Property 25: Dietitian customer list search matches exactly, rows carry source fields", () => {
  it("returns exactly the matching in-scope records, each carrying its own field values", async () => {
    await fc.assert(
      fc.asyncProperty(arbRows, arbQueryPlan, async (rows, queryPlan) => {
        H.reset();

        const query = buildQuery(queryPlan, rows);

        for (const row of rows) {
          H.state.listRows.push({
            customerProfileId: row.customerProfileId,
            customerCode: row.customerCode,
            name: row.name,
            mobile: row.mobile,
            category: row.category,
            assignedDietitianName: row.assignedDietitianName,
          });
          H.state.cadenceByCustomer.set(row.customerProfileId, {
            daysNotLogged: row.daysNotLogged,
            pendingLogCount: row.pendingLogCount,
          });
          if (row.lastDietitianLogDate !== null) {
            H.state.lastLogDates.set(row.customerProfileId, row.lastDietitianLogDate);
          }
        }

        const result = await listDietitianCustomers({ search: query });

        expect(result.success).toBe(true);
        if (!result.success) return;

        const expectedIds = new Set(
          rows.filter((row) => expectedMatch(row, query)).map((row) => row.customerProfileId),
        );
        const actualIds = new Set(result.data.rows.map((r) => r.customerProfileId));

        // Exactly the matching records — no more, no fewer (Req 15.4).
        expect(actualIds).toEqual(expectedIds);

        // Every rendered row carries its source record's own field values
        // (Req 15.3, 16.6).
        const bySource = new Map(rows.map((row) => [row.customerProfileId, row]));
        for (const rendered of result.data.rows) {
          const source = bySource.get(rendered.customerProfileId);
          expect(source).toBeDefined();
          if (!source) continue;

          expect(rendered.name).toBe(source.name);
          expect(rendered.mobile).toBe(source.mobile);
          expect(rendered.category).toBe(source.category);
          expect(rendered.lastDietitianLogDate).toBe(source.lastDietitianLogDate);
          expect(rendered.daysNotLogged).toBe(source.daysNotLogged);
          expect(rendered.pendingLogCount).toBe(source.pendingLogCount);
          expect(rendered.assignedDietitianName).toBe(source.assignedDietitianName);
        }
      }),
      { numRuns: 100 },
    );
  });
});
