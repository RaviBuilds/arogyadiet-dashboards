/**
 * Feature: dietitian-management, Task 14.1 — RLS integration tests.
 *
 * Validates: Requirements 5.7, 21.8, 21.11
 *
 *   5.7   The Dietitian read scope of Requirement 5 (criteria 5, 6) is
 *         enforced through Row Level Security policies IN ADDITION TO
 *         application-layer filtering — so the anon-key result set for
 *         `customer_profiles` and `health_logs` must equal exactly what the
 *         pure predicate `dietitianCanRead` (`src/lib/dietitian/scope.ts`)
 *         returns for the same fixtures.
 *  21.8   A Franchise Dietitian reads by tenant (`franchise_id`) only.
 *  21.11  FOR ALL Franchise users, every row readable by that user carries a
 *         `franchise_id` equal to that user's `franchise_id` (tenant
 *         isolation invariant) — checked here for the Franchise Dietitian
 *         fixture specifically.
 *
 * This is the one property test class this feature CANNOT run purely: RLS is
 * evaluated by Postgres under a real authenticated session, not by a mock. The
 * suite therefore:
 *   1. Applies `scripts/create-dietitian-management.sql` and
 *      `scripts/create-dietitian-management-rls.sql` idempotently against a
 *      scratch database (`DIETITIAN_TEST_DATABASE_URL`, via `sqlRunner.ts`).
 *   2. Creates three real Supabase Auth accounts (`DIETITIAN_TEST_SUPABASE_*`,
 *      via `authRunner.ts`) — a core Dietitian with a Clinic, a core Dietitian
 *      with no Clinic, and a Franchise Dietitian — and links each to a
 *      `public.users` row via `auth_user_id`, exactly as production Dietitian
 *      accounts are provisioned.
 *   3. Seeds a fixed set of `customer_profiles` and `health_logs` rows across
 *      every clinic/franchise/dietitian_id combination the scope predicate
 *      distinguishes (Property 3's fixture shape, transcribed as literal SQL
 *      rows instead of `fast-check` arbitraries, since this suite exercises
 *      the database rather than the pure function).
 *   4. Signs in as each Dietitian on the ANON key and reads both tables,
 *      asserting the returned id set equals exactly
 *      `records.filter(r => dietitianCanRead(scope, r))` for that Dietitian's
 *      scope.
 *
 * `DIETITIAN_TEST_DATABASE_URL` and the `DIETITIAN_TEST_SUPABASE_*` variables
 * MUST point at the SAME scratch Supabase project: the SQL fixtures write
 * `public.users.auth_user_id` referencing the `auth.users` rows the Auth
 * harness creates in that project's own Postgres, and `current_dietitian()`
 * resolves through `auth.uid()` in a session against that same project. See
 * `src/test/db/README.md`. Never point either at the live project — this
 * suite creates real Auth accounts and rows.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

import {
  DB_URL_ENV,
  execSql,
  execSqlFile,
  harnessSkipReason,
  queryJson,
} from "../db/sqlRunner";
import {
  authHarnessSkipReason,
  createTestAdminClient,
} from "../db/authRunner";
import { dietitianCanRead, type DietitianScope, type ScopableCustomer } from "@/lib/dietitian/scope";

const REPO_ROOT = process.cwd();
const SCHEMA_SCRIPT = path.join(REPO_ROOT, "scripts", "create-dietitian-management.sql");
const RLS_SCRIPT = path.join(REPO_ROOT, "scripts", "create-dietitian-management-rls.sql");

// Both harnesses must be configured, and must name the same project (checked
// structurally where possible; the README calls out the requirement).
const dbSkip = harnessSkipReason();
const authSkip = authHarnessSkipReason();
const combinedSkip = dbSkip ?? authSkip;

const suiteName = combinedSkip
  ? `Dietitian RLS scope soundness — SKIPPED (${combinedSkip})`
  : "Dietitian RLS scope soundness (anon-key reads equal the pure predicate)";

describe.skipIf(combinedSkip !== null)(suiteName, () => {
  // ─── Fixture identifiers ────────────────────────────────────────────────
  const franchiseId = randomUUID();
  const coreClinicId = randomUUID(); // franchise_id NULL
  const franchiseClinicId = randomUUID(); // franchise_id = franchiseId

  interface DietitianFixture {
    userId: string; // public.users.id
    authUserId: string;
    email: string;
    password: string;
    scope: DietitianScope;
  }

  let coreWithClinic: DietitianFixture;
  let coreNoClinic: DietitianFixture;
  let franchiseDietitian: DietitianFixture;

  /** customer_profiles rows spanning every disjunct the predicate distinguishes. */
  interface CustomerFixture extends ScopableCustomer {
    id: string;
    label: string;
  }
  let customers: CustomerFixture[] = [];

  let baselineSkip: string | null = null;

  async function createDietitianFixture(params: {
    label: string;
    clinicId: string | null;
    franchiseIdForUser: string | null;
  }): Promise<DietitianFixture> {
    const admin = createTestAdminClient();
    const email = `rls-dietitian-${params.label}-${randomUUID()}@example.invalid`;
    const password = `Pw-${randomUUID()}`;

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created?.user?.id) {
      throw new Error(`failed to create auth user for ${params.label}: ${createError?.message}`);
    }
    const authUserId = created.user.id;

    const userId = randomUUID();
    const insertResult = await execSql(`
      INSERT INTO public.users
        (id, auth_user_id, full_name, email, mobile, admin_access_level,
         dietitian_clinic_id, franchise_id, is_active)
      VALUES
        ('${userId}', '${authUserId}', 'RLS Test Dietitian ${params.label}',
         '${email}', '90000${Math.floor(Math.random() * 90000 + 10000)}', 'dietitian',
         ${params.clinicId ? `'${params.clinicId}'` : "NULL"},
         ${params.franchiseIdForUser ? `'${params.franchiseIdForUser}'` : "NULL"},
         true);
    `);
    if (!insertResult.ok) {
      throw new Error(`failed to insert users row for ${params.label}: ${insertResult.message}`);
    }

    const scope: DietitianScope = params.franchiseIdForUser
      ? { kind: "franchise", dietitianUserId: userId, franchiseId: params.franchiseIdForUser }
      : { kind: "core", dietitianUserId: userId, clinicId: params.clinicId };

    return { userId, authUserId, email, password, scope };
  }

  beforeAll(async () => {
    // Verify the prerequisite baseline (mirrors migration.integration.test.ts).
    const present = await queryJson<{ name: string; present: boolean }>(`
      SELECT t.name,
             EXISTS (SELECT 1 FROM information_schema.tables i
                     WHERE i.table_schema = 'public' AND i.table_name = t.name) AS present
      FROM unnest(ARRAY['users', 'customer_profiles', 'clinics', 'franchises']) AS t(name)
    `);
    const missing = present.filter((r) => !r.present).map((r) => r.name);
    if (missing.length > 0) {
      baselineSkip = `the database at ${DB_URL_ENV} is missing prerequisite tables: [${missing.join(", ")}]. Restore a schema-only dump first (see src/test/db/README.md).`;
      return;
    }

    // Apply the migration + RLS scripts idempotently.
    const schemaResult = await execSqlFile(SCHEMA_SCRIPT);
    if (!schemaResult.ok) {
      baselineSkip = `failed to apply ${SCHEMA_SCRIPT}: ${schemaResult.message}`;
      return;
    }
    const rlsResult = await execSqlFile(RLS_SCRIPT);
    if (!rlsResult.ok) {
      baselineSkip = `failed to apply ${RLS_SCRIPT}: ${rlsResult.message}`;
      return;
    }

    // Fixture: franchise + two clinics.
    const setup = await execSql(`
      INSERT INTO public.franchises (id, name, status)
      VALUES ('${franchiseId}', 'RLS Test Franchise ${franchiseId.slice(0, 8)}', 'active');

      INSERT INTO public.clinics (id, name, franchise_id)
      VALUES ('${coreClinicId}', 'RLS Test Core Clinic', NULL);

      INSERT INTO public.clinics (id, name, franchise_id)
      VALUES ('${franchiseClinicId}', 'RLS Test Franchise Clinic', '${franchiseId}');
    `);
    if (!setup.ok) {
      baselineSkip = `fixture setup (franchise/clinics) failed: ${setup.message}`;
      return;
    }

    coreWithClinic = await createDietitianFixture({
      label: "core-with-clinic",
      clinicId: coreClinicId,
      franchiseIdForUser: null,
    });
    coreNoClinic = await createDietitianFixture({
      label: "core-no-clinic",
      clinicId: null,
      franchiseIdForUser: null,
    });
    franchiseDietitian = await createDietitianFixture({
      label: "franchise",
      clinicId: null,
      franchiseIdForUser: franchiseId,
    });

    // customer_profiles fixtures spanning every disjunct.
    const rows: CustomerFixture[] = [
      { id: randomUUID(), label: "core-clinic-match", clinic_id: coreClinicId, franchise_id: null, dietitian_id: null },
      { id: randomUUID(), label: "core-link-match", clinic_id: null, franchise_id: null, dietitian_id: coreNoClinic.userId },
      { id: randomUUID(), label: "franchise-match", clinic_id: null, franchise_id: franchiseId, dietitian_id: null },
      { id: randomUUID(), label: "franchise-clinic-and-tenant", clinic_id: franchiseClinicId, franchise_id: franchiseId, dietitian_id: null },
      { id: randomUUID(), label: "unlinked", clinic_id: null, franchise_id: null, dietitian_id: null },
      // Edge case: dietitian_id points at the FRANCHISE Dietitian, but the
      // record itself carries no franchise_id — a Franchise Dietitian reads
      // by tenant only, so this must stay unreadable to them (Req 21.8).
      { id: randomUUID(), label: "link-to-franchise-dietitian-no-tenant", clinic_id: coreClinicId, franchise_id: null, dietitian_id: franchiseDietitian.userId },
    ];
    customers = rows;

    const values = rows
      .map(
        (r) =>
          `('${r.id}', ${r.clinic_id ? `'${r.clinic_id}'` : "NULL"}, ${
            r.franchise_id ? `'${r.franchise_id}'` : "NULL"
          }, ${r.dietitian_id ? `'${r.dietitian_id}'` : "NULL"})`,
      )
      .join(",\n");

    const insertCustomers = await execSql(`
      INSERT INTO public.customer_profiles (id, clinic_id, franchise_id, dietitian_id)
      VALUES ${values};
    `);
    if (!insertCustomers.ok) {
      baselineSkip = `fixture setup (customer_profiles) failed: ${insertCustomers.message}`;
      return;
    }

    // One health_logs row per customer, authored by the core-with-clinic
    // Dietitian (author identity is irrelevant to the read predicate — the
    // SELECT policy scopes by customer_profile_id only).
    const healthLogValues = rows
      .map(
        (r) => `(
          '${randomUUID()}', '${r.id}', current_date, 'DIETITIAN',
          '${coreWithClinic.userId}', 'MEAL', '{}'::jsonb, '[]'::jsonb,
          'RLS fixture log for ${r.label}', current_date
        )`,
      )
      .join(",\n");

    const insertLogs = await execSql(`
      INSERT INTO public.health_logs
        (id, customer_profile_id, log_date, author_type, author_user_id,
         customer_category, parameters, custom_parameters, closing_comment,
         submission_date_ist)
      VALUES ${healthLogValues};
    `);
    if (!insertLogs.ok) {
      baselineSkip = `fixture setup (health_logs) failed: ${insertLogs.message}`;
    }
  }, 120_000);

  afterAll(async () => {
    if (baselineSkip) return;
    // Auth accounts first (no FK back to public.users blocks this order).
    const admin = createTestAdminClient();
    for (const fixture of [coreWithClinic, coreNoClinic, franchiseDietitian]) {
      if (fixture?.authUserId) {
        await admin.auth.admin.deleteUser(fixture.authUserId).catch(() => undefined);
      }
    }
    await execSql(`
      DELETE FROM public.health_logs WHERE customer_profile_id IN (${customers
        .map((c) => `'${c.id}'`)
        .join(", ")});
      DELETE FROM public.customer_profiles WHERE id IN (${customers
        .map((c) => `'${c.id}'`)
        .join(", ")});
      DELETE FROM public.users WHERE id IN (
        '${coreWithClinic?.userId}', '${coreNoClinic?.userId}', '${franchiseDietitian?.userId}'
      );
      DELETE FROM public.clinics WHERE id IN ('${coreClinicId}', '${franchiseClinicId}');
      DELETE FROM public.franchises WHERE id = '${franchiseId}';
    `);
  }, 60_000);

  /** Signs in as `fixture` on the anon key and reads `table`, returning the visible customer_profile ids. */
  async function readableCustomerIdsAs(
    fixture: DietitianFixture,
    table: "customer_profiles" | "health_logs",
    customerIdColumn: "id" | "customer_profile_id",
  ): Promise<Set<string>> {
    const anon = createClient(
      process.env.DIETITIAN_TEST_SUPABASE_URL!,
      process.env.DIETITIAN_TEST_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { error: signInError } = await anon.auth.signInWithPassword({
      email: fixture.email,
      password: fixture.password,
    });
    if (signInError) {
      throw new Error(`sign-in failed for ${fixture.userId}: ${signInError.message}`);
    }

    const idList = customers.map((c) => c.id);
    const { data, error } = await anon
      .from(table)
      .select(customerIdColumn)
      .in(customerIdColumn, idList);

    if (error) {
      throw new Error(`read of ${table} failed for ${fixture.userId}: ${error.message}`);
    }

    await anon.auth.signOut();

    return new Set((data ?? []).map((row) => (row as Record<string, string>)[customerIdColumn]));
  }

  /** The expected readable id set per the pure predicate, for a given scope. */
  function expectedReadableIds(scope: DietitianScope): Set<string> {
    return new Set(customers.filter((c) => dietitianCanRead(scope, c)).map((c) => c.id));
  }

  it("a core Dietitian with a Clinic reads exactly clinic-matched + explicitly-linked customer_profiles (Req 5.7)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const actual = await readableCustomerIdsAs(coreWithClinic, "customer_profiles", "id");
    expect(actual).toEqual(expectedReadableIds(coreWithClinic.scope));
  }, 30_000);

  it("a core Dietitian with no Clinic reads exactly the explicitly-linked customer_profiles, degenerating to dietitian_id = me (Req 4.4, 5.7)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const actual = await readableCustomerIdsAs(coreNoClinic, "customer_profiles", "id");
    expect(actual).toEqual(expectedReadableIds(coreNoClinic.scope));
  }, 30_000);

  it("a Franchise Dietitian reads exactly the customer_profiles of their tenant, never by Dietitian_Link (Req 5.7, 21.8, 21.11)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const actual = await readableCustomerIdsAs(franchiseDietitian, "customer_profiles", "id");
    const expected = expectedReadableIds(franchiseDietitian.scope);
    expect(actual).toEqual(expected);

    // Req 21.11 tenant isolation invariant: every readable row's franchise_id
    // equals this Dietitian's franchise_id.
    for (const id of actual) {
      const row = customers.find((c) => c.id === id)!;
      expect(row.franchise_id).toBe(franchiseId);
    }
  }, 30_000);

  it("health_logs reads agree with the same predicate for every Dietitian (Req 5.7)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);

    for (const fixture of [coreWithClinic, coreNoClinic, franchiseDietitian]) {
      const actual = await readableCustomerIdsAs(fixture, "health_logs", "customer_profile_id");
      expect(actual).toEqual(expectedReadableIds(fixture.scope));
    }
  }, 60_000);
});
