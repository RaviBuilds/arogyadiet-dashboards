// src/test/dietitian/scope-soundness.property.test.ts
// Feature: dietitian-management, Property 3
//
// Property 3: Dietitian read scope is sound — no record outside the scope
// predicate is ever readable.
//
// For any Dietitian scope (core with a Clinic, core without a Clinic, or
// franchise) and any set of Customer_Records, the readable set equals exactly
// the records satisfying that scope's predicate: a franchise scope matches on
// `franchise_id`; a core scope matches on `dietitian_id = me` or on
// `clinic_id` equal to the Dietitian's Clinic; a core Dietitian with no Clinic
// reads only explicitly linked records.
//
// The expected truth is derived independently from the SQL security-definer
// helper `public.dietitian_can_read_customer(uuid)` in
// `scripts/create-dietitian-management-rls.sql` — transcribed below as a
// three-valued-logic reimplementation of its disjunction, not from
// `dietitianCanRead`'s own code. The application predicate and the RLS
// predicate must agree row for row, so this file is what pins them together.
//
// **Validates: Requirements 4.4, 5.5, 5.6, 5.8, 5.9, 5.11, 21.8, 21.11, 22.8, 25.1, 25.2**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  applyDietitianScope,
  dietitianCanRead,
  dietitianScopeFromUser,
  filterScopableCustomers,
  type DietitianScope,
  type ScopableCustomer,
} from "@/lib/dietitian/scope";
import {
  CLINIC_FRANCHISE,
  CLINIC_IDS,
  DIETITIAN_IDS,
  FRANCHISE_IDS,
  customerRecordArb,
  customerRecordsArb,
  dietitianScopeArb,
  scopableCustomerArb,
  toScopable,
  type DietitianScopeSample,
  type ScopableCustomerSample,
} from "@/test/dietitian/arbitraries";

const NUM_RUNS = 200;

// ─── Reference model: the SQL predicate, transcribed ─────────────────────────
//
//   SELECT EXISTS (
//     SELECT 1
//     FROM public.current_dietitian() d
//     JOIN public.customer_profiles cp ON cp.id = p_profile_id
//     WHERE (d.franchise_id IS NOT NULL AND cp.franchise_id = d.franchise_id)
//        OR (d.franchise_id IS NULL AND (
//              cp.dietitian_id = d.user_id
//              OR (d.clinic_id IS NOT NULL AND cp.clinic_id = d.clinic_id)
//            ))
//   )
//
// Reproduced with SQL's three-valued logic so the NULL columns of
// `customer_profiles` behave the way Postgres makes them behave: a comparison
// against NULL is UNKNOWN, and only a TRUE `WHERE` row reaches `EXISTS`.

type Bool3 = true | false | null;

/** SQL `=` on nullable operands: UNKNOWN when either side is NULL. */
function eq3(left: string | null, right: string | null): Bool3 {
  if (left === null || right === null) return null;
  return left === right;
}

/** SQL `AND`: FALSE dominates, then UNKNOWN. */
function and3(left: Bool3, right: Bool3): Bool3 {
  if (left === false || right === false) return false;
  if (left === null || right === null) return null;
  return true;
}

/** SQL `OR`: TRUE dominates, then UNKNOWN. */
function or3(left: Bool3, right: Bool3): Bool3 {
  if (left === true || right === true) return true;
  if (left === null || right === null) return null;
  return false;
}

/** The row `public.current_dietitian()` projects for the calling session. */
interface CurrentDietitianRow {
  user_id: string;
  clinic_id: string | null;
  franchise_id: string | null;
}

/**
 * Reference reimplementation of `public.dietitian_can_read_customer`. The
 * `EXISTS` wrapper is the `=== true` at the end: an UNKNOWN `WHERE` clause
 * yields no row, hence FALSE.
 */
function sqlDietitianCanReadCustomer(
  d: CurrentDietitianRow,
  cp: ScopableCustomer,
): boolean {
  // Franchise scope is the CONJUNCTION of tenant and Dietitian_Link
  // (scripts/allow-multiple-franchise-dietitians.sql). The tenant alone would
  // let every Dietitian of a Franchise read every colleague's customer, which
  // stopped being acceptable once a Franchise could hold more than one.
  const franchiseDisjunct = and3(
    d.franchise_id !== null,
    and3(
      eq3(cp.franchise_id, d.franchise_id),
      eq3(cp.dietitian_id, d.user_id),
    ),
  );
  // Core scope is strictly the Dietitian_Link — the linked Clinic no longer
  // widens the read scope, so there is no `clinic_id` disjunct here.
  const coreDisjunct = and3(
    d.franchise_id === null,
    eq3(cp.dietitian_id, d.user_id),
  );
  return or3(franchiseDisjunct, coreDisjunct) === true;
}

/**
 * The `users` row behind a generated scope. A Franchise Dietitian may well
 * carry a `dietitian_clinic_id` too — the SQL ignores it, and so must the
 * application scope: the Clinic widens neither kind of scope.
 */
function dietitianRowFor(
  scope: DietitianScopeSample,
  franchiseClinicId: string | null = null,
): CurrentDietitianRow {
  return scope.kind === "franchise"
    ? {
        user_id: scope.dietitianUserId,
        clinic_id: franchiseClinicId,
        franchise_id: scope.franchiseId,
      }
    : {
        user_id: scope.dietitianUserId,
        clinic_id: scope.clinicId,
        franchise_id: null,
      };
}

/** The generated sample is structurally the shipped `DietitianScope`. */
function asScope(sample: DietitianScopeSample): DietitianScope {
  return sample;
}

// ─── A recording query builder ───────────────────────────────────────────────
//
// `applyDietitianScope` narrows a Supabase query. To check that the emitted
// filters select the same rows as the predicate (which is what makes the list,
// Health_Log and Self_Log reads of Req 25.1, 25.2 sound), the filters are
// recorded and re-interpreted as a predicate over a row.

type RecordedFilter =
  | { type: "eq"; column: string; value: string }
  | { type: "or"; clauses: { column: string; value: string }[] };

class RecordingBuilder {
  readonly filters: RecordedFilter[] = [];

  eq(column: string, value: string): this {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  or(filters: string): this {
    const clauses = filters.split(",").map((clause) => {
      const match = /^([a-z_]+)\.eq\.(.+)$/.exec(clause);
      if (!match) throw new Error(`Unparsable PostgREST clause: ${clause}`);
      return { column: match[1], value: match[2] };
    });
    this.filters.push({ type: "or", clauses });
    return this;
  }
}

/** PostgREST ANDs applied filters and ORs within an `.or()` group. */
function matchesRecordedFilters(
  filters: readonly RecordedFilter[],
  customer: ScopableCustomer,
): boolean {
  const column = (name: string): string | null => {
    switch (name) {
      case "clinic_id":
        return customer.clinic_id;
      case "franchise_id":
        return customer.franchise_id;
      case "dietitian_id":
        return customer.dietitian_id;
      default:
        throw new Error(`Unexpected column in scope filter: ${name}`);
    }
  };

  return filters.every((filter) =>
    filter.type === "eq"
      ? eq3(column(filter.column), filter.value) === true
      : filter.clauses.some(
          (clause) => eq3(column(clause.column), clause.value) === true,
        ),
  );
}

// ─── Property 3 ──────────────────────────────────────────────────────────────

describe("Property 3: Dietitian read scope is sound", () => {
  it("dietitianCanRead agrees with the SQL predicate for every scope and record", () => {
    /**
     * **Validates: Requirements 5.5, 5.6, 5.11, 21.8**
     */
    fc.assert(
      fc.property(
        dietitianScopeArb,
        scopableCustomerArb,
        fc.option(fc.constantFrom(...CLINIC_IDS), { nil: null }),
        (scopeSample, customer, strayClinicId) => {
          const expected = sqlDietitianCanReadCustomer(
            dietitianRowFor(scopeSample, strayClinicId),
            customer,
          );
          expect(dietitianCanRead(asScope(scopeSample), customer)).toBe(
            expected,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("the readable set equals exactly the records satisfying the predicate, and nothing outside it is readable", () => {
    /**
     * **Validates: Requirements 5.5, 5.6, 5.11, 25.1, 25.2**
     */
    fc.assert(
      fc.property(
        dietitianScopeArb,
        customerRecordsArb({ maxLength: 12 }),
        (scopeSample, records) => {
          const scope = asScope(scopeSample);
          const d = dietitianRowFor(scopeSample);
          const scopables = records.map(toScopable);

          const expectedReadable = scopables.filter((customer) =>
            sqlDietitianCanReadCustomer(d, customer),
          );
          const actualReadable = filterScopableCustomers(scope, scopables);

          // Completeness: every in-predicate record is readable.
          expect(actualReadable).toEqual(expectedReadable);

          // Soundness: no record outside the predicate is ever readable.
          const outsidePredicate = scopables.filter(
            (customer) => !sqlDietitianCanReadCustomer(d, customer),
          );
          for (const customer of outsidePredicate) {
            expect(dietitianCanRead(scope, customer)).toBe(false);
          }
          expect(actualReadable.length + outsidePredicate.length).toBe(
            scopables.length,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("a core Dietitian with no Clinic degenerates to dietitian_id = me", () => {
    /**
     * **Validates: Requirements 4.4, 5.8, 5.9**
     */
    fc.assert(
      fc.property(
        fc.constantFrom(...DIETITIAN_IDS),
        scopableCustomerArb,
        (dietitianUserId, customer) => {
          const scope: DietitianScope = {
            kind: "core",
            dietitianUserId,
            clinicId: null,
          };

          // Only the explicit Dietitian_Link makes a record readable: neither
          // the Clinic nor the tenant of the record can widen the scope.
          expect(dietitianCanRead(scope, customer)).toBe(
            customer.dietitian_id === dietitianUserId,
          );
          expect(dietitianCanRead(scope, customer)).toBe(
            sqlDietitianCanReadCustomer(
              { user_id: dietitianUserId, clinic_id: null, franchise_id: null },
              customer,
            ),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("a franchise Dietitian needs BOTH the tenant and the Dietitian_Link", () => {
    /**
     * **Validates: Requirements 21.8, 21.11, 22.8 as amended by
     * scripts/allow-multiple-franchise-dietitians.sql**
     *
     * The franchise disjunct used to be the tenant alone. That was equivalent to
     * "their own customers" only while a Franchise was capped at one Dietitian;
     * with a team it would expose every colleague's customers.
     */
    fc.assert(
      fc.property(
        fc.constantFrom(...DIETITIAN_IDS),
        fc.constantFrom(...FRANCHISE_IDS),
        customerRecordArb,
        (dietitianUserId, franchiseId, record) => {
          const scope: DietitianScope = {
            kind: "franchise",
            dietitianUserId,
            franchiseId,
          };
          const customer = toScopable(record);

          // Both conjuncts are required.
          expect(dietitianCanRead(scope, customer)).toBe(
            customer.franchise_id === franchiseId &&
              customer.dietitian_id === dietitianUserId,
          );

          // A same-tenant record NOT linked to this Dietitian is unreadable —
          // this is the colleague-isolation property multiple Dietitians need.
          const sameTenantUnlinked: ScopableCustomerSample = {
            ...customer,
            franchise_id: franchiseId,
            dietitian_id: null,
          };
          expect(dietitianCanRead(scope, sameTenantUnlinked)).toBe(false);

          const otherDietitian = DIETITIAN_IDS.find(
            (id) => id !== dietitianUserId,
          );
          if (otherDietitian !== undefined) {
            expect(
              dietitianCanRead(scope, {
                ...customer,
                franchise_id: franchiseId,
                dietitian_id: otherDietitian,
              }),
            ).toBe(false);
          }

          // Conversely, a link alone must not defeat the tenant check: forcing
          // the link onto an out-of-tenant record keeps it unreadable.
          const linkedOutOfTenant: ScopableCustomerSample = {
            ...customer,
            dietitian_id: dietitianUserId,
          };
          if (linkedOutOfTenant.franchise_id !== franchiseId) {
            expect(dietitianCanRead(scope, linkedOutOfTenant)).toBe(false);
          }

          for (const clinicId of CLINIC_IDS) {
            const owner = CLINIC_FRANCHISE[clinicId];
            if (owner === franchiseId) continue;
            expect(
              dietitianCanRead(scope, {
                clinic_id: clinicId,
                franchise_id: owner,
                dietitian_id: dietitianUserId,
              }),
            ).toBe(false);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("dietitianScopeFromUser mirrors the current_dietitian() projection", () => {
    /**
     * **Validates: Requirements 5.5, 5.6, 5.11, 21.8**
     */
    fc.assert(
      fc.property(
        fc.record({
          id: fc.constantFrom(...DIETITIAN_IDS),
          franchise_id: fc.option(fc.constantFrom(...FRANCHISE_IDS), {
            nil: null,
          }),
          dietitian_clinic_id: fc.option(fc.constantFrom(...CLINIC_IDS), {
            nil: null,
          }),
        }),
        scopableCustomerArb,
        (userRow, customer) => {
          const scope = dietitianScopeFromUser(userRow);
          expect(dietitianCanRead(scope, customer)).toBe(
            sqlDietitianCanReadCustomer(
              {
                user_id: userRow.id,
                clinic_id: userRow.dietitian_clinic_id,
                franchise_id: userRow.franchise_id,
              },
              customer,
            ),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("applyDietitianScope emits filters that select exactly the readable rows", () => {
    /**
     * **Validates: Requirements 5.5, 5.6, 5.11, 25.1, 25.2**
     */
    fc.assert(
      fc.property(
        dietitianScopeArb,
        customerRecordsArb({ maxLength: 12 }),
        (scopeSample, records) => {
          const scope = asScope(scopeSample);
          const d = dietitianRowFor(scopeSample);
          const builder = new RecordingBuilder();

          applyDietitianScope(builder, scope);
          // A core scope emits one filter (the link); a franchise scope emits
          // two (tenant AND link), which PostgREST ANDs together.
          expect(builder.filters.length).toBe(
            scopeSample.kind === "franchise" ? 2 : 1,
          );

          for (const record of records) {
            const customer = toScopable(record);
            expect(matchesRecordedFilters(builder.filters, customer)).toBe(
              sqlDietitianCanReadCustomer(d, customer),
            );
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // REMOVED: the `dietitianScopeOrFilter` test. That helper built an `or`
  // filter naming a `clinic_id` disjunct which the predicate no longer has, had
  // no production callers, and contradicted the real scope — so it was deleted
  // from `src/lib/dietitian/scope.ts` rather than left as a trap.

  it("rejects a non-uuid identity rather than inlining it into a filter string", () => {
    /**
     * **Validates: Requirements 5.11**
     */
    const notAUuid = fc
      .string({ maxLength: 12 })
      .filter(
        (s) =>
          !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
            s,
          ),
      );

    fc.assert(
      fc.property(
        notAUuid,
        fc.constantFrom(...CLINIC_IDS),
        (badId, clinicId) => {
          expect(() =>
            applyDietitianScope(new RecordingBuilder(), {
              kind: "core",
              dietitianUserId: badId,
              clinicId: null,
            }),
          ).toThrow();
          // The franchise branch must validate BOTH ids it inlines.
          expect(() =>
            applyDietitianScope(new RecordingBuilder(), {
              kind: "franchise",
              dietitianUserId: badId,
              franchiseId: CLINIC_FRANCHISE[clinicId] ?? FRANCHISE_IDS[0],
            }),
          ).toThrow();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
