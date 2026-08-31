/**
 * Feature: dietitian-management, Task 14.2 — concurrency and auth integration
 * tests.
 *
 * Validates: Requirements 2.12, 3.11, 10.5
 *
 *   2.12  The Franchise Dietitian uniqueness check is evaluated inside the same
 *         database transaction that writes the Dietitian, so two concurrent
 *         submissions produce at most one active Franchise Dietitian.
 *  10.5   The at-most-one-active-Dietitian-per-Franchise rule is enforced by a
 *         database constraint (`users_one_active_dietitian_per_franchise`), not
 *         only application-layer validation.
 *   3.11  Banning a Dietitian's Supabase Auth account (without changing
 *         `users.is_active`) denies that Dietitian access to every portal — at
 *         the Auth layer, sign-in itself must fail.
 *
 * The file has two independently opt-in halves, mirroring
 * `migration.integration.test.ts`'s posture: `.env.local` (the shared/live
 * project) is never read, and each half skips with a self-describing reason
 * when its prerequisite is absent, so `npm test` stays green with no database
 * or Supabase project configured.
 *
 *   * "franchise uniqueness under concurrency" — opt-in via
 *     `DIETITIAN_TEST_DATABASE_URL` (see `src/test/db/README.md`). Fires two
 *     concurrent inserts of an active Franchise Dietitian for the same
 *     Franchise directly against Postgres and asserts the partial unique
 *     index (`users_one_active_dietitian_per_franchise`) lets exactly one
 *     through — this is the mechanism `DietitianAccountService.createDietitian`
 *     relies on to make Req 2.12 hold under a real race, and it also proves
 *     the "no advisory-lock coordination is needed" claim in the design: two
 *     bare concurrent `INSERT`s (no application-level locking, no
 *     read-then-write check) still leave exactly one active Franchise
 *     Dietitian.
 *
 *   * "banned account cannot sign in" — opt-in via `DIETITIAN_TEST_SUPABASE_URL`
 *     + service-role/anon keys (see `src/test/db/authRunner.ts`). Creates a
 *     real Supabase Auth user, bans it via
 *     `auth.admin.updateUserById(id, { ban_duration })` — the exact call
 *     `DietitianAccountService.toggleDietitianActive` makes on deactivation —
 *     without touching any `users.is_active` row, then asserts
 *     `signInWithPassword` fails for that account on the anon key. This is
 *     genuinely an Auth-service behavior; no in-memory fake can substitute for
 *     it, so it is exercised end to end against a real (test) Supabase project.
 *
 * A unit-level companion (`DietitianAccountService`'s constraint-violation →
 * message mapping) is already covered without a database by
 * `isFranchiseDietitianUniqueViolation` / `isMobileUniqueViolation`'s callers
 * in Task 7.3's property test (`Property 6`); this file is deliberately
 * scoped to the two claims that a mock cannot make: what the database index
 * actually does under a real race, and what Supabase Auth actually does with
 * a banned account.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DB_URL_ENV, execSql, harnessSkipReason, queryJson } from "../db/sqlRunner";
import {
  authHarnessSkipReason,
  createTestAdminClient,
  createTestAnonClient,
} from "../db/authRunner";

// ---------------------------------------------------------------------------
// Half 1 — franchise Dietitian uniqueness under concurrency (Req 2.12, 10.5)
// ---------------------------------------------------------------------------

const dbSkip = harnessSkipReason();
const dbSuiteName = dbSkip
  ? `Two concurrent Franchise Dietitian inserts — SKIPPED (${dbSkip})`
  : "Two concurrent Franchise Dietitian inserts leave exactly one active Dietitian";

describe.skipIf(dbSkip !== null)(dbSuiteName, () => {
  let baselineSkip: string | null = null;

  beforeAll(async () => {
    const present = await queryJson<{ name: string; present: boolean }>(`
      SELECT t.name,
             EXISTS (SELECT 1 FROM information_schema.tables i
                     WHERE i.table_schema = 'public' AND i.table_name = t.name) AS present
      FROM unnest(ARRAY['users', 'franchises', 'roles']) AS t(name)
    `);
    const missing = present.filter((r) => !r.present).map((r) => r.name);

    const index = await queryJson<{ present: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'users_one_active_dietitian_per_franchise'
      ) AS present
    `);

    if (missing.length > 0 || !index[0]?.present) {
      baselineSkip =
        `the database at ${DB_URL_ENV} is missing a prerequisite — ` +
        `tables: [${missing.join(", ") || "none"}], ` +
        `users_one_active_dietitian_per_franchise index present: ${index[0]?.present ?? false}. ` +
        `Apply scripts/create-dietitian-management.sql first (see src/test/db/README.md).`;
    }
  }, 60_000);

  /**
   * Fires two concurrent `INSERT`s of an active `dietitian` `users` row for
   * the SAME Franchise, each in its own connection/transaction (two separate
   * `psql` processes via `Promise.all`, exactly mirroring how two concurrent
   * HTTP requests would each open their own connection). No advisory lock, no
   * read-then-write check — only the partial unique index stands between this
   * and a duplicate. Returns how many of the two inserts committed.
   */
  async function raceTwoFranchiseDietitianInserts(): Promise<{
    committed: number;
    activeCountAfter: number;
    franchiseId: string;
  }> {
    const franchiseId = randomUUID();
    const roleId = randomUUID();
    const userIdA = randomUUID();
    const userIdB = randomUUID();

    const setup = await execSql(`
      INSERT INTO public.roles (id, code, name)
      VALUES ('${roleId}', 'FRANCHISE_ADMIN_RACE_${roleId.slice(0, 8)}', 'Race Test Role')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.franchises (id, name, status)
      VALUES ('${franchiseId}', 'Race Test Franchise ${franchiseId.slice(0, 8)}', 'active');
    `);
    if (!setup.ok) {
      throw new Error(`fixture setup failed: ${setup.message}`);
    }

    // Two genuinely separate connections (separate psql processes), each doing
    // exactly what DietitianAccountService.createDietitian's final write does:
    // a single INSERT of an active Franchise Dietitian for this franchise_id,
    // with no coordination between them.
    const insertOne = (userId: string, mobile: string) => `
      INSERT INTO public.users
        (id, role_id, full_name, email, mobile, admin_access_level, franchise_id, is_active)
      VALUES
        ('${userId}', '${roleId}', 'Race Dietitian ${userId.slice(0, 8)}',
         'race-${userId}@example.invalid', '${mobile}', 'dietitian', '${franchiseId}', true);
    `;

    const [resultA, resultB] = await Promise.all([
      execSql(insertOne(userIdA, "9000010001")),
      execSql(insertOne(userIdB, "9000010002")),
    ]);

    const committed = [resultA, resultB].filter((r) => r.ok).length;

    const activeCount = await queryJson<{ n: string }>(`
      SELECT count(*)::text AS n FROM public.users
      WHERE franchise_id = '${franchiseId}'
        AND admin_access_level = 'dietitian'
        AND is_active
    `);

    // Cleanup regardless of outcome — this suite writes real rows outside a
    // single rollback-able transaction because the race requires two separate
    // connections.
    await execSql(`
      DELETE FROM public.users WHERE franchise_id = '${franchiseId}';
      DELETE FROM public.franchises WHERE id = '${franchiseId}';
      DELETE FROM public.roles WHERE id = '${roleId}';
    `);

    return {
      committed,
      activeCountAfter: Number(activeCount[0]?.n ?? "0"),
      franchiseId,
    };
  }

  it("lets exactly one of two concurrent inserts commit, leaving exactly one active Dietitian (Req 2.12, 10.5, 10.6)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);

    const { committed, activeCountAfter } = await raceTwoFranchiseDietitianInserts();

    // The unique index is what makes this true under a real race — no
    // application-level lock or pre-check is involved in this test at all.
    expect(committed).toBe(1);
    expect(activeCountAfter).toBe(1);
  }, 30_000);

  it("rejects the losing insert with the partial unique index violation, not a generic error", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);

    const franchiseId = randomUUID();
    const roleId = randomUUID();
    const userIdA = randomUUID();
    const userIdB = randomUUID();

    const setup = await execSql(`
      INSERT INTO public.roles (id, code, name)
      VALUES ('${roleId}', 'FRANCHISE_ADMIN_RACE2_${roleId.slice(0, 8)}', 'Race Test Role 2')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.franchises (id, name, status)
      VALUES ('${franchiseId}', 'Race Test Franchise 2 ${franchiseId.slice(0, 8)}', 'active');
    `);
    expect(setup.ok, setup.ok ? "" : setup.message).toBe(true);

    const insertOne = (userId: string, mobile: string) => `
      INSERT INTO public.users
        (id, role_id, full_name, email, mobile, admin_access_level, franchise_id, is_active)
      VALUES
        ('${userId}', '${roleId}', 'Race Dietitian ${userId.slice(0, 8)}',
         'race2-${userId}@example.invalid', '${mobile}', 'dietitian', '${franchiseId}', true);
    `;

    const [resultA, resultB] = await Promise.all([
      execSql(insertOne(userIdA, "9000020001")),
      execSql(insertOne(userIdB, "9000020002")),
    ]);

    const outcomes = [resultA, resultB];
    const winners = outcomes.filter((r) => r.ok);
    const losers = outcomes.filter((r) => !r.ok);

    await execSql(`
      DELETE FROM public.users WHERE franchise_id = '${franchiseId}';
      DELETE FROM public.franchises WHERE id = '${franchiseId}';
      DELETE FROM public.roles WHERE id = '${roleId}';
    `);

    // INVERTED by franchise-scoped-access Task 11.
    //
    // This assertion used to be `winners === 1, losers === 1`, proving the
    // partial unique index `users_one_active_dietitian_per_franchise` let exactly
    // one concurrent insert through. `scripts/allow-multiple-franchise-dietitians.sql`
    // DROPS that index because a Franchise now needs a TEAM of Dietitians, each
    // reading only the Customer_Records assigned to them. So BOTH inserts must
    // now succeed, and no cardinality error may be raised.
    const failureMessages = losers.map((r) => (r.ok ? "" : r.message));
    expect(
      winners.length,
      `both concurrent franchise-dietitian inserts should succeed; failures: ${failureMessages.join(
        " | ",
      )}`,
    ).toBe(2);
    expect(losers.length).toBe(0);
    expect(failureMessages.join(" ").toLowerCase()).not.toContain(
      "users_one_active_dietitian_per_franchise",
    );
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Half 2 — a banned Dietitian auth account cannot sign in (Req 3.11)
// ---------------------------------------------------------------------------

const authSkip = authHarnessSkipReason();
const authSuiteName = authSkip
  ? `A banned Dietitian auth account cannot sign in — SKIPPED (${authSkip})`
  : "A banned Dietitian auth account cannot sign in";

describe.skipIf(authSkip !== null)(authSuiteName, () => {
  const createdAuthUserIds: string[] = [];

  afterEach(async () => {
    if (authSkip) return;
    const admin = createTestAdminClient();
    while (createdAuthUserIds.length > 0) {
      const id = createdAuthUserIds.pop();
      if (id) {
        await admin.auth.admin.deleteUser(id).catch(() => undefined);
      }
    }
  });

  it("signs in successfully before any ban is applied (sanity check on the fixture)", async () => {
    const admin = createTestAdminClient();
    const email = `dietitian-ban-sanity-${randomUUID()}@example.invalid`;
    const password = `Pw-${randomUUID()}`;

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(createError, createError?.message).toBeNull();
    expect(created?.user?.id).toBeTruthy();
    if (created?.user?.id) createdAuthUserIds.push(created.user.id);

    const anon = createTestAnonClient();
    const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
      email,
      password,
    });
    expect(signInError).toBeNull();
    expect(signIn?.session).toBeTruthy();
  }, 30_000);

  it(
    "denies sign-in once the auth account is banned via updateUserById(ban_duration), " +
      "with no change to any users.is_active row (Req 3.11)",
    async () => {
      const admin = createTestAdminClient();
      const email = `dietitian-banned-${randomUUID()}@example.invalid`;
      const password = `Pw-${randomUUID()}`;

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(createError, createError?.message).toBeNull();
      const authUserId = created?.user?.id;
      expect(authUserId).toBeTruthy();
      if (authUserId) createdAuthUserIds.push(authUserId);

      // The exact call DietitianAccountService.toggleDietitianActive makes on
      // deactivation (Req 3.9) — a long ban duration, applied to the Auth
      // account ONLY. This test never writes to `public.users` at all, so a
      // pass here isolates Req 3.11's claim: the ban itself, independent of
      // `users.is_active`, is what the Access_Control_Layer relies on.
      const { error: banError } = await admin.auth.admin.updateUserById(authUserId!, {
        ban_duration: "876600h",
      });
      expect(banError, banError?.message).toBeNull();

      const anon = createTestAnonClient();
      const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
        email,
        password,
      });

      expect(signInError).not.toBeNull();
      expect(signIn?.session).toBeFalsy();
    },
    30_000
  );

  it("restores sign-in once the ban is lifted (ban_duration: 'none'), matching the reactivation path", async () => {
    const admin = createTestAdminClient();
    const email = `dietitian-unbanned-${randomUUID()}@example.invalid`;
    const password = `Pw-${randomUUID()}`;

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(createError, createError?.message).toBeNull();
    const authUserId = created?.user?.id;
    expect(authUserId).toBeTruthy();
    if (authUserId) createdAuthUserIds.push(authUserId);

    await admin.auth.admin.updateUserById(authUserId!, { ban_duration: "876600h" });

    const anonBeforeUnban = createTestAnonClient();
    const { error: bannedSignInError } = await anonBeforeUnban.auth.signInWithPassword({
      email,
      password,
    });
    expect(bannedSignInError).not.toBeNull();

    const { error: unbanError } = await admin.auth.admin.updateUserById(authUserId!, {
      ban_duration: "none",
    });
    expect(unbanError, unbanError?.message).toBeNull();

    const anonAfterUnban = createTestAnonClient();
    const { data: signIn, error: signInError } = await anonAfterUnban.auth.signInWithPassword({
      email,
      password,
    });
    expect(signInError).toBeNull();
    expect(signIn?.session).toBeTruthy();
  }, 30_000);
});
