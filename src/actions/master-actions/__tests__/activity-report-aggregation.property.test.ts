/* eslint-disable @typescript-eslint/no-explicit-any */
// src/actions/master-actions/__tests__/activity-report-aggregation.property.test.ts
// Feature: dietitian-management, Property 33
//
// Property 33 (design.md): "For any Dietitian and any set of that Dietitian's
// linked Customer_Records, the report's count of records with
// Pending_Log_Count greater than 0 equals the number of such rows in its
// per-customer table and is less than or equal to the total linked-record
// count, Max_Days_Not_Logged equals the maximum Days_Not_Logged in that
// table, the missing-Self_Log count equals the number of rows with at least
// one window date lacking a Self_Log, every table row carries all seven
// reported values, and the Franchise-scoped report restricted to a Franchise
// yields values equal to those the Master report produces for the same
// Dietitian."
//
// Validates: Requirements 20.2, 20.3, 20.4, 20.5, 20.9, 20.10, 24.2, 24.6
//
// This exercises the REAL `getDietitianActivityReport`
// (`src/actions/master-actions/dietitianActivityActions.ts`) and the REAL
// `getFranchiseDietitianActivityReport`
// (`src/actions/franchise-actions/franchiseDietitianActivityActions.ts`).
// Authorization (`assertCallerCanViewDietitianActivity`,
// `guardFranchiseGroupAccess`), the Report_Card service and the single
// Cadence_Engine (`computeCadenceForCustomers`/`getLastDietitianLogDates`) are
// mocked at the I/O boundary — mirroring the `vi.hoisted` fake-DB pattern used
// by `clinic-scoped-dietitian-options.property.test.ts` and the direct
// CadenceService/cadenceRepository mocking used by
// `dietitian-customer-list.property.test.ts`. Mocking the Cadence_Engine
// (rather than its four repository queries) lets this test inject arbitrary,
// mutually-consistent per-customer cadence values and focus purely on the
// AGGREGATION arithmetic both actions perform over their own per-customer
// table — the correctness of the Cadence_Engine itself is Property 20/21's
// job, not this one's.
//
// vitest + fast-check, >=100 runs.

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory world (hoisted so the vi.mock factories can close over it)
const H = vi.hoisted(() => {
  const db: any = { users: [], customer_profiles: [], subscriptions: [], clinics: [] };
  const state: any = {
    cadenceByCustomer: new Map<string, any>(),
    lastLogDates: new Map<string, string>(),
    franchiseIdForGuard: "unset",
  };

  function reset() {
    db.users = [];
    db.customer_profiles = [];
    db.subscriptions = [];
    db.clinics = [];
    state.cadenceByCustomer = new Map();
    state.lastLogDates = new Map();
    state.franchiseIdForGuard = "unset";
  }

  /** Apply a filter map (`{col: value}` or `{col: {in: values}}`) to rows (AND semantics). */
  function applyFilters(rows: any[], filters: Array<{ col: string; val?: unknown; vals?: unknown[]; op: "eq" | "in" }>) {
    return rows.filter((row) =>
      filters.every((f) => (f.op === "in" ? (f.vals ?? []).includes(row[f.col]) : row[f.col] === f.val)),
    );
  }

  /**
   * A minimal fake PostgREST query builder over one in-memory table.
   * `select`/`order` are no-ops that return `this`; `eq`/`in` accumulate
   * filters and return `this`; `maybeSingle` is terminal and resolves
   * immediately; the builder is also directly awaitable (thenable), mirroring
   * supabase-js, for the call sites that `await` the builder without an
   * explicit terminal method.
   */
  function makeBuilder(table: keyof typeof db) {
    const filters: Array<{ col: string; val?: unknown; vals?: unknown[]; op: "eq" | "in" }> = [];
    const builder: any = {
      select: () => builder,
      order: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push({ col, val, op: "eq" });
        return builder;
      },
      in: (col: string, vals: unknown[]) => {
        filters.push({ col, vals, op: "in" });
        return builder;
      },
      maybeSingle: async () => {
        const rows = applyFilters(db[table], filters);
        return { data: rows[0] ?? null, error: null };
      },
      then: (resolve: (v: unknown) => void) => {
        const rows = applyFilters(db[table], filters);
        resolve({ data: rows, error: null });
      },
    };
    return builder;
  }

  function makeFakeAdmin() {
    return { from: (table: keyof typeof db) => makeBuilder(table) };
  }

  return { db, state, reset, makeFakeAdmin };
});

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.makeFakeAdmin(),
}));

// Authorize the master caller as ADMIN — mirrors
// `assertCallerCanViewDietitianActivity`'s user/roles lookup chain.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "auth-admin-1" } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { id: "admin-1", roles: { code: "ADMIN" } } }),
        }),
      }),
    }),
  }),
}));

// The franchise action's own gate is bypassed with the caller's Franchise
// pre-set by each test case (Req 24.3 is exercised separately by the access-
// control property tests; this file focuses on aggregation correctness).
vi.mock("@/lib/auth/adminAccess", () => ({
  guardFranchiseGroupAccess: vi.fn(async () => ({
    config: {} as unknown,
    franchiseId: H.state.franchiseIdForGuard,
  })),
}));

// The single Cadence_Engine entry point both actions go through (Req 20.8,
// 24.5) — injected directly so this test can drive arbitrary, internally
// consistent per-customer cadence values.
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
        pausedDaysCount: cadence?.pausedDaysCount ?? 0,
        eligibleDaysInWindow: 0,
        skippedSelfLogCount: cadence?.skippedSelfLogCount ?? 0,
        datesWithoutSelfLogCount: cadence?.datesWithoutSelfLogCount ?? 0,
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

vi.mock("@/repositories/dietitian/cadenceRepository", () => ({
  getLastDietitianLogDates: vi.fn(async (ids: readonly string[]) => {
    const result = new Map<string, string>();
    for (const id of ids) {
      const date = H.state.lastLogDates.get(id);
      if (date !== undefined) result.set(id, date);
    }
    return result;
  }),
  getGoverningRecords: vi.fn(async () => new Map()),
}));

vi.mock("@/services/DietitianReportService", () => ({
  getReportCard: vi.fn(async () => ({ ok: false, error: "not used in this test" })),
  generateReportCardPdf: vi.fn(async () => ({ ok: false, error: "not used in this test" })),
}));

// ─── System under test (imported after every mock is registered) ────────────
import { getDietitianActivityReport } from "@/actions/master-actions/dietitianActivityActions";
import { getFranchiseDietitianActivityReport } from "@/actions/franchise-actions/franchiseDietitianActivityActions";

const { db, state } = H;

beforeEach(() => {
  H.reset();
});

// ─── Generators ──────────────────────────────────────────────────────────────

const arbIsoDate = fc
  .tuple(fc.integer({ min: 2023, max: 2025 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);

const arbCategory = fc.constantFrom<"MEAL" | "KIT" | "ACCOMMODATION">("MEAL", "KIT", "ACCOMMODATION");

const arbName = fc
  .string({ minLength: 1, maxLength: 15 })
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const arbMobile = fc.option(fc.stringMatching(/^[6-9][0-9]{9}$/), { nil: null });

/** One Customer_Record plus arbitrary, internally-consistent cadence values. */
function arbCustomerRow(dietitianIdPool: readonly (string | null)[]) {
  return fc.record({
    id: fc.uuid(),
    customerCode: fc.option(fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.trim().length > 0), { nil: null }),
    name: arbName,
    mobile: arbMobile,
    category: arbCategory,
    dietitianId: fc.constantFrom(...dietitianIdPool),
    lastDietitianLogDate: fc.option(arbIsoDate, { nil: null }),
    daysNotLogged: fc.nat({ max: 60 }),
    pendingLogCount: fc.nat({ max: 30 }),
    pausedDaysCount: fc.nat({ max: 30 }),
    skippedSelfLogCount: fc.nat({ max: 30 }),
    datesWithoutSelfLogCount: fc.nat({ max: 10 }),
  });
}

function arbCustomerRows(dietitianIdPool: readonly (string | null)[]) {
  return fc.uniqueArray(arbCustomerRow(dietitianIdPool), {
    selector: (r) => r.id,
    minLength: 0,
    maxLength: 10,
  });
}

/** Seeds `db.customer_profiles`/`db.subscriptions` and the cadence maps for one scenario. */
function seedCustomers(rows: any[]) {
  for (const row of rows) {
    db.customer_profiles.push({
      id: row.id,
      clinic_id: null,
      franchise_id: row.franchiseId ?? null,
      dietitian_id: row.dietitianId,
      customer_code: row.customerCode,
      users: { full_name: row.name, mobile: row.mobile },
    });
    db.subscriptions.push({
      customer_profile_id: row.id,
      customer_category: row.category,
      created_at: "2024-01-01T00:00:00.000Z",
    });
    state.cadenceByCustomer.set(row.id, {
      daysNotLogged: row.daysNotLogged,
      pendingLogCount: row.pendingLogCount,
      pausedDaysCount: row.pausedDaysCount,
      skippedSelfLogCount: row.skippedSelfLogCount,
      datesWithoutSelfLogCount: row.datesWithoutSelfLogCount,
    });
    if (row.lastDietitianLogDate !== null) {
      state.lastLogDates.set(row.id, row.lastDietitianLogDate);
    }
  }
}

// ─── Property 33 ─────────────────────────────────────────────────────────────

describe("Property 33: The Dietitian_Activity_Report aggregates its own per-customer table consistently, in both portals", () => {
  it(
    "customersWithPendingLogs/maxDaysNotLogged/customersMissingSelfLog are derived from the rendered " +
      "per-customer table, respect the bounds and consistency invariants, and every row carries all " +
      "seven reported values (Req 20.2, 20.3, 20.4, 20.5, 20.9, 20.10)",
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.uuid(), arbCustomerRows(["core-dietitian"]), async (dietitianUserId, rows) => {
          H.reset();

          // A core Dietitian with no assigned Clinic degenerates to
          // `dietitian_id = me` (Req 4.4) — every generated row is linked to
          // this Dietitian's own id, keeping the scope construction (and this
          // test) independent of the `.or()` clinic disjunct already covered
          // by Property 3.
          const linkedRows = rows.map((r: any) => ({ ...r, dietitianId: dietitianUserId }));

          db.users.push({
            id: dietitianUserId,
            full_name: "Dr. Test",
            franchise_id: null,
            dietitian_clinic_id: null,
            admin_access_level: "dietitian",
            is_active: true,
          });
          seedCustomers(linkedRows);

          const result = await getDietitianActivityReport(dietitianUserId);
          expect(result.success).toBe(true);
          if (!result.success) return;

          const { rows: reportRows, customersWithPendingLogs, maxDaysNotLogged, customersMissingSelfLog } =
            result.data;

          // The per-customer table equals exactly the linked Customer_Records.
          expect(reportRows).toHaveLength(linkedRows.length);

          // customersWithPendingLogs equals the count of rows with
          // Pending_Log_Count > 0 (Req 20.2) and never exceeds the total
          // linked-record count (bounds invariant, Req 20.9).
          const expectedPending = reportRows.filter((r) => r.pendingLogCount > 0).length;
          expect(customersWithPendingLogs).toBe(expectedPending);
          expect(customersWithPendingLogs).toBeLessThanOrEqual(reportRows.length);

          // Max_Days_Not_Logged equals the maximum Days_Not_Logged in the
          // per-customer table (consistency invariant, Req 20.10, 20.3).
          const expectedMax = reportRows.reduce((max, r) => Math.max(max, r.daysNotLogged), 0);
          expect(maxDaysNotLogged).toBe(expectedMax);

          // The missing-Self_Log count equals the number of rows with at
          // least one window date lacking a Self_Log (Req 20.4).
          const expectedMissingSelfLog = reportRows.filter((r) => r.datesWithoutSelfLogCount > 0).length;
          expect(customersMissingSelfLog).toBe(expectedMissingSelfLog);

          // Every table row carries all seven reported values (Req 20.5),
          // each equal to its source record's own value.
          const bySource = new Map(linkedRows.map((r: any) => [r.id, r]));
          for (const rendered of reportRows) {
            const source = bySource.get(rendered.customerProfileId);
            expect(source).toBeDefined();
            if (!source) continue;

            expect(rendered.name).toBe(source.name);
            expect(rendered.category).toBe(source.category);
            expect(rendered.lastDietitianLogDate).toBe(source.lastDietitianLogDate);
            expect(rendered.daysNotLogged).toBe(source.daysNotLogged);
            expect(rendered.pendingLogCount).toBe(source.pendingLogCount);
            expect(rendered.skippedSelfLogCount).toBe(source.skippedSelfLogCount);
            expect(rendered.pausedDaysCount).toBe(source.pausedDaysCount);
          }
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    "the Franchise-scoped report restricted to a Franchise yields values equal to those the Master " +
      "report produces for the same Dietitian (Req 20.2, 20.3, 20.4, 24.2, 24.6)",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.uuid(),
          arbCustomerRows(["same-dietitian", null, "other-dietitian"]),
          async (dietitianUserId, franchiseId, rowTemplates) => {
            H.reset();

            const dietitianIdMap: Record<string, string | null> = {
              "same-dietitian": dietitianUserId,
              "other-dietitian": "other-dietitian-id",
              null: null,
            } as any;
            const rows = rowTemplates.map((r: any) => ({
              ...r,
              franchiseId,
              dietitianId: r.dietitianId === "same-dietitian" ? dietitianUserId : r.dietitianId,
            }));

            // A Franchise Dietitian's Dietitian_Account (`franchise_id`
            // non-null) makes the scope tenant-only (Req 21.8, 22.8) — every
            // row above shares the same `franchiseId`, so the Master
            // report's scope and `listFranchiseCustomers`' filter select the
            // exact same rows.
            db.users.push({
              id: dietitianUserId,
              full_name: "Franchise Dietitian",
              franchise_id: franchiseId,
              dietitian_clinic_id: null,
              admin_access_level: "dietitian",
              is_active: true,
            });
            seedCustomers(rows);
            state.franchiseIdForGuard = franchiseId;

            const masterResult = await getDietitianActivityReport(dietitianUserId);
            const franchiseResult = await getFranchiseDietitianActivityReport();

            expect(masterResult.success).toBe(true);
            expect(franchiseResult.success).toBe(true);
            if (!masterResult.success || !franchiseResult.success) return;
            expect(franchiseResult.data).not.toBeNull();
            if (!franchiseResult.data) return;

            // The three headline aggregates agree between the two portals
            // for the same Dietitian (Req 24.6), the Franchise report being
            // restricted to Customer_Records of that Franchise (Req 24.2).
            expect(franchiseResult.data.customersWithPendingLogs).toBe(
              masterResult.data.customersWithPendingLogs,
            );
            expect(franchiseResult.data.maxDaysNotLogged).toBe(masterResult.data.maxDaysNotLogged);
            expect(franchiseResult.data.customersMissingSelfLog).toBe(
              masterResult.data.customersMissingSelfLog,
            );
            expect(franchiseResult.data.dietitianName).toBe(masterResult.data.dietitianName);

            // The per-customer tables carry the same set of records, with
            // equal reported values on each side.
            const sortById = (list: typeof masterResult.data.rows) =>
              [...list].sort((a, b) => a.customerProfileId.localeCompare(b.customerProfileId));
            expect(sortById(franchiseResult.data.rows)).toEqual(sortById(masterResult.data.rows));
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
