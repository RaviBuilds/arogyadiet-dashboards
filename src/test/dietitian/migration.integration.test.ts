/**
 * Feature: dietitian-management, Task 1.4 — integration tests for the migration
 * and the database constraints it installs.
 *
 * Validates: Requirements 1.2, 1.3, 2.7, 18.7, 26.3, 26.8
 *
 *   1.2  `dietitian` is an admissible `admin_access_level`.
 *   1.3  Re-running the migration leaves schema and data unchanged.
 *   2.7  A Dietitian row must carry a 10-digit mobile, enforced in the database.
 *  18.7  `health_log_audit_entries` is append-only even for the service role.
 *  26.3  `admin_health_logs`, `customer_health_logs` and `kit_daily_logs` are untouched.
 *  26.8  Every statement in both scripts is idempotent.
 *
 * The file has two halves:
 *
 *   * "script guarantees" — reads the two `scripts/*.sql` files and asserts the
 *     structural properties that make them idempotent and additive. These run
 *     everywhere, including CI with no database.
 *
 *   * "live database" — applies both scripts to a scratch Postgres twice and
 *     asserts the behavioural claims (identical schema + data, constraints
 *     accept/reject direct writes, audit mutations raise). Opt-in via
 *     `DIETITIAN_TEST_DATABASE_URL`; skips with a message naming the missing
 *     prerequisite otherwise. See `src/test/db/README.md`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import {
  DB_URL_ENV,
  execSql,
  execSqlFile,
  harnessSkipReason,
  queryJson,
} from "../db/sqlRunner";

// vitest runs with the project root as cwd (see vitest.config.ts).
const REPO_ROOT = process.cwd();
const SCHEMA_SCRIPT = path.join(REPO_ROOT, "scripts", "create-dietitian-management.sql");
const RLS_SCRIPT = path.join(REPO_ROOT, "scripts", "create-dietitian-management-rls.sql");

const LEGACY_LOG_TABLES = [
  "admin_health_logs",
  "customer_health_logs",
  "kit_daily_logs",
] as const;

/**
 * Strips `--` line comments so the assertions below only ever look at statements
 * the server actually executes. Both scripts carry their rollback plan in
 * comments, which contains exactly the DROP/ALTER statements we assert against.
 * Neither script embeds `--` inside a string literal, so a line-wise strip is
 * sufficient here.
 */
function executableSql(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => {
      const marker = line.indexOf("--");
      return marker === -1 ? line : line.slice(0, marker);
    })
    .join("\n");
}

function normalise(sql: string): string {
  return sql.replace(/\s+/g, " ");
}

function matches(sql: string, pattern: RegExp): string[] {
  return [...sql.matchAll(pattern)].map((m) => m[1] ?? m[0]);
}

const SCHEMA_RAW = readFileSync(SCHEMA_SCRIPT, "utf8");
const RLS_RAW = readFileSync(RLS_SCRIPT, "utf8");
const SCHEMA_SQL = executableSql(SCHEMA_RAW);
const RLS_SQL = executableSql(RLS_RAW);
const BOTH_SQL = `${SCHEMA_SQL}\n${RLS_SQL}`;

describe("Dietitian migration script guarantees (Req 1.3, 26.3, 26.8)", () => {
  describe("scripts/create-dietitian-management.sql is idempotent", () => {
    it("guards every CREATE TABLE, index and ADD COLUMN with IF NOT EXISTS", () => {
      const tables = matches(SCHEMA_SQL, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([\w.]+)/gi);
      const indexes = matches(
        SCHEMA_SQL,
        /CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+([\w.]+)/gi
      );
      const columns = matches(SCHEMA_SQL, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi);

      // Guard against the absence-assertions below being vacuous.
      expect(tables).toEqual(
        expect.arrayContaining(["public.health_logs", "public.health_log_audit_entries"])
      );
      expect(indexes.length).toBeGreaterThanOrEqual(6);
      expect(columns).toEqual(
        expect.arrayContaining(["dietitian_clinic_id", "dietitian_id"])
      );

      expect(SCHEMA_SQL).not.toMatch(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i);
      expect(SCHEMA_SQL).not.toMatch(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/i);
      expect(SCHEMA_SQL).not.toMatch(/ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/i);
    });

    it("drops each constraint before adding it", () => {
      const added = matches(SCHEMA_SQL, /ADD\s+CONSTRAINT\s+(\w+)/gi);
      expect(added).toEqual(
        expect.arrayContaining(["users_admin_access_level_check", "users_dietitian_mobile_check"])
      );
      for (const name of added) {
        expect(SCHEMA_SQL).toMatch(
          new RegExp(`DROP\\s+CONSTRAINT\\s+IF\\s+EXISTS\\s+${name}\\b`, "i")
        );
      }
    });

    it("recreates the audit function and trigger without duplicating them", () => {
      expect(SCHEMA_SQL).not.toMatch(/CREATE\s+FUNCTION\s/i);
      expect(SCHEMA_SQL).toMatch(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.reject_audit_mutation/i
      );

      const triggers = matches(SCHEMA_SQL, /CREATE\s+TRIGGER\s+(\w+)/gi);
      expect(triggers).toEqual(["trg_health_log_audit_immutable"]);
      for (const name of triggers) {
        expect(SCHEMA_SQL).toMatch(
          new RegExp(`DROP\\s+TRIGGER\\s+IF\\s+EXISTS\\s+${name}\\b`, "i")
        );
      }
    });
  });

  describe("scripts/create-dietitian-management-rls.sql is idempotent", () => {
    it("drops the view and every policy before creating it, and replaces the helpers", () => {
      expect(RLS_SQL).toMatch(/DROP\s+VIEW\s+IF\s+EXISTS\s+public\.v_health_log_timeline/i);
      expect(matches(RLS_SQL, /CREATE\s+VIEW\s+([\w.]+)/gi)).toEqual([
        "public.v_health_log_timeline",
      ]);

      expect(RLS_SQL).not.toMatch(/CREATE\s+FUNCTION\s/i);
      expect(matches(RLS_SQL, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)/gi)).toEqual([
        "current_dietitian",
        "dietitian_can_read_customer",
      ]);

      const policies = matches(RLS_SQL, /CREATE\s+POLICY\s+(\w+)/gi);
      expect(policies.length).toBeGreaterThanOrEqual(6);
      for (const name of policies) {
        expect(RLS_SQL).toMatch(
          new RegExp(`DROP\\s+POLICY\\s+IF\\s+EXISTS\\s+${name}\\b`, "i")
        );
      }
    });

    it("creates no DELETE policy on health_logs and no UPDATE/DELETE path on the audit trail (Req 18.4, 18.7)", () => {
      const flat = normalise(RLS_SQL);
      expect(flat).not.toMatch(/ON public\.health_logs FOR DELETE/i);
      expect(flat).not.toMatch(/ON public\.health_log_audit_entries FOR (UPDATE|DELETE)/i);

      const audit = matches(flat, /GRANT ([^;]*?) ON public\.health_log_audit_entries/gi);
      expect(audit.length).toBeGreaterThanOrEqual(1);
      for (const grant of audit) {
        expect(grant.toUpperCase()).not.toMatch(/\b(UPDATE|DELETE|ALL)\b/);
      }
    });
  });

  describe("both scripts are additive over the legacy log tables (Req 26.3)", () => {
    it.each(LEGACY_LOG_TABLES)("never writes to or alters %s", (table) => {
      const flat = normalise(BOTH_SQL);
      const qualified = `(?:public\\.)?${table}\\b`;
      const forbidden: Array<[string, RegExp]> = [
        ["ALTER TABLE", new RegExp(`ALTER TABLE (?:IF EXISTS )?${qualified}`, "i")],
        ["DROP TABLE", new RegExp(`DROP TABLE (?:IF EXISTS )?${qualified}`, "i")],
        ["INSERT", new RegExp(`INSERT INTO ${qualified}`, "i")],
        ["UPDATE", new RegExp(`UPDATE (?:ONLY )?${qualified}`, "i")],
        ["DELETE", new RegExp(`DELETE FROM (?:ONLY )?${qualified}`, "i")],
        ["TRUNCATE", new RegExp(`TRUNCATE (?:TABLE )?${qualified}`, "i")],
        // Policies, triggers, indexes, grants and comments all target with ON.
        ["ON <table>", new RegExp(`\\bON ${qualified}`, "i")],
      ];
      for (const [label, pattern] of forbidden) {
        expect(flat, `${label} must not target ${table}`).not.toMatch(pattern);
      }

      // It is read, though — the timeline view unions it in.
      expect(flat).toMatch(new RegExp(`FROM public\\.${table}\\b`, "i"));
    });
  });

  describe("the constraints carry the specified predicates", () => {
    it("admits the three legacy access levels plus dietitian, and nothing else (Req 1.2, 26.7)", () => {
      const flat = normalise(SCHEMA_SQL);
      expect(flat).toContain(
        "CHECK (admin_access_level IS NULL OR admin_access_level = ANY (ARRAY[ 'inventory','operations','inventory_operations','dietitian' ])"
      );
    });

    it("requires a 10-digit mobile for a Dietitian only (Req 2.7)", () => {
      const flat = normalise(SCHEMA_SQL);
      expect(flat).toContain("CONSTRAINT users_dietitian_mobile_check");
      expect(flat).toContain("admin_access_level IS DISTINCT FROM 'dietitian'");
      expect(flat).toContain("mobile IS NOT NULL AND mobile ~ '^[0-9]{10}$'");
    });

    it("blocks both UPDATE and DELETE on the audit trail with a BEFORE trigger (Req 18.7)", () => {
      const flat = normalise(SCHEMA_SQL);
      expect(flat).toContain(
        "BEFORE UPDATE OR DELETE ON public.health_log_audit_entries FOR EACH ROW EXECUTE FUNCTION public.reject_audit_mutation()"
      );
      expect(flat).toContain("RAISE EXCEPTION 'health_log_audit_entries is append-only'");
    });
  });
});

// ---------------------------------------------------------------------------
// Live database half
// ---------------------------------------------------------------------------

const BASELINE_TABLES = [
  "users",
  "customer_profiles",
  "clinics",
  "franchises",
  "subscriptions",
  ...LEGACY_LOG_TABLES,
];
const BASELINE_FUNCTIONS = ["is_global_role", "current_app_user_id"];

const FINGERPRINT_SQL = `
SELECT json_build_object(
  'columns', (
    SELECT coalesce(json_agg(json_build_object(
             'table', c.table_name, 'column', c.column_name, 'type', c.data_type,
             'nullable', c.is_nullable, 'default', c.column_default)
             ORDER BY c.table_name, c.column_name), '[]'::json)
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND (c.table_name IN ('health_logs', 'health_log_audit_entries')
        OR (c.table_name = 'users' AND c.column_name IN ('admin_access_level', 'dietitian_clinic_id'))
        OR (c.table_name = 'customer_profiles' AND c.column_name = 'dietitian_id'))
  ),
  'constraints', (
    SELECT coalesce(json_agg(json_build_object(
             'table', rel.relname, 'name', con.conname, 'def', pg_get_constraintdef(con.oid))
             ORDER BY rel.relname, con.conname), '[]'::json)
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname IN ('users', 'customer_profiles', 'health_logs', 'health_log_audit_entries')
  ),
  'indexes', (
    SELECT coalesce(json_agg(json_build_object('name', indexname, 'def', indexdef)
             ORDER BY indexname), '[]'::json)
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('users', 'customer_profiles', 'health_logs', 'health_log_audit_entries')
  ),
  'policies', (
    SELECT coalesce(json_agg(json_build_object('table', tablename, 'name', policyname,
             'cmd', cmd, 'roles', roles::text, 'using', qual, 'check', with_check)
             ORDER BY tablename, policyname), '[]'::json)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('customer_profiles', 'health_logs', 'health_log_audit_entries')
  ),
  'triggers', (
    SELECT coalesce(json_agg(json_build_object('name', t.tgname, 'def', pg_get_triggerdef(t.oid))
             ORDER BY t.tgname), '[]'::json)
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname = 'public'
      AND c.relname IN ('health_logs', 'health_log_audit_entries')
  ),
  'views', (
    SELECT coalesce(json_agg(json_build_object('name', viewname, 'def', definition)
             ORDER BY viewname), '[]'::json)
    FROM pg_views WHERE schemaname = 'public' AND viewname = 'v_health_log_timeline'
  ),
  'functions', (
    SELECT coalesce(json_agg(json_build_object('name', p.proname, 'def', pg_get_functiondef(p.oid))
             ORDER BY p.proname), '[]'::json)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('current_dietitian', 'dietitian_can_read_customer', 'reject_audit_mutation')
  )
) AS fingerprint
`;

const LEGACY_SCHEMA_SQL = `
SELECT json_build_object(
  'columns', (
    SELECT coalesce(json_agg(json_build_object('table', table_name, 'column', column_name,
             'type', data_type, 'nullable', is_nullable, 'default', column_default)
             ORDER BY table_name, column_name), '[]'::json)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('admin_health_logs', 'customer_health_logs', 'kit_daily_logs')
  ),
  'constraints', (
    SELECT coalesce(json_agg(json_build_object('table', rel.relname, 'name', con.conname,
             'def', pg_get_constraintdef(con.oid)) ORDER BY rel.relname, con.conname), '[]'::json)
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname IN ('admin_health_logs', 'customer_health_logs', 'kit_daily_logs')
  ),
  'indexes', (
    SELECT coalesce(json_agg(json_build_object('name', indexname, 'def', indexdef)
             ORDER BY indexname), '[]'::json)
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('admin_health_logs', 'customer_health_logs', 'kit_daily_logs')
  ),
  'policies', (
    SELECT coalesce(json_agg(json_build_object('table', tablename, 'name', policyname, 'cmd', cmd,
             'roles', roles::text, 'using', qual, 'check', with_check)
             ORDER BY tablename, policyname), '[]'::json)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('admin_health_logs', 'customer_health_logs', 'kit_daily_logs')
  ),
  'triggers', (
    SELECT coalesce(json_agg(json_build_object('table', c.relname, 'name', t.tgname,
             'def', pg_get_triggerdef(t.oid)) ORDER BY c.relname, t.tgname), '[]'::json)
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname = 'public'
      AND c.relname IN ('admin_health_logs', 'customer_health_logs', 'kit_daily_logs')
  )
) AS legacy_schema
`;

const LEGACY_DATA_SQL = `
SELECT
  (SELECT count(*) FROM public.admin_health_logs) AS admin_rows,
  (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), ''))
     FROM public.admin_health_logs t) AS admin_digest,
  (SELECT count(*) FROM public.customer_health_logs) AS customer_rows,
  (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), ''))
     FROM public.customer_health_logs t) AS customer_digest,
  (SELECT count(*) FROM public.kit_daily_logs) AS kit_rows,
  (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), ''))
     FROM public.kit_daily_logs t) AS kit_digest
`;

const harnessSkip = harnessSkipReason();
const suiteName = harnessSkip
  ? `Dietitian migration against a live database — SKIPPED (${harnessSkip})`
  : "Dietitian migration against a live database";

describe.skipIf(harnessSkip !== null)(suiteName, () => {
  let baselineSkip: string | null = null;
  let fingerprintAfterFirst: unknown;
  let fingerprintAfterSecond: unknown;
  let legacySchemaBefore: unknown;
  let legacySchemaAfterFirst: unknown;
  let legacySchemaAfterSecond: unknown;
  let legacyDataBefore: unknown;
  let legacyDataAfterFirst: unknown;
  let legacyDataAfterSecond: unknown;

  beforeAll(async () => {
    const present = await queryJson<{ name: string; present: boolean }>(`
      SELECT t.name,
             EXISTS (SELECT 1 FROM information_schema.tables i
                     WHERE i.table_schema = 'public' AND i.table_name = t.name) AS present
      FROM unnest(ARRAY[${BASELINE_TABLES.map((t) => `'${t}'`).join(", ")}]) AS t(name)
    `);
    const missingTables = present.filter((r) => !r.present).map((r) => r.name);

    const fns = await queryJson<{ name: string; present: boolean }>(`
      SELECT t.name,
             EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public' AND p.proname = t.name) AS present
      FROM unnest(ARRAY[${BASELINE_FUNCTIONS.map((f) => `'${f}'`).join(", ")}]) AS t(name)
    `);
    const missingFns = fns.filter((r) => !r.present).map((r) => r.name);

    if (missingTables.length > 0 || missingFns.length > 0) {
      baselineSkip =
        `the database at ${DB_URL_ENV} is missing the pre-feature baseline — ` +
        `tables: [${missingTables.join(", ") || "none"}], ` +
        `functions: [${missingFns.join(", ") || "none"}]. ` +
        `Restore a schema-only dump first (see src/test/db/README.md).`;
      return;
    }

    legacySchemaBefore = (await queryJson(LEGACY_SCHEMA_SQL))[0];
    legacyDataBefore = (await queryJson(LEGACY_DATA_SQL))[0];

    const firstSchema = await execSqlFile(SCHEMA_SCRIPT);
    expect(firstSchema.ok, `first pass of create-dietitian-management.sql: ${
      firstSchema.ok ? "" : firstSchema.message
    }`).toBe(true);
    const firstRls = await execSqlFile(RLS_SCRIPT);
    expect(firstRls.ok, `first pass of create-dietitian-management-rls.sql: ${
      firstRls.ok ? "" : firstRls.message
    }`).toBe(true);

    fingerprintAfterFirst = (await queryJson(FINGERPRINT_SQL))[0];
    legacySchemaAfterFirst = (await queryJson(LEGACY_SCHEMA_SQL))[0];
    legacyDataAfterFirst = (await queryJson(LEGACY_DATA_SQL))[0];

    const secondSchema = await execSqlFile(SCHEMA_SCRIPT);
    expect(secondSchema.ok, `second pass of create-dietitian-management.sql: ${
      secondSchema.ok ? "" : secondSchema.message
    }`).toBe(true);
    const secondRls = await execSqlFile(RLS_SCRIPT);
    expect(secondRls.ok, `second pass of create-dietitian-management-rls.sql: ${
      secondRls.ok ? "" : secondRls.message
    }`).toBe(true);

    fingerprintAfterSecond = (await queryJson(FINGERPRINT_SQL))[0];
    legacySchemaAfterSecond = (await queryJson(LEGACY_SCHEMA_SQL))[0];
    legacyDataAfterSecond = (await queryJson(LEGACY_DATA_SQL))[0];
  }, 300_000);

  it("runs twice with an identical resulting schema (Req 1.3, 26.8)", (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    expect(fingerprintAfterSecond).toEqual(fingerprintAfterFirst);
  });

  it("leaves the legacy log tables' schema and data unchanged (Req 26.3)", (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    expect(legacySchemaAfterFirst).toEqual(legacySchemaBefore);
    expect(legacySchemaAfterSecond).toEqual(legacySchemaBefore);
    expect(legacyDataAfterFirst).toEqual(legacyDataBefore);
    expect(legacyDataAfterSecond).toEqual(legacyDataBefore);
  });

  it("accepts every admissible admin_access_level and rejects the rest (Req 1.2, 26.7)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_level text;
        v_n int;
        v_id uuid;
      BEGIN
        -- Every legacy level plus the new one is admissible.
        FOR v_level, v_n IN
          SELECT * FROM unnest(ARRAY['inventory','operations','inventory_operations','dietitian'])
            WITH ORDINALITY
        LOOP
          INSERT INTO public.users (full_name, email, mobile, admin_access_level, is_active)
          VALUES ('AL Probe', 'al-' || v_n || '-' || gen_random_uuid() || '@example.invalid',
                  '90000000' || lpad(v_n::text, 2, '0'), v_level, false)
          RETURNING id INTO v_id;
          IF v_id IS NULL THEN
            RAISE EXCEPTION 'ASSERTION FAILED: admin_access_level=% was not stored', v_level;
          END IF;
        END LOOP;

        -- NULL still means "no admin access".
        INSERT INTO public.users (full_name, email, mobile, admin_access_level)
        VALUES ('AL Probe null', 'al-null-' || gen_random_uuid() || '@example.invalid',
                '9000000090', NULL);

        -- Anything else is refused.
        BEGIN
          INSERT INTO public.users (full_name, email, mobile, admin_access_level)
          VALUES ('AL Probe bogus', 'al-bogus-' || gen_random_uuid() || '@example.invalid',
                  '9000000091', 'dietician');
          RAISE EXCEPTION 'ASSERTION FAILED: admin_access_level=dietician was accepted';
        EXCEPTION WHEN check_violation THEN
          NULL;
        END;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  it("enforces a 10-digit mobile for Dietitians only (Req 2.7)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_bad text;
        v_n int;
      BEGIN
        -- A Dietitian with a well-formed mobile is accepted.
        INSERT INTO public.users (full_name, email, mobile, admin_access_level, is_active)
        VALUES ('Mobile Probe ok', 'mob-ok-' || gen_random_uuid() || '@example.invalid',
                '9876543210', 'dietitian', false);

        -- A non-Dietitian is unaffected by the new constraint (additivity).
        INSERT INTO public.users (full_name, email, mobile, admin_access_level)
        VALUES ('Mobile Probe legacy', 'mob-legacy-' || gen_random_uuid() || '@example.invalid',
                NULL, 'operations');

        -- Every malformed Dietitian mobile is refused.
        FOR v_bad, v_n IN
          SELECT * FROM unnest(ARRAY['', '12345', '12345678901', '98765abc12', '987 654 3210',
                                     '+919876543210']) WITH ORDINALITY
        LOOP
          BEGIN
            INSERT INTO public.users (full_name, email, mobile, admin_access_level, is_active)
            VALUES ('Mobile Probe bad', 'mob-bad-' || v_n || '-' || gen_random_uuid() || '@example.invalid',
                    v_bad, 'dietitian', false);
            RAISE EXCEPTION 'ASSERTION FAILED: dietitian mobile "%" was accepted', v_bad;
          EXCEPTION WHEN check_violation THEN
            NULL;
          END;
        END LOOP;

        -- A missing mobile is refused too.
        BEGIN
          INSERT INTO public.users (full_name, email, mobile, admin_access_level, is_active)
          VALUES ('Mobile Probe null', 'mob-null-' || gen_random_uuid() || '@example.invalid',
                  NULL, 'dietitian', false);
          RAISE EXCEPTION 'ASSERTION FAILED: dietitian with a NULL mobile was accepted';
        EXCEPTION WHEN check_violation THEN
          NULL;
        END;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  it("raises on UPDATE and DELETE of health_log_audit_entries, service role included (Req 18.7)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_user uuid;
        v_profile uuid;
        v_entry uuid;
        v_has_service_role boolean;
      BEGIN
        INSERT INTO public.users (full_name, email, mobile, admin_access_level, is_active)
        VALUES ('Audit Probe', 'audit-' || gen_random_uuid() || '@example.invalid',
                '9000000099', 'dietitian', false)
        RETURNING id INTO v_user;

        INSERT INTO public.customer_profiles (user_id) VALUES (v_user) RETURNING id INTO v_profile;

        INSERT INTO public.health_log_audit_entries
          (customer_profile_id, log_date, actor_user_id, action, outcome)
        VALUES (v_profile, current_date, v_user, 'CREATE', 'ACCEPTED')
        RETURNING id INTO v_entry;

        -- As the connecting (owner/superuser) role: only the trigger can stop this.
        BEGIN
          UPDATE public.health_log_audit_entries SET outcome = 'REJECTED' WHERE id = v_entry;
          RAISE EXCEPTION 'ASSERTION FAILED: UPDATE on health_log_audit_entries succeeded';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF;
        END;

        BEGIN
          DELETE FROM public.health_log_audit_entries WHERE id = v_entry;
          RAISE EXCEPTION 'ASSERTION FAILED: DELETE on health_log_audit_entries succeeded';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF;
        END;

        -- And as service_role, the key every server action uses. The GRANT below
        -- is rolled back with the transaction; it exists so the attempt reaches
        -- the trigger instead of stopping at a missing privilege, which is what
        -- Req 18.7 is actually about.
        SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
          INTO v_has_service_role;

        IF v_has_service_role THEN
          EXECUTE 'GRANT UPDATE, DELETE ON public.health_log_audit_entries TO service_role';
          PERFORM set_config('role', 'service_role', true);

          BEGIN
            UPDATE public.health_log_audit_entries SET outcome = 'REJECTED' WHERE id = v_entry;
            PERFORM set_config('role', 'none', true);
            RAISE EXCEPTION 'ASSERTION FAILED: service_role UPDATE on health_log_audit_entries succeeded';
          EXCEPTION WHEN raise_exception THEN
            IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF;
          END;

          BEGIN
            DELETE FROM public.health_log_audit_entries WHERE id = v_entry;
            PERFORM set_config('role', 'none', true);
            RAISE EXCEPTION 'ASSERTION FAILED: service_role DELETE on health_log_audit_entries succeeded';
          EXCEPTION WHEN raise_exception THEN
            IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF;
          END;

          PERFORM set_config('role', 'none', true);
        ELSE
          RAISE NOTICE 'service_role is absent (not a Supabase database); owner-role assertions still ran';
        END IF;

        -- The entry survived every attempt.
        IF NOT EXISTS (SELECT 1 FROM public.health_log_audit_entries WHERE id = v_entry
                         AND outcome = 'ACCEPTED') THEN
          RAISE EXCEPTION 'ASSERTION FAILED: the audit entry was mutated or removed';
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });
});
