/**
 * Feature: clinic-scoped-shop-inventory, Task 1.4 — integration tests for the
 * schema guards installed by the Task 1.1-1.3 migrations.
 *
 * Validates: Requirements 1.10, 1.11, 1.12, 2.9, 8.3, 10.12
 *
 *   1.10  Creating a Shop_Product creates one Clinic_Shop_Stock row per Core
 *         Clinic, at stock 0 and visible, in the SAME transaction.
 *   1.11  Creating a Core Clinic creates one row per non-deleted Shop_Product,
 *         at stock 0 and visible, in the SAME transaction.
 *   1.12  If any of those seed rows fails, the whole transaction rolls back —
 *         no overlay row, no product row, no clinic row.
 *    2.9  Clinic_Shop_Ledger entries are immutable: UPDATE and DELETE both
 *         raise and leave the stored entry untouched.
 *    8.3  A stock increase attempted outside the Stock_In flow is rejected,
 *         leaves the stored quantity unchanged, and records no ledger entry.
 *  10.12  The Order_Clinic_Stamp is immutable once set; NULL -> value is still
 *         permitted so an unstamped legacy row can be back-stamped once.
 *
 * Plus the design's RLS/grant smoke test: an `authenticated` role can SELECT
 * `clinic_product_settings` and cannot mutate `clinic_product_ledger`.
 *
 * The file has two halves, mirroring
 * `src/test/dietitian/migration.integration.test.ts`:
 *
 *   * "script guarantees" — reads the three `scripts/*.sql` files and asserts
 *     the structural properties that install each guard and keep every script
 *     re-runnable. These run everywhere, including CI with no database.
 *
 *   * "live database" — applies the scripts to a scratch Postgres and asserts
 *     the behavioural claims. Each test is one self-contained
 *     `BEGIN ... DO $$ ... $$; ROLLBACK;` script that builds its own fixtures
 *     and asserts inside plpgsql, so nothing is left behind and no ordering
 *     between tests exists. Opt-in via `DIETITIAN_TEST_DATABASE_URL` (the
 *     variable name is historical — it is this repository's single scratch-DB
 *     harness, see `src/test/db/README.md`); skips with a message naming the
 *     missing prerequisite otherwise.
 *
 * The `authenticated` half uses `set_config('role', ...)` rather than real
 * Supabase Auth accounts: the read policy is `USING (true)`, so nothing here
 * depends on `auth.uid()` and the Auth harness would add no coverage.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { DB_URL_ENV, execSql, execSqlFile, harnessSkipReason, queryJson } from "../db/sqlRunner";

// vitest runs with the project root as cwd (see vitest.config.ts).
const REPO_ROOT = process.cwd();
const SETTINGS_SCRIPT = path.join(REPO_ROOT, "scripts", "create-clinic-product-settings-table.sql");
const LEDGER_SCRIPT = path.join(REPO_ROOT, "scripts", "create-clinic-product-ledger-table.sql");
const STAMP_SCRIPT = path.join(REPO_ROOT, "scripts", "add-clinic-stamp-to-addon-orders.sql");

/**
 * Strips `--` line comments so the assertions below only ever look at
 * statements the server actually executes. All three scripts carry their
 * rollback plan in comments, which contains exactly the DROP statements some
 * assertions look for. None of them embeds `--` inside a string literal, so a
 * line-wise strip is sufficient.
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
  return sql.replace(/\s+/g, " ").trim();
}

function matches(sql: string, pattern: RegExp): string[] {
  return [...sql.matchAll(pattern)].map((m) => m[1] ?? m[0]);
}

const SETTINGS_SQL = executableSql(readFileSync(SETTINGS_SCRIPT, "utf8"));
const LEDGER_SQL = executableSql(readFileSync(LEDGER_SCRIPT, "utf8"));
const STAMP_SQL = executableSql(readFileSync(STAMP_SCRIPT, "utf8"));

const SETTINGS_FLAT = normalise(SETTINGS_SQL);
const LEDGER_FLAT = normalise(LEDGER_SQL);
const STAMP_FLAT = normalise(STAMP_SQL);

describe("Clinic shop schema guards — script guarantees", () => {
  describe("backfill triggers (Req 1.10, 1.11, 1.12)", () => {
    it("seeds every Core Clinic on product insert, skipping soft-deleted products", () => {
      expect(SETTINGS_FLAT).toContain(
        "CREATE TRIGGER trg_products_seed_clinic_settings AFTER INSERT ON public.products " +
          "FOR EACH ROW WHEN (NEW.deleted_at IS NULL) " +
          "EXECUTE FUNCTION public.seed_clinic_product_settings_for_product();"
      );
      expect(SETTINGS_FLAT).toContain(
        "SELECT c.id, NEW.id, 0, true FROM public.clinics c WHERE c.franchise_id IS NULL"
      );
    });

    it("seeds every non-deleted product on Core Clinic insert, skipping franchise clinics", () => {
      expect(SETTINGS_FLAT).toContain(
        "CREATE TRIGGER trg_clinics_seed_product_settings AFTER INSERT ON public.clinics " +
          "FOR EACH ROW WHEN (NEW.franchise_id IS NULL) " +
          "EXECUTE FUNCTION public.seed_clinic_product_settings_for_clinic();"
      );
      expect(SETTINGS_FLAT).toContain(
        "SELECT NEW.id, p.id, 0, true FROM public.products p WHERE p.deleted_at IS NULL"
      );
    });

    it("runs the seeding inside the parent insert's transaction, so a failure rolls it back (Req 1.12)", () => {
      // AFTER INSERT row triggers execute in the enclosing statement's
      // transaction: Postgres gives Req 1.12 for free, but only as long as the
      // seeding is a trigger rather than a follow-up application write. Guard
      // against that ever regressing to an AFTER ... DEFERRABLE or a
      // statement-level trigger that could not see NEW.
      for (const trigger of [
        "trg_products_seed_clinic_settings",
        "trg_clinics_seed_product_settings",
      ]) {
        expect(SETTINGS_FLAT).toMatch(
          new RegExp(`CREATE TRIGGER ${trigger} AFTER INSERT ON [\\w.]+ FOR EACH ROW`)
        );
      }
      expect(SETTINGS_FLAT).not.toMatch(/CREATE (?:CONSTRAINT )?TRIGGER[^;]*DEFERRABLE/i);
    });
  });

  describe("stock-increase guard (Req 8.3)", () => {
    it("rejects any raise unless the transaction-local stock-in flag is on", () => {
      expect(SETTINGS_FLAT).toContain(
        "CREATE TRIGGER trg_cps_increase_guard BEFORE UPDATE ON public.clinic_product_settings " +
          "FOR EACH ROW EXECUTE FUNCTION public.enforce_cps_stock_increase_guard();"
      );
      expect(SETTINGS_FLAT).toContain(
        "IF NEW.stock_quantity > OLD.stock_quantity " +
          "AND current_setting('app.clinic_stock_in', true) IS DISTINCT FROM 'on' THEN"
      );
      expect(SETTINGS_FLAT).toContain("CLINIC_STOCK_INCREASE_FORBIDDEN:");
    });
  });

  describe("ledger immutability (Req 2.9)", () => {
    it("blocks UPDATE and DELETE with a BEFORE trigger and revokes both privileges", () => {
      expect(LEDGER_FLAT).toContain(
        "CREATE TRIGGER trg_cpl_append_only BEFORE UPDATE OR DELETE ON public.clinic_product_ledger " +
          "FOR EACH ROW EXECUTE FUNCTION public.reject_clinic_ledger_mutation();"
      );
      expect(LEDGER_FLAT).toContain("CLINIC_STOCK_LEDGER_IMMUTABLE:");
      expect(LEDGER_FLAT).toContain(
        "REVOKE UPDATE, DELETE ON public.clinic_product_ledger FROM authenticated;"
      );
      expect(LEDGER_FLAT).toContain(
        "REVOKE UPDATE, DELETE ON public.clinic_product_ledger FROM anon;"
      );
      // And nothing hands a write privilege back.
      expect(LEDGER_FLAT).not.toMatch(
        /GRANT[^;]*\b(UPDATE|DELETE|ALL)\b[^;]*clinic_product_ledger/i
      );
    });
  });

  describe("order clinic stamp immutability (Req 10.12)", () => {
    it("fires only on an actual re-stamp, leaving NULL -> value permitted", () => {
      expect(STAMP_FLAT).toContain(
        "CREATE TRIGGER trg_addon_orders_clinic_stamp_immutable BEFORE UPDATE ON public.addon_orders " +
          "FOR EACH ROW WHEN (OLD.clinic_id IS NOT NULL AND NEW.clinic_id IS DISTINCT FROM OLD.clinic_id) " +
          "EXECUTE FUNCTION public.reject_addon_order_clinic_restamp();"
      );
      expect(STAMP_FLAT).toContain("CLINIC_STAMP_IMMUTABLE:");
    });
  });

  describe("RLS and grants on the overlay table (Req 8.3 read path)", () => {
    it("enables RLS, grants only SELECT to authenticated, and installs the read policy", () => {
      expect(SETTINGS_FLAT).toContain(
        "ALTER TABLE public.clinic_product_settings ENABLE ROW LEVEL SECURITY;"
      );
      expect(SETTINGS_FLAT).toContain(
        "GRANT SELECT ON public.clinic_product_settings TO authenticated;"
      );
      expect(SETTINGS_FLAT).toContain(
        'CREATE POLICY "cps_read_authenticated" ON public.clinic_product_settings FOR SELECT ' +
          "TO authenticated USING (true);"
      );
      const grants = matches(SETTINGS_FLAT, /GRANT ([^;]*?) ON public\.clinic_product_settings/gi);
      expect(grants.length).toBeGreaterThanOrEqual(1);
      for (const grant of grants) {
        expect(grant.toUpperCase()).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALL)\b/);
      }
    });
  });

  describe("all three scripts are re-runnable", () => {
    it.each([
      ["create-clinic-product-settings-table.sql", SETTINGS_SQL],
      ["create-clinic-product-ledger-table.sql", LEDGER_SQL],
      ["add-clinic-stamp-to-addon-orders.sql", STAMP_SQL],
    ])("%s guards every create with IF NOT EXISTS / OR REPLACE / DROP IF EXISTS", (_name, sql) => {
      expect(sql).not.toMatch(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i);
      expect(sql).not.toMatch(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/i);
      expect(sql).not.toMatch(/ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/i);
      expect(sql).not.toMatch(/CREATE\s+FUNCTION\s/i);

      for (const trigger of matches(sql, /CREATE\s+TRIGGER\s+(\w+)/gi)) {
        expect(sql).toMatch(new RegExp(`DROP\\s+TRIGGER\\s+IF\\s+EXISTS\\s+${trigger}\\b`, "i"));
      }
      for (const policy of matches(sql, /CREATE\s+POLICY\s+"?(\w+)"?/gi)) {
        expect(sql).toMatch(new RegExp(`DROP\\s+POLICY\\s+IF\\s+EXISTS\\s+"?${policy}"?`, "i"));
      }
      // Both enum types are created behind a pg_type existence guard.
      for (const type of matches(sql, /CREATE\s+TYPE\s+(\w+)/gi)) {
        expect(sql).toMatch(new RegExp(`pg_type WHERE typname = '${type}'`, "i"));
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Live database half
// ---------------------------------------------------------------------------

/** Pre-feature tables the three scripts extend or reference. */
const BASELINE_TABLES = [
  "clinics",
  "kitchens",
  "products",
  "users",
  "addon_orders",
  "inventory_transactions",
];

/**
 * Fixture preamble shared by the behavioural tests: one kitchen, two Core
 * Clinics, and one franchise-owned Clinic (the row every Core-only guard must
 * exclude). Declared as plpgsql statements so each test can compose it into its
 * own DO block.
 */
const FIXTURE_CLINICS = `
  INSERT INTO public.kitchens (name) VALUES ('CPS Guard Kitchen')
    RETURNING id INTO v_kitchen;

  INSERT INTO public.clinics (name, address, latitude, longitude, kitchen_id, franchise_id)
  VALUES ('CPS Guard Core A', 'Fixture address', 12.9716, 77.5946, v_kitchen, NULL)
    RETURNING id INTO v_core_a;

  INSERT INTO public.clinics (name, address, latitude, longitude, kitchen_id, franchise_id)
  VALUES ('CPS Guard Core B', 'Fixture address', 12.9716, 77.5946, v_kitchen, NULL)
    RETURNING id INTO v_core_b;

  INSERT INTO public.franchises (name, status) VALUES ('CPS Guard Franchise', 'active')
    RETURNING id INTO v_franchise;

  INSERT INTO public.clinics (name, address, latitude, longitude, kitchen_id, franchise_id)
  VALUES ('CPS Guard Franchise Clinic', 'Fixture address', 12.9716, 77.5946, v_kitchen, v_franchise)
    RETURNING id INTO v_franchise_clinic;
`;

const harnessSkip = harnessSkipReason();
const suiteName = harnessSkip
  ? `Clinic shop schema guards against a live database — SKIPPED (${harnessSkip})`
  : "Clinic shop schema guards against a live database";

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

    // Applied in dependency order: the ledger's OUT entries reference
    // addon_orders, and both clinic tables reference clinics/products.
    for (const script of [STAMP_SCRIPT, SETTINGS_SCRIPT, LEDGER_SCRIPT]) {
      const outcome = await execSqlFile(script);
      if (!outcome.ok) {
        baselineSkip = `failed to apply ${path.basename(script)}: ${outcome.message}`;
        return;
      }
    }
  }, 300_000);

  it("creates one overlay row per Core Clinic when a Shop_Product is inserted (Req 1.10)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_kitchen uuid; v_core_a uuid; v_core_b uuid;
        v_franchise uuid; v_franchise_clinic uuid;
        v_product uuid; v_deleted_product uuid;
        v_core_clinics int; v_rows int;
      BEGIN
        ${FIXTURE_CLINICS}

        SELECT count(*) INTO v_core_clinics FROM public.clinics WHERE franchise_id IS NULL;

        INSERT INTO public.products (name, original_price)
        VALUES ('CPS Guard Probe Product', 199.00) RETURNING id INTO v_product;

        -- Exactly one row per Core Clinic, no more and no fewer.
        SELECT count(*) INTO v_rows
          FROM public.clinic_product_settings WHERE product_id = v_product;
        IF v_rows <> v_core_clinics THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: expected % overlay rows (one per Core Clinic), found %',
            v_core_clinics, v_rows;
        END IF;

        -- Both fixture Core Clinics are covered.
        IF NOT EXISTS (SELECT 1 FROM public.clinic_product_settings
                        WHERE product_id = v_product AND clinic_id = v_core_a)
           OR NOT EXISTS (SELECT 1 FROM public.clinic_product_settings
                        WHERE product_id = v_product AND clinic_id = v_core_b) THEN
          RAISE EXCEPTION 'ASSERTION FAILED: a fixture Core Clinic received no overlay row';
        END IF;

        -- Every seeded row starts at 0 and visible.
        IF EXISTS (SELECT 1 FROM public.clinic_product_settings
                    WHERE product_id = v_product
                      AND (stock_quantity <> 0 OR is_visible IS NOT TRUE)) THEN
          RAISE EXCEPTION 'ASSERTION FAILED: a seeded overlay row was not (0, visible)';
        END IF;

        -- The franchise-owned Clinic is excluded (Req 1.9).
        IF EXISTS (SELECT 1 FROM public.clinic_product_settings
                    WHERE product_id = v_product AND clinic_id = v_franchise_clinic) THEN
          RAISE EXCEPTION 'ASSERTION FAILED: a franchise clinic received an overlay row';
        END IF;

        -- A product inserted already soft-deleted seeds nothing.
        INSERT INTO public.products (name, original_price, deleted_at)
        VALUES ('CPS Guard Deleted Product', 199.00, now()) RETURNING id INTO v_deleted_product;

        IF EXISTS (SELECT 1 FROM public.clinic_product_settings
                    WHERE product_id = v_deleted_product) THEN
          RAISE EXCEPTION 'ASSERTION FAILED: a soft-deleted product received overlay rows';
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  }, 60_000);

  it("creates one overlay row per non-deleted Shop_Product when a Core Clinic is inserted (Req 1.11)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_kitchen uuid; v_core_a uuid; v_core_b uuid;
        v_franchise uuid; v_franchise_clinic uuid;
        v_live_product uuid; v_deleted_product uuid;
        v_new_clinic uuid; v_new_franchise_clinic uuid;
        v_live_products int; v_rows int;
      BEGIN
        ${FIXTURE_CLINICS}

        INSERT INTO public.products (name, original_price)
        VALUES ('CPS Guard Live Product', 149.00) RETURNING id INTO v_live_product;

        INSERT INTO public.products (name, original_price, deleted_at)
        VALUES ('CPS Guard Retired Product', 149.00, now()) RETURNING id INTO v_deleted_product;

        SELECT count(*) INTO v_live_products FROM public.products WHERE deleted_at IS NULL;

        INSERT INTO public.clinics (name, address, latitude, longitude, kitchen_id, franchise_id)
        VALUES ('CPS Guard Core C', 'Fixture address', 12.9716, 77.5946, v_kitchen, NULL)
          RETURNING id INTO v_new_clinic;

        SELECT count(*) INTO v_rows
          FROM public.clinic_product_settings WHERE clinic_id = v_new_clinic;
        IF v_rows <> v_live_products THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: expected % overlay rows (one per non-deleted product), found %',
            v_live_products, v_rows;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM public.clinic_product_settings
                        WHERE clinic_id = v_new_clinic AND product_id = v_live_product) THEN
          RAISE EXCEPTION 'ASSERTION FAILED: the live product received no overlay row';
        END IF;

        IF EXISTS (SELECT 1 FROM public.clinic_product_settings
                    WHERE clinic_id = v_new_clinic AND product_id = v_deleted_product) THEN
          RAISE EXCEPTION 'ASSERTION FAILED: a soft-deleted product received an overlay row';
        END IF;

        IF EXISTS (SELECT 1 FROM public.clinic_product_settings
                    WHERE clinic_id = v_new_clinic
                      AND (stock_quantity <> 0 OR is_visible IS NOT TRUE)) THEN
          RAISE EXCEPTION 'ASSERTION FAILED: a seeded overlay row was not (0, visible)';
        END IF;

        -- A franchise-owned Clinic seeds nothing at all.
        INSERT INTO public.clinics (name, address, latitude, longitude, kitchen_id, franchise_id)
        VALUES ('CPS Guard Franchise Clinic 2', 'Fixture address', 12.9716, 77.5946,
                v_kitchen, v_franchise)
          RETURNING id INTO v_new_franchise_clinic;

        IF EXISTS (SELECT 1 FROM public.clinic_product_settings
                    WHERE clinic_id = v_new_franchise_clinic) THEN
          RAISE EXCEPTION 'ASSERTION FAILED: a franchise clinic insert seeded overlay rows';
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  }, 60_000);

  it("rolls the parent insert back when a backfill trigger fails (Req 1.12)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    // Both seed functions are replaced with raising stubs for the duration of
    // this transaction. The DDL is rolled back with everything else, so the real
    // functions are restored the moment the script finishes.
    //
    // The kitchen/clinic fixture is created FIRST, while the real seed functions
    // are still installed — the stubs raise unconditionally, so a fixture insert
    // made after them would fail on the fixture rather than on the assertion.
    // That forces literal ids here instead of the shared DO-block fixture.
    const outcome = await execSql(`
      BEGIN;

      INSERT INTO public.kitchens (id, name)
      VALUES ('4a1f0000-0000-4000-8000-000000000001', 'CPS Guard Rollback Kitchen');

      INSERT INTO public.clinics (id, name, address, latitude, longitude, kitchen_id, franchise_id)
      VALUES ('4a1f0000-0000-4000-8000-000000000002', 'CPS Guard Rollback Core',
              'Fixture address', 12.9716, 77.5946,
              '4a1f0000-0000-4000-8000-000000000001', NULL);

      CREATE OR REPLACE FUNCTION public.seed_clinic_product_settings_for_product()
      RETURNS TRIGGER LANGUAGE plpgsql AS $stub_product$
      BEGIN
        RAISE EXCEPTION 'FORCED_SEED_FAILURE: injected by the schema-guard integration test';
      END;
      $stub_product$;

      CREATE OR REPLACE FUNCTION public.seed_clinic_product_settings_for_clinic()
      RETURNS TRIGGER LANGUAGE plpgsql AS $stub_clinic$
      BEGIN
        RAISE EXCEPTION 'FORCED_SEED_FAILURE: injected by the schema-guard integration test';
      END;
      $stub_clinic$;

      DO $do$
      DECLARE
        v_kitchen uuid := '4a1f0000-0000-4000-8000-000000000001';
        v_product uuid := gen_random_uuid();
        v_clinic uuid := gen_random_uuid();
        v_overlays_before int;
      BEGIN
        SELECT count(*) INTO v_overlays_before FROM public.clinic_product_settings;

        -- Product insert: the failing trigger must abort the insert itself.
        BEGIN
          INSERT INTO public.products (id, name, original_price)
          VALUES (v_product, 'CPS Guard Rollback Product', 99.00);
          RAISE EXCEPTION 'ASSERTION FAILED: the product insert survived a failing seed trigger';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM NOT LIKE 'FORCED_SEED_FAILURE:%' THEN RAISE; END IF;
        END;

        IF EXISTS (SELECT 1 FROM public.products WHERE id = v_product) THEN
          RAISE EXCEPTION 'ASSERTION FAILED: the product row was not rolled back';
        END IF;
        IF EXISTS (SELECT 1 FROM public.clinic_product_settings WHERE product_id = v_product) THEN
          RAISE EXCEPTION 'ASSERTION FAILED: overlay rows survived the rolled-back product insert';
        END IF;

        -- Core Clinic insert: same guarantee from the other side.
        BEGIN
          INSERT INTO public.clinics (id, name, address, latitude, longitude, kitchen_id, franchise_id)
          VALUES (v_clinic, 'CPS Guard Rollback Clinic', 'Fixture address',
                  12.9716, 77.5946, v_kitchen, NULL);
          RAISE EXCEPTION 'ASSERTION FAILED: the clinic insert survived a failing seed trigger';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM NOT LIKE 'FORCED_SEED_FAILURE:%' THEN RAISE; END IF;
        END;

        IF EXISTS (SELECT 1 FROM public.clinics WHERE id = v_clinic) THEN
          RAISE EXCEPTION 'ASSERTION FAILED: the clinic row was not rolled back';
        END IF;
        IF EXISTS (SELECT 1 FROM public.clinic_product_settings WHERE clinic_id = v_clinic) THEN
          RAISE EXCEPTION 'ASSERTION FAILED: overlay rows survived the rolled-back clinic insert';
        END IF;

        IF (SELECT count(*) FROM public.clinic_product_settings) <> v_overlays_before THEN
          RAISE EXCEPTION 'ASSERTION FAILED: the overlay table changed across two failed inserts';
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  }, 60_000);

  it("rejects a stock increase attempted outside the stock-in flow (Req 8.3)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_kitchen uuid; v_core_a uuid; v_core_b uuid;
        v_franchise uuid; v_franchise_clinic uuid;
        v_product uuid; v_stock int;
      BEGIN
        ${FIXTURE_CLINICS}

        INSERT INTO public.products (name, original_price)
        VALUES ('CPS Guard Increase Product', 249.00) RETURNING id INTO v_product;

        -- A direct raise, with no stock-in flag, is refused.
        BEGIN
          UPDATE public.clinic_product_settings SET stock_quantity = 5
           WHERE clinic_id = v_core_a AND product_id = v_product;
          RAISE EXCEPTION 'ASSERTION FAILED: a direct stock increase was accepted';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM NOT LIKE 'CLINIC_STOCK_INCREASE_FORBIDDEN:%' THEN RAISE; END IF;
        END;

        SELECT stock_quantity INTO v_stock FROM public.clinic_product_settings
         WHERE clinic_id = v_core_a AND product_id = v_product;
        IF v_stock <> 0 THEN
          RAISE EXCEPTION 'ASSERTION FAILED: stock_quantity moved to % after a rejected raise', v_stock;
        END IF;
        IF EXISTS (SELECT 1 FROM public.clinic_product_ledger
                    WHERE clinic_id = v_core_a AND product_id = v_product) THEN
          RAISE EXCEPTION 'ASSERTION FAILED: a rejected raise recorded a ledger entry';
        END IF;

        -- The guard is a gate, not a ban: with the flag on, the raise lands.
        PERFORM set_config('app.clinic_stock_in', 'on', true);
        UPDATE public.clinic_product_settings SET stock_quantity = 5
         WHERE clinic_id = v_core_a AND product_id = v_product;
        PERFORM set_config('app.clinic_stock_in', 'off', true);

        SELECT stock_quantity INTO v_stock FROM public.clinic_product_settings
         WHERE clinic_id = v_core_a AND product_id = v_product;
        IF v_stock <> 5 THEN
          RAISE EXCEPTION 'ASSERTION FAILED: a flagged stock-in left stock at %', v_stock;
        END IF;

        -- A decrease (a sale) never needs the flag.
        UPDATE public.clinic_product_settings SET stock_quantity = 2
         WHERE clinic_id = v_core_a AND product_id = v_product;

        SELECT stock_quantity INTO v_stock FROM public.clinic_product_settings
         WHERE clinic_id = v_core_a AND product_id = v_product;
        IF v_stock <> 2 THEN
          RAISE EXCEPTION 'ASSERTION FAILED: an unflagged decrease left stock at %', v_stock;
        END IF;

        -- And the very next raise, with the flag off again, is refused.
        BEGIN
          UPDATE public.clinic_product_settings SET stock_quantity = 3
           WHERE clinic_id = v_core_a AND product_id = v_product;
          RAISE EXCEPTION 'ASSERTION FAILED: a stock increase was accepted after the flag was cleared';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM NOT LIKE 'CLINIC_STOCK_INCREASE_FORBIDDEN:%' THEN RAISE; END IF;
        END;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  }, 60_000);

  it("raises on UPDATE and DELETE of a clinic ledger entry (Req 2.9)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_kitchen uuid; v_core_a uuid; v_core_b uuid;
        v_franchise uuid; v_franchise_clinic uuid;
        v_product uuid; v_actor uuid; v_entry bigint;
      BEGIN
        ${FIXTURE_CLINICS}

        INSERT INTO public.products (name, original_price)
        VALUES ('CPS Guard Ledger Product', 349.00) RETURNING id INTO v_product;

        INSERT INTO public.users (full_name, email)
        VALUES ('CPS Guard Actor', 'cps-guard-' || gen_random_uuid() || '@example.invalid')
          RETURNING id INTO v_actor;

        -- MIGRATION carries neither reference, so this needs no order or
        -- warehouse transaction fixture (Req 2.12).
        INSERT INTO public.clinic_product_ledger
          (clinic_id, product_id, direction, quantity, movement_source, actor_user_id)
        VALUES (v_core_a, v_product, 'IN', 7, 'MIGRATION', v_actor)
          RETURNING id INTO v_entry;

        BEGIN
          UPDATE public.clinic_product_ledger SET quantity = 8 WHERE id = v_entry;
          RAISE EXCEPTION 'ASSERTION FAILED: UPDATE on clinic_product_ledger succeeded';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM NOT LIKE 'CLINIC_STOCK_LEDGER_IMMUTABLE:%' THEN RAISE; END IF;
        END;

        BEGIN
          DELETE FROM public.clinic_product_ledger WHERE id = v_entry;
          RAISE EXCEPTION 'ASSERTION FAILED: DELETE on clinic_product_ledger succeeded';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM NOT LIKE 'CLINIC_STOCK_LEDGER_IMMUTABLE:%' THEN RAISE; END IF;
        END;

        -- The entry survived both attempts, byte for byte.
        IF NOT EXISTS (SELECT 1 FROM public.clinic_product_ledger
                        WHERE id = v_entry AND clinic_id = v_core_a AND product_id = v_product
                          AND direction = 'IN' AND quantity = 7
                          AND movement_source = 'MIGRATION' AND actor_user_id = v_actor) THEN
          RAISE EXCEPTION 'ASSERTION FAILED: the ledger entry was mutated or removed';
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  }, 60_000);

  it("permits NULL -> value on the order clinic stamp and rejects every later change (Req 10.12)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_kitchen uuid; v_core_a uuid; v_core_b uuid;
        v_franchise uuid; v_franchise_clinic uuid;
        v_order uuid; v_stamped uuid;
      BEGIN
        ${FIXTURE_CLINICS}

        -- addon_orders_buyer_identity_check demands a customer or a walk-in name.
        INSERT INTO public.addon_orders (total_amount, target_delivery_date, walkin_name)
        VALUES (500.00, current_date, 'CPS Guard Walk-in') RETURNING id INTO v_order;

        -- NULL -> value: the one permitted transition (back-stamp migration).
        UPDATE public.addon_orders SET clinic_id = v_core_a WHERE id = v_order;

        -- Re-writing the SAME value is not a change, so the guard stays quiet.
        UPDATE public.addon_orders SET clinic_id = v_core_a WHERE id = v_order;

        -- value -> other value is refused.
        BEGIN
          UPDATE public.addon_orders SET clinic_id = v_core_b WHERE id = v_order;
          RAISE EXCEPTION 'ASSERTION FAILED: the clinic stamp was re-pointed at another clinic';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM NOT LIKE 'CLINIC_STAMP_IMMUTABLE:%' THEN RAISE; END IF;
        END;

        -- value -> NULL is refused too.
        BEGIN
          UPDATE public.addon_orders SET clinic_id = NULL WHERE id = v_order;
          RAISE EXCEPTION 'ASSERTION FAILED: the clinic stamp was cleared';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM NOT LIKE 'CLINIC_STAMP_IMMUTABLE:%' THEN RAISE; END IF;
        END;

        SELECT clinic_id INTO v_stamped FROM public.addon_orders WHERE id = v_order;
        IF v_stamped IS DISTINCT FROM v_core_a THEN
          RAISE EXCEPTION 'ASSERTION FAILED: the stamp is now % rather than the original clinic',
            COALESCE(v_stamped::text, 'NULL');
        END IF;

        -- An unrelated column update on a stamped order is unaffected.
        UPDATE public.addon_orders SET status = 'PAID' WHERE id = v_order;

        -- And stamping at creation time is allowed outright.
        INSERT INTO public.addon_orders (total_amount, target_delivery_date, walkin_name, clinic_id)
        VALUES (250.00, current_date, 'CPS Guard Walk-in 2', v_core_b);
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  }, 60_000);

  it("lets an authenticated role read the overlay table and never mutate the ledger (RLS smoke, Req 2.9, 8.3)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_kitchen uuid; v_core_a uuid; v_core_b uuid;
        v_franchise uuid; v_franchise_clinic uuid;
        v_product uuid; v_actor uuid; v_entry bigint;
        v_visible int; v_has_role boolean;
      BEGIN
        SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') INTO v_has_role;
        IF NOT v_has_role THEN
          RAISE NOTICE 'the authenticated role is absent (not a Supabase database); RLS smoke skipped';
          RETURN;
        END IF;

        ${FIXTURE_CLINICS}

        INSERT INTO public.products (name, original_price)
        VALUES ('CPS Guard RLS Product', 449.00) RETURNING id INTO v_product;

        INSERT INTO public.users (full_name, email)
        VALUES ('CPS Guard RLS Actor', 'cps-rls-' || gen_random_uuid() || '@example.invalid')
          RETURNING id INTO v_actor;

        INSERT INTO public.clinic_product_ledger
          (clinic_id, product_id, direction, quantity, movement_source, actor_user_id)
        VALUES (v_core_a, v_product, 'IN', 3, 'MIGRATION', v_actor)
          RETURNING id INTO v_entry;

        -- ── As authenticated ────────────────────────────────────────────────
        PERFORM set_config('role', 'authenticated', true);

        -- SELECT works: base GRANT plus the USING (true) read policy.
        SELECT count(*) INTO v_visible
          FROM public.clinic_product_settings WHERE product_id = v_product;
        IF v_visible < 1 THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: an authenticated role read % overlay rows for a seeded product',
            v_visible;
        END IF;

        -- Ledger mutation: refused by the missing privilege (the REVOKE layer).
        BEGIN
          UPDATE public.clinic_product_ledger SET quantity = 4 WHERE id = v_entry;
          PERFORM set_config('role', 'none', true);
          RAISE EXCEPTION 'ASSERTION FAILED: an authenticated role updated the ledger';
        EXCEPTION
          WHEN insufficient_privilege THEN NULL;
          WHEN raise_exception THEN
            IF SQLERRM NOT LIKE 'CLINIC_STOCK_LEDGER_IMMUTABLE:%' THEN RAISE; END IF;
        END;

        PERFORM set_config('role', 'authenticated', true);
        BEGIN
          DELETE FROM public.clinic_product_ledger WHERE id = v_entry;
          PERFORM set_config('role', 'none', true);
          RAISE EXCEPTION 'ASSERTION FAILED: an authenticated role deleted a ledger entry';
        EXCEPTION
          WHEN insufficient_privilege THEN NULL;
          WHEN raise_exception THEN
            IF SQLERRM NOT LIKE 'CLINIC_STOCK_LEDGER_IMMUTABLE:%' THEN RAISE; END IF;
        END;

        -- Now grant both privileges (rolled back with the transaction) so the
        -- attempt reaches the trigger instead of stopping at the privilege
        -- check. Req 2.9 is about the trigger being the load-bearing guard.
        PERFORM set_config('role', 'none', true);
        EXECUTE 'GRANT UPDATE, DELETE, SELECT ON public.clinic_product_ledger TO authenticated';
        PERFORM set_config('role', 'authenticated', true);

        BEGIN
          UPDATE public.clinic_product_ledger SET quantity = 4 WHERE id = v_entry;
          PERFORM set_config('role', 'none', true);
          RAISE EXCEPTION
            'ASSERTION FAILED: a privileged authenticated role updated the ledger';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM NOT LIKE 'CLINIC_STOCK_LEDGER_IMMUTABLE:%' THEN RAISE; END IF;
        END;

        PERFORM set_config('role', 'authenticated', true);
        BEGIN
          DELETE FROM public.clinic_product_ledger WHERE id = v_entry;
          PERFORM set_config('role', 'none', true);
          RAISE EXCEPTION
            'ASSERTION FAILED: a privileged authenticated role deleted a ledger entry';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM NOT LIKE 'CLINIC_STOCK_LEDGER_IMMUTABLE:%' THEN RAISE; END IF;
        END;

        PERFORM set_config('role', 'none', true);

        IF NOT EXISTS (SELECT 1 FROM public.clinic_product_ledger
                        WHERE id = v_entry AND quantity = 3) THEN
          RAISE EXCEPTION 'ASSERTION FAILED: the ledger entry did not survive the attempts';
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  }, 60_000);
});
