/**
 * Feature: clinic-scoped-shop-inventory, Task 12.3 — integration test for
 * `migrate_shop_stock_to_clinics()` idempotency and its no-Core-Clinic report.
 *
 * Validates: Requirements 20.2, 20.9, 20.10, 20.13
 *
 *  20.2   Every Clinic_Shop_Stock record and every Clinic_Shop_Ledger entry a
 *         migration run creates is created within a single database
 *         transaction.
 *  20.9   A (Core_Clinic, Shop_Product) pair that already holds a
 *         Clinic_Shop_Stock record is left completely unchanged, and no
 *         Clinic_Shop_Ledger entry is recorded for that pair.
 *  20.10  Running the migration a second time leaves every Clinic_Shop_Stock
 *         `stock_quantity` and every Clinic_Shop_Ledger entry equal to the
 *         values the first run produced.
 *  20.13  IF no Core_Clinic exists when the migration runs, THEN the System
 *         creates no Clinic_Shop_Stock record, creates no Clinic_Shop_Ledger
 *         entry, and reports that no Core_Clinic was available.
 *
 * The file has two halves, mirroring `src/test/shop/schema-guards.integration
 * .test.ts` (Task 1.4) and `src/test/shop/clinic-rpc-integration.test.ts`
 * (Task 4.14) exactly:
 *
 *   * "script guarantees" — reads `scripts/migrate-shared-shop-stock-to-
 *     clinics.sql` as text and asserts the structural facts that make the
 *     idempotency and no-Core-Clinic behaviour possible in the first place:
 *     the function is `CREATE OR REPLACE` (re-runnable), overlay creation is
 *     `ON CONFLICT (clinic_id, product_id) DO NOTHING`, the ledger INSERT is
 *     driven off that insert's own `RETURNING` set rather than a fresh SELECT
 *     (so a second run — where nothing new is inserted — writes no ledger
 *     entries either), and the `NO_CORE_CLINIC` report is returned before any
 *     write is attempted. These run everywhere, including CI with no
 *     database.
 *
 *   * "live database" — applies the dependency scripts and this migration
 *     script to a scratch Postgres and asserts the two behavioural claims
 *     this task names, EXACTLY as the task states them:
 *       (1) `migrate_shop_stock_to_clinics()` run twice against concrete
 *           example data (a valid, a `null`, and a negative legacy quantity,
 *           across two Core Clinics and one excluded franchise-owned clinic)
 *           produces identical overlay quantities and ledger entries — the
 *           second run's report shows zero of each, and the stored overlay
 *           and ledger rows are byte-for-byte identical to the first run's
 *           result.
 *       (2) A run against a database with zero Core Clinics (only a
 *           franchise-owned one) reports `NO_CORE_CLINIC` and creates
 *           nothing at all, confirmed directly against the tables, not just
 *           the report.
 *     Each test is one self-contained `BEGIN ... DO $$ ... $$; ROLLBACK;`
 *     script that builds its own fixtures and asserts inside plpgsql, exactly
 *     like the two sibling suites. Opt-in via `TEST_DATABASE_URL` (alias
 *     `DIETITIAN_TEST_DATABASE_URL`; see `src/test/db/README.md`); skips with
 *     a message naming the missing prerequisite otherwise.
 *
 * These are deliberately concrete, example-based assertions — not a
 * fast-check property. Task 12.2 (Property 20, `property20-
 * migrationQuantityPreserving.property.test.ts`) already generates the
 * general quantity-preserving/idempotency property against the fast, in-
 * memory model; this file's job is to pin that model's idempotency claim to
 * what the REAL RPC does on REAL Postgres, with fixed inputs anyone can read
 * and reason about directly.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { DB_URL_ENV, execSql, execSqlFile, harnessSkipReason, queryJson } from "../db/sqlRunner";

// vitest runs with the project root as cwd (see vitest.config.ts).
const REPO_ROOT = process.cwd();
const SETTINGS_SCRIPT = path.join(REPO_ROOT, "scripts", "create-clinic-product-settings-table.sql");
const LEDGER_SCRIPT = path.join(REPO_ROOT, "scripts", "create-clinic-product-ledger-table.sql");
const MIGRATION_SCRIPT = path.join(REPO_ROOT, "scripts", "migrate-shared-shop-stock-to-clinics.sql");

/** Same convention as the Task 1.4 / Task 4.14 siblings: strip `--` line comments only. */
function executableSql(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => {
      const marker = line.indexOf("--");
      return marker === -1 ? line : line.slice(0, marker);
    })
    .join("\n");
}

const MIGRATION_SQL = executableSql(readFileSync(MIGRATION_SCRIPT, "utf8"));

// ---------------------------------------------------------------------------
// Script guarantees — no database needed
// ---------------------------------------------------------------------------

describe("migrate_shop_stock_to_clinics() — script guarantees (idempotency mechanism)", () => {
  it("is CREATE OR REPLACE, so re-running the script itself never duplicates the function", () => {
    expect(MIGRATION_SQL).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.migrate_shop_stock_to_clinics\s*\(\s*\)/i,
    );
    expect(MIGRATION_SQL).not.toMatch(/CREATE\s+FUNCTION\s+public\.migrate_shop_stock_to_clinics/i);
  });

  it("creates every overlay row with ON CONFLICT (clinic_id, product_id) DO NOTHING, exactly once (Req 20.9, 20.10)", () => {
    const conflictClauses = [
      ...MIGRATION_SQL.matchAll(/ON\s+CONFLICT\s*\(\s*clinic_id\s*,\s*product_id\s*\)\s*DO\s+NOTHING/gi),
    ];
    expect(conflictClauses).toHaveLength(1);

    // It guards the INSERT into clinic_product_settings specifically — the
    // clause that makes a pre-existing pair immune and a second run inert.
    const insertIndex = MIGRATION_SQL.indexOf("INSERT INTO public.clinic_product_settings");
    expect(insertIndex).toBeGreaterThan(-1);
    const conflictIndex = MIGRATION_SQL.search(
      /ON\s+CONFLICT\s*\(\s*clinic_id\s*,\s*product_id\s*\)\s*DO\s+NOTHING/i,
    );
    expect(conflictIndex).toBeGreaterThan(insertIndex);
  });

  it("writes the ledger INSERT from the settings insert's own RETURNING set, not a fresh SELECT (Req 20.2, 20.10)", () => {
    // A second run inserts zero new settings rows (every pair already exists),
    // so if the ledger insert's source rowset were anything other than THIS
    // run's own RETURNING output, a second run could still see — and write —
    // rows a fresh, unscoped SELECT would find. Confirm the ledger INSERT's
    // SELECT is literally sourced FROM the settings insert's CTE, in order.
    const insertedLedgerIndex = MIGRATION_SQL.search(/inserted_ledger\s+AS\s*\(/i);
    const insertedSettingsIndex = MIGRATION_SQL.search(/inserted_settings\s+AS\s*\(/i);
    expect(insertedLedgerIndex).toBeGreaterThan(-1);
    expect(insertedSettingsIndex).toBeGreaterThan(-1);
    // The settings CTE is declared before the ledger CTE that reads it.
    expect(insertedSettingsIndex).toBeLessThan(insertedLedgerIndex);

    const ledgerCteBody = MIGRATION_SQL.slice(insertedLedgerIndex);
    expect(ledgerCteBody).toMatch(/FROM\s+inserted_settings/i);
    expect(ledgerCteBody).toMatch(/WHERE\s+stock_quantity\s*>\s*0/i);

    // And the settings CTE itself is fed by the ON CONFLICT DO NOTHING
    // insert's RETURNING clause, not a plain SELECT against the table.
    const settingsCteBody = MIGRATION_SQL.slice(insertedSettingsIndex, insertedLedgerIndex);
    expect(settingsCteBody).toMatch(/ON\s+CONFLICT\s*\(\s*clinic_id\s*,\s*product_id\s*\)\s*DO\s+NOTHING/i);
    expect(settingsCteBody).toMatch(/RETURNING\s+clinic_id,\s*product_id,\s*stock_quantity/i);
  });

  it("returns the NO_CORE_CLINIC report before any write is attempted (Req 20.13)", () => {
    const noCoreClinicIndex = MIGRATION_SQL.indexOf("'status', 'NO_CORE_CLINIC'");
    expect(noCoreClinicIndex).toBeGreaterThan(-1);

    const firstInsertIndex = MIGRATION_SQL.indexOf("INSERT INTO public.clinic_product_settings");
    const firstLedgerInsertIndex = MIGRATION_SQL.indexOf("INSERT INTO public.clinic_product_ledger");
    expect(firstInsertIndex).toBeGreaterThan(-1);
    expect(firstLedgerInsertIndex).toBeGreaterThan(-1);

    expect(noCoreClinicIndex).toBeLessThan(firstInsertIndex);
    expect(noCoreClinicIndex).toBeLessThan(firstLedgerInsertIndex);
  });
});

// ---------------------------------------------------------------------------
// Live database half
// ---------------------------------------------------------------------------

const BASELINE_TABLES = [
  "clinics",
  "kitchens",
  "products",
  "users",
  "roles",
  "franchises",
  "addon_orders",
  "inventory_transactions",
];

const harnessSkip = harnessSkipReason();
const suiteName = harnessSkip
  ? `migrate_shop_stock_to_clinics() against a live database — SKIPPED (${harnessSkip})`
  : "migrate_shop_stock_to_clinics() against a live database";

describe.skipIf(harnessSkip !== null)(suiteName, () => {
  let baselineSkip: string | null = null;

  beforeAll(async () => {
    const present = await queryJson<{ name: string; present: boolean }>(`
      SELECT t.name,
             EXISTS (SELECT 1 FROM information_schema.tables i
                     WHERE i.table_schema = 'public' AND i.table_name = t.name) AS present
      FROM unnest(ARRAY[${BASELINE_TABLES.map((t) => `'${t}'`).join(", ")}]) AS t(name)
    `);
    const missing = present.filter((r) => !r.present).map((r) => r.name);
    if (missing.length > 0) {
      baselineSkip =
        `the database at ${DB_URL_ENV} is missing the pre-feature baseline — ` +
        `tables: [${missing.join(", ")}]. Restore a schema-only dump first ` +
        `(see src/test/db/README.md).`;
      return;
    }

    // Dependency order: the two overlay/ledger tables the migration writes
    // through, then the migration function itself.
    for (const script of [SETTINGS_SCRIPT, LEDGER_SCRIPT, MIGRATION_SCRIPT]) {
      const outcome = await execSqlFile(script);
      if (!outcome.ok) {
        baselineSkip = `failed to apply ${path.basename(script)}: ${outcome.message}`;
        return;
      }
    }
  }, 300_000);

  it("run twice against concrete example data produces identical overlay quantities and ledger entries, and the second run creates nothing (Req 20.2, 20.9, 20.10)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_kitchen uuid; v_core_a uuid; v_core_b uuid;
        v_franchise uuid; v_franchise_clinic uuid;
        v_role uuid; v_actor uuid;
        v_product_valid uuid; v_product_null uuid; v_product_negative uuid;
        v_report1 jsonb; v_report2 jsonb;
        v_overlays_before jsonb; v_ledger_before jsonb;
        v_overlays_after jsonb; v_ledger_after jsonb;
      BEGIN
        -- ── Fixture: two Core Clinics (v_core_a created first, so it is the
        --    Migration_Target_Clinic) plus one excluded franchise-owned clinic.
        INSERT INTO public.kitchens (name) VALUES ('Migration Idempotency Kitchen')
          RETURNING id INTO v_kitchen;

        INSERT INTO public.clinics (name, address, latitude, longitude, kitchen_id, franchise_id)
        VALUES ('Migration Idempotency Core A', 'Fixture address', 12.9716, 77.5946, v_kitchen, NULL)
          RETURNING id INTO v_core_a;

        INSERT INTO public.clinics (name, address, latitude, longitude, kitchen_id, franchise_id)
        VALUES ('Migration Idempotency Core B', 'Fixture address', 12.9716, 77.5946, v_kitchen, NULL)
          RETURNING id INTO v_core_b;

        INSERT INTO public.franchises (name, status)
        VALUES ('Migration Idempotency Franchise', 'active')
          RETURNING id INTO v_franchise;

        INSERT INTO public.clinics (name, address, latitude, longitude, kitchen_id, franchise_id)
        VALUES ('Migration Idempotency Franchise Clinic', 'Fixture address', 12.9716, 77.5946,
                v_kitchen, v_franchise)
          RETURNING id INTO v_franchise_clinic;

        -- ── Fixture: the migration ledger actor (earliest-created MASTER_ADMIN).
        INSERT INTO public.roles (code, name)
        VALUES ('MASTER_ADMIN_MIGRATION_TEST_' || gen_random_uuid(), 'Migration Test Role')
          RETURNING id INTO v_role;

        INSERT INTO public.users (role_id, full_name, email, is_active)
        VALUES (v_role, 'Migration Idempotency Actor',
                'migration-actor-' || gen_random_uuid() || '@example.invalid', true)
          RETURNING id INTO v_actor;

        UPDATE public.roles SET code = 'MASTER_ADMIN' WHERE id = v_role
          AND NOT EXISTS (SELECT 1 FROM public.roles WHERE code = 'MASTER_ADMIN');

        IF NOT EXISTS (
          SELECT 1 FROM public.users u JOIN public.roles r ON r.id = u.role_id
           WHERE r.code IN ('MASTER_ADMIN', 'ADMIN') AND u.is_active IS NOT FALSE
        ) THEN
          RAISE EXCEPTION 'FIXTURE FAILED: no MASTER_ADMIN/ADMIN actor is visible to the migration';
        END IF;

        -- ── Fixture: three concrete, non-deleted Shop Products with the
        --    legacy quantities the task names — a valid value, NULL, and a
        --    negative value.
        INSERT INTO public.products (name, original_price, stock_quantity)
        VALUES ('Migration Idempotency Product Valid', 199.00, 25)
          RETURNING id INTO v_product_valid;

        INSERT INTO public.products (name, original_price, stock_quantity)
        VALUES ('Migration Idempotency Product Null', 149.00, NULL)
          RETURNING id INTO v_product_null;

        INSERT INTO public.products (name, original_price, stock_quantity)
        VALUES ('Migration Idempotency Product Negative', 99.00, -7)
          RETURNING id INTO v_product_negative;

        -- ══════════════════════════════════════════════════════════════════
        -- FIRST RUN
        -- ══════════════════════════════════════════════════════════════════
        SELECT public.migrate_shop_stock_to_clinics() INTO v_report1;

        IF v_report1->>'status' <> 'APPLIED' THEN
          RAISE EXCEPTION 'ASSERTION FAILED: first run status was %, expected APPLIED', v_report1->>'status';
        END IF;
        IF (v_report1->>'target_clinic_id')::uuid <> v_core_a THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: target clinic was %, expected the earliest-created Core Clinic %',
            v_report1->>'target_clinic_id', v_core_a;
        END IF;
        -- 2 Core Clinics x 3 live products = 6 overlay rows created.
        IF (v_report1->>'overlays_created')::int <> 6 THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: first run created % overlay rows, expected 6', v_report1->>'overlays_created';
        END IF;
        -- Only the target clinic's valid product (25 > 0) writes a ledger
        -- entry; the null and negative legacy quantities clamp to 0 and the
        -- non-target clinic always receives 0.
        IF (v_report1->>'ledger_entries_written')::int <> 1 THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: first run wrote % ledger entries, expected 1',
            v_report1->>'ledger_entries_written';
        END IF;

        -- The franchise-owned clinic received no overlay row at all.
        IF EXISTS (SELECT 1 FROM public.clinic_product_settings WHERE clinic_id = v_franchise_clinic) THEN
          RAISE EXCEPTION 'ASSERTION FAILED: the franchise-owned clinic received an overlay row';
        END IF;

        -- Snapshot the resulting overlay and ledger state, in a deterministic
        -- order, restricted to this test's own fixture rows.
        SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.clinic_id, s.product_id), '[]'::jsonb)
          INTO v_overlays_before
          FROM public.clinic_product_settings s
         WHERE s.product_id IN (v_product_valid, v_product_null, v_product_negative);

        SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id), '[]'::jsonb)
          INTO v_ledger_before
          FROM public.clinic_product_ledger l
         WHERE l.product_id IN (v_product_valid, v_product_null, v_product_negative);

        -- ══════════════════════════════════════════════════════════════════
        -- SECOND RUN — the idempotency claim under test
        -- ══════════════════════════════════════════════════════════════════
        SELECT public.migrate_shop_stock_to_clinics() INTO v_report2;

        IF v_report2->>'status' <> 'APPLIED' THEN
          RAISE EXCEPTION 'ASSERTION FAILED: second run status was %, expected APPLIED', v_report2->>'status';
        END IF;
        IF (v_report2->>'overlays_created')::int <> 0 THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: second run created % overlay rows, expected 0',
            v_report2->>'overlays_created';
        END IF;
        IF (v_report2->>'ledger_entries_written')::int <> 0 THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: second run wrote % ledger entries, expected 0',
            v_report2->>'ledger_entries_written';
        END IF;

        SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.clinic_id, s.product_id), '[]'::jsonb)
          INTO v_overlays_after
          FROM public.clinic_product_settings s
         WHERE s.product_id IN (v_product_valid, v_product_null, v_product_negative);

        SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id), '[]'::jsonb)
          INTO v_ledger_after
          FROM public.clinic_product_ledger l
         WHERE l.product_id IN (v_product_valid, v_product_null, v_product_negative);

        -- Byte-for-byte identical: the second run changed nothing.
        IF v_overlays_after IS DISTINCT FROM v_overlays_before THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: overlay rows changed across the second run. before=% after=%',
            v_overlays_before, v_overlays_after;
        END IF;
        IF v_ledger_after IS DISTINCT FROM v_ledger_before THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: ledger rows changed across the second run. before=% after=%',
            v_ledger_before, v_ledger_after;
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  }, 60_000);

  it("a run with zero Core Clinics (only a franchise-owned one) reports NO_CORE_CLINIC and creates nothing at all (Req 20.13)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_kitchen uuid; v_franchise uuid; v_franchise_clinic uuid;
        v_product1 uuid; v_product2 uuid; v_product3 uuid;
        v_report jsonb;
        v_settings_count int; v_ledger_count int;
      BEGIN
        -- No Core Clinic anywhere in this fixture — only a franchise-owned one,
        -- which must never count as a target.
        INSERT INTO public.kitchens (name) VALUES ('No Core Clinic Migration Kitchen')
          RETURNING id INTO v_kitchen;

        INSERT INTO public.franchises (name, status)
        VALUES ('No Core Clinic Migration Franchise', 'active')
          RETURNING id INTO v_franchise;

        INSERT INTO public.clinics (name, address, latitude, longitude, kitchen_id, franchise_id)
        VALUES ('No Core Clinic Migration Franchise Clinic', 'Fixture address', 12.9716, 77.5946,
                v_kitchen, v_franchise)
          RETURNING id INTO v_franchise_clinic;

        INSERT INTO public.products (name, original_price, stock_quantity)
        VALUES ('No Core Clinic Migration Product 1', 199.00, 10) RETURNING id INTO v_product1;
        INSERT INTO public.products (name, original_price, stock_quantity)
        VALUES ('No Core Clinic Migration Product 2', 149.00, NULL) RETURNING id INTO v_product2;
        INSERT INTO public.products (name, original_price, stock_quantity)
        VALUES ('No Core Clinic Migration Product 3', 99.00, -3) RETURNING id INTO v_product3;

        IF EXISTS (SELECT 1 FROM public.clinics WHERE franchise_id IS NULL) THEN
          RAISE EXCEPTION 'FIXTURE FAILED: a Core Clinic exists, this test requires zero';
        END IF;

        SELECT public.migrate_shop_stock_to_clinics() INTO v_report;

        IF v_report->>'status' <> 'NO_CORE_CLINIC' THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: status was %, expected NO_CORE_CLINIC', v_report->>'status';
        END IF;
        IF v_report->>'target_clinic_id' IS NOT NULL THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: target_clinic_id was %, expected null', v_report->>'target_clinic_id';
        END IF;
        IF (v_report->>'overlays_created')::int <> 0 THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: overlays_created was %, expected 0', v_report->>'overlays_created';
        END IF;
        IF (v_report->>'ledger_entries_written')::int <> 0 THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: ledger_entries_written was %, expected 0',
            v_report->>'ledger_entries_written';
        END IF;

        -- Confirmed directly against the tables, not just the report.
        SELECT count(*) INTO v_settings_count FROM public.clinic_product_settings
         WHERE product_id IN (v_product1, v_product2, v_product3);
        SELECT count(*) INTO v_ledger_count FROM public.clinic_product_ledger
         WHERE product_id IN (v_product1, v_product2, v_product3);

        IF v_settings_count <> 0 THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: % clinic_product_settings row(s) were created despite no Core Clinic',
            v_settings_count;
        END IF;
        IF v_ledger_count <> 0 THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: % clinic_product_ledger row(s) were created despite no Core Clinic',
            v_ledger_count;
        END IF;

        -- The franchise-owned clinic itself received no overlay row either.
        IF EXISTS (SELECT 1 FROM public.clinic_product_settings WHERE clinic_id = v_franchise_clinic) THEN
          RAISE EXCEPTION 'ASSERTION FAILED: the franchise-owned clinic received an overlay row';
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  }, 60_000);
});
