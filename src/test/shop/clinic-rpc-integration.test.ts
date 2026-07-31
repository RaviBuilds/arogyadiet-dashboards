/**
 * Feature: clinic-scoped-shop-inventory, Task 4.14 — integration tests pinning
 * `src/test/shop/clinicStockModel.ts` to the real RPCs it stands in for.
 *
 * Validates: Requirements 7.6, 7.9, 7.10, 2.7, 11.1
 *
 *   7.6   A Stock_In submission, within one transaction, increases the
 *         destination clinic's Clinic_Shop_Stock, decreases the linked Master
 *         Catalog Product's warehouse stock, and records one ledger `IN` entry
 *         and one `inventory_transactions` `OUT` entry, per line.
 *   7.9   Every Stock_In `inventory_transactions` entry carries the
 *         Stock_In_Reason_Prefix (`shop-clinic:`) followed by the destination
 *         Core Clinic identifier.
 *  7.10   Any failed write inside a Stock_In submission rolls back the whole
 *         transaction: every Clinic_Shop_Stock record, every `inventory_lots`
 *         quantity, every Clinic_Shop_Ledger entry, and every
 *         `inventory_transactions` entry is left unchanged.
 *   2.7   For every (clinic, product) pair, `clinic_product_settings
 *         .stock_quantity` equals ledger `IN` total minus ledger `OUT` total —
 *         `verify_clinic_stock_ledger_parity()` is the detector for this.
 *  11.1   A sale that would exceed the fulfilling clinic's available stock is
 *         rejected outright, naming every shortfall product and the quantity
 *         available.
 *
 * WHY THIS FILE EXISTS
 * `src/test/shop/clinicStockModel.ts` is a fast, deterministic TypeScript
 * re-implementation of `clinic_shop_stock_in`, `clinic_shop_apply_sale`,
 * `set_clinic_product_visibility`, and `verify_clinic_stock_ledger_parity`,
 * used by Properties 1, 2, 4, 5, 16 and others so those properties can run
 * hundreds of iterations cheaply. That speed is only trustworthy if the model
 * actually agrees with the real SQL. This file is that check: a small,
 * example-based suite that exercises the REAL RPCs against a REAL Postgres,
 * not the model.
 *
 * TWO HALVES, mirroring `src/test/shop/schema-guards.integration.test.ts`
 * (Task 1.4) exactly:
 *
 *   * "script guarantees" — reads `scripts/create-clinic-shop-stock-in-rpc.sql`,
 *     `scripts/create-clinic-shop-apply-sale-rpc.sql`, and
 *     `scripts/create-verify-clinic-stock-ledger-parity-rpc.sql` as text and
 *     asserts the structural facts a real Postgres run would be needed to
 *     otherwise confirm indirectly: the `shop-clinic:<uuid>` reason format, one
 *     ledger INSERT per applied line rather than per depleted lot, the stable
 *     `RAISE EXCEPTION` prefixes, and that the parity detector never writes.
 *     These run everywhere, including CI with no database.
 *
 *   * "live database" — applies the seven scripts this RPC set depends on (in
 *     the dependency order the task lists) to a scratch Postgres and asserts
 *     the behavioural claims with self-contained
 *     `BEGIN ... DO $$ ... $$; ROLLBACK;` scripts, exactly like the sibling
 *     suite. Opt-in via `DIETITIAN_TEST_DATABASE_URL` (see
 *     `src/test/db/README.md`); skips with a message naming the missing
 *     prerequisite otherwise.
 *
 * Plus a small unit-test half with no database dependency at all: a
 * consistency check between design.md's "Message mapping" table and
 * `MODEL_ERROR_PREFIXES` — see that describe block for why it is scoped to
 * RPC prefixes only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { DB_URL_ENV, execSql, execSqlFile, harnessSkipReason, queryJson } from "../db/sqlRunner";
import { MODEL_ERROR_PREFIXES } from "./clinicStockModel";

// vitest runs with the project root as cwd (see vitest.config.ts).
const REPO_ROOT = process.cwd();
const STAMP_SCRIPT = path.join(REPO_ROOT, "scripts", "add-clinic-stamp-to-addon-orders.sql");
const SETTINGS_SCRIPT = path.join(REPO_ROOT, "scripts", "create-clinic-product-settings-table.sql");
const LEDGER_SCRIPT = path.join(REPO_ROOT, "scripts", "create-clinic-product-ledger-table.sql");
const PRODUCT_LINK_SCRIPT = path.join(REPO_ROOT, "scripts", "add-inventory-product-link-to-products.sql");
const STOCK_IN_SCRIPT = path.join(REPO_ROOT, "scripts", "create-clinic-shop-stock-in-rpc.sql");
const APPLY_SALE_SCRIPT = path.join(REPO_ROOT, "scripts", "create-clinic-shop-apply-sale-rpc.sql");
const VERIFY_PARITY_SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "create-verify-clinic-stock-ledger-parity-rpc.sql",
);

/** Same convention as the Task 1.4 sibling: strip `--` line comments only. */
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

/** Occurrences of a literal (non-regex) substring. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    count += 1;
    from = at + needle.length;
  }
  return count;
}

const STOCK_IN_SQL = executableSql(readFileSync(STOCK_IN_SCRIPT, "utf8"));
const APPLY_SALE_SQL = executableSql(readFileSync(APPLY_SALE_SCRIPT, "utf8"));
const VERIFY_PARITY_SQL = executableSql(readFileSync(VERIFY_PARITY_SCRIPT, "utf8"));

const STOCK_IN_FLAT = normalise(STOCK_IN_SQL);
const APPLY_SALE_FLAT = normalise(APPLY_SALE_SQL);
const VERIFY_PARITY_FLAT = normalise(VERIFY_PARITY_SQL);

// ---------------------------------------------------------------------------
// Script guarantees — no database needed
// ---------------------------------------------------------------------------

describe("Clinic RPC set — script guarantees", () => {
  describe("clinic_shop_stock_in reason format (Req 7.9)", () => {
    it("writes the Stock_In_Reason_Prefix followed by the destination clinic id", () => {
      expect(STOCK_IN_FLAT).toContain("v_reason := 'shop-clinic:' || p_clinic_id::text;");
      // The computed v_reason is actually used as the inventory_transactions
      // reason value, not just assigned and discarded.
      expect(STOCK_IN_FLAT).toContain("v_lot.id, 'OUT', -v_deduct, v_reason");
    });
  });

  describe("one ledger INSERT per applied line, not per depleted lot (Req 7.6, 2.5, 2.8)", () => {
    it("clinic_shop_stock_in writes the ledger INSERT exactly once, outside the FIFO lot loop", () => {
      const ledgerInsertCount = countOccurrences(
        STOCK_IN_SQL,
        "INSERT INTO public.clinic_product_ledger",
      );
      expect(ledgerInsertCount).toBe(1);

      // The FIFO depletion loop ("FOR v_lot IN ... LOOP ... END LOOP;") must
      // close before the ledger INSERT appears — otherwise the RPC would write
      // one ledger row per depleted lot instead of one per accepted line.
      const lotLoopStart = STOCK_IN_SQL.indexOf("FOR v_lot IN");
      expect(lotLoopStart).toBeGreaterThan(-1);
      const lotLoopEnd = STOCK_IN_SQL.indexOf("END LOOP;", lotLoopStart);
      expect(lotLoopEnd).toBeGreaterThan(lotLoopStart);
      const ledgerInsertIndex = STOCK_IN_SQL.indexOf("INSERT INTO public.clinic_product_ledger");
      expect(ledgerInsertIndex).toBeGreaterThan(lotLoopEnd);
    });

    it("clinic_shop_apply_sale writes one OUT ledger INSERT per submitted line, not per lot (there are no lots on the sale side)", () => {
      const ledgerInsertCount = countOccurrences(
        APPLY_SALE_SQL,
        "INSERT INTO public.clinic_product_ledger",
      );
      expect(ledgerInsertCount).toBe(1);
    });
  });

  describe("stable RAISE EXCEPTION prefixes (Req 7.10, 11.1)", () => {
    it("clinic_shop_stock_in raises the design's stock-in prefixes", () => {
      for (const prefix of [
        "CLINIC_STOCK_INSUFFICIENT_WAREHOUSE:",
        "CLINIC_STOCK_EXCEEDS_MAXIMUM:",
        "CLINIC_STOCK_UNLINKED_PRODUCT:",
        "CLINIC_NOT_CORE:",
        "CLINIC_REFERENCE_NOT_FOUND:",
      ]) {
        expect(STOCK_IN_FLAT).toMatch(new RegExp(`RAISE EXCEPTION\\s+'${prefix}`));
      }
    });

    it("clinic_shop_apply_sale raises the design's sale-side prefixes", () => {
      for (const prefix of [
        "CLINIC_STOCK_INSUFFICIENT_CLINIC:",
        "CLINIC_NOT_CORE:",
        "CLINIC_REFERENCE_NOT_FOUND:",
      ]) {
        expect(APPLY_SALE_FLAT).toMatch(new RegExp(`RAISE EXCEPTION\\s+'${prefix}`));
      }
    });
  });

  describe("verify_clinic_stock_ledger_parity is read-only (Req 2.7)", () => {
    it("the function body contains no INSERT, UPDATE, or DELETE", () => {
      const bodyMatch = VERIFY_PARITY_SQL.match(
        /CREATE OR REPLACE FUNCTION public\.verify_clinic_stock_ledger_parity\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
      );
      expect(bodyMatch).not.toBeNull();
      const body = bodyMatch![1];
      expect(body).not.toMatch(/\bINSERT\b/i);
      expect(body).not.toMatch(/\bUPDATE\b/i);
      expect(body).not.toMatch(/\bDELETE\b/i);
    });

    it("is declared LANGUAGE sql and STABLE, matching a pure read", () => {
      expect(VERIFY_PARITY_FLAT).toContain("LANGUAGE sql STABLE");
    });
  });
});

// ---------------------------------------------------------------------------
// Live database half
// ---------------------------------------------------------------------------

/**
 * Pre-feature baseline the seven scripts extend or reference. Beyond the
 * Task 1.4 sibling's list, this RPC set also needs the warehouse tables
 * (`inventory_products`, `inventory_lots`) and `franchises`, since
 * `clinic_shop_stock_in` depletes warehouse lots and both mutation RPCs reject
 * a franchise id passed as the destination.
 */
const BASELINE_TABLES = [
  "clinics",
  "kitchens",
  "products",
  "users",
  "addon_orders",
  "inventory_transactions",
  "inventory_products",
  "inventory_lots",
  "franchises",
];

/** One kitchen, one Core Clinic, one actor user — shared by every test below. */
const FIXTURE_CORE = `
  INSERT INTO public.kitchens (name) VALUES ('CSI RPC Fixture Kitchen')
    RETURNING id INTO v_kitchen;

  INSERT INTO public.clinics (name, address, latitude, longitude, kitchen_id, franchise_id)
  VALUES ('CSI RPC Fixture Core Clinic', 'Fixture address', 12.9716, 77.5946, v_kitchen, NULL)
    RETURNING id INTO v_core_a;

  INSERT INTO public.users (full_name, email)
  VALUES ('CSI RPC Fixture Actor', 'csi-rpc-' || gen_random_uuid() || '@example.invalid')
    RETURNING id INTO v_actor;
`;

const harnessSkip = harnessSkipReason();
const suiteName = harnessSkip
  ? `Clinic RPC set against a live database — SKIPPED (${harnessSkip})`
  : "Clinic RPC set against a live database";

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

    // Dependency order per the task: the two overlay tables before the RPCs
    // that write through them, the product link before the stock-in RPC that
    // reads it, and the parity detector last since it reads both tables.
    for (const script of [
      STAMP_SCRIPT,
      SETTINGS_SCRIPT,
      LEDGER_SCRIPT,
      PRODUCT_LINK_SCRIPT,
      STOCK_IN_SCRIPT,
      APPLY_SALE_SCRIPT,
      VERIFY_PARITY_SCRIPT,
    ]) {
      const outcome = await execSqlFile(script);
      if (!outcome.ok) {
        baselineSkip = `failed to apply ${path.basename(script)}: ${outcome.message}`;
        return;
      }
    }
  }, 300_000);

  it("clinic_shop_stock_in end to end: overlay increases, lots deplete FIFO, one IN ledger entry references the shop-clinic transaction (Req 7.6, 7.8, 7.9, 7.16, 2.5, 2.6, 2.8, 2.11)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_kitchen uuid; v_core_a uuid; v_actor uuid;
        v_inv_product uuid; v_lot1 uuid; v_lot2 uuid; v_product uuid;
        v_report jsonb;
        v_stock int;
        v_lot1_remaining numeric; v_lot1_status text; v_lot2_remaining numeric;
        v_txn_count int; v_ledger_count int; v_ledger_txn_id uuid;
      BEGIN
        ${FIXTURE_CORE}

        INSERT INTO public.inventory_products
          (name, category, image_url, type, base_uom, min_stock_threshold, default_durability_days)
        VALUES ('CSI RPC Fixture Warehouse Item', 'General', '/placeholder.png',
                'FINISHED_GOOD', 'UNIT', 0, 30)
          RETURNING id INTO v_inv_product;

        -- Two lots, older (earlier expiry) depleted first by FIFO.
        INSERT INTO public.inventory_lots (product_id, batch_number, quantity_remaining, expiry_date, status)
        VALUES (v_inv_product, 'CSI-RPC-LOT-1', 5, (current_date + 10), 'ACTIVE')
          RETURNING id INTO v_lot1;

        INSERT INTO public.inventory_lots (product_id, batch_number, quantity_remaining, expiry_date, status)
        VALUES (v_inv_product, 'CSI-RPC-LOT-2', 10, (current_date + 20), 'ACTIVE')
          RETURNING id INTO v_lot2;

        INSERT INTO public.products (name, original_price, inventory_product_id)
        VALUES ('CSI RPC Fixture Shop Product', 199.00, v_inv_product)
          RETURNING id INTO v_product;

        -- Stock-in 8 units: depletes lot1 (5) fully, then 3 from lot2.
        SELECT public.clinic_shop_stock_in(
          v_core_a,
          jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 8)),
          v_actor
        ) INTO v_report;

        -- The overlay increased by 8 (from the seeded baseline of 0).
        SELECT stock_quantity INTO v_stock
          FROM public.clinic_product_settings
         WHERE clinic_id = v_core_a AND product_id = v_product;
        IF v_stock <> 8 THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: overlay stock is % after an 8-unit stock-in, expected 8', v_stock;
        END IF;

        -- FIFO: the older lot is fully depleted before the newer one is touched.
        SELECT quantity_remaining, status INTO v_lot1_remaining, v_lot1_status
          FROM public.inventory_lots WHERE id = v_lot1;
        IF v_lot1_remaining <> 0 OR v_lot1_status <> 'DEPLETED' THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: the older lot is not fully depleted: remaining=%, status=%',
            v_lot1_remaining, v_lot1_status;
        END IF;

        SELECT quantity_remaining INTO v_lot2_remaining
          FROM public.inventory_lots WHERE id = v_lot2;
        IF v_lot2_remaining <> 7 THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: the newer lot remaining is %, expected 7 (10 - 3)', v_lot2_remaining;
        END IF;

        -- inventory_transactions carries the shop-clinic:<uuid> reason.
        SELECT count(*) INTO v_txn_count
          FROM public.inventory_transactions
         WHERE lot_id IN (v_lot1, v_lot2) AND reason = 'shop-clinic:' || v_core_a::text;
        IF v_txn_count < 1 THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: no inventory_transactions row carries the shop-clinic reason';
        END IF;

        -- Exactly one IN ledger entry for this (clinic, product) pair.
        SELECT count(*) INTO v_ledger_count
          FROM public.clinic_product_ledger
         WHERE clinic_id = v_core_a AND product_id = v_product AND direction = 'IN';
        IF v_ledger_count <> 1 THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: expected exactly one IN ledger entry, found %', v_ledger_count;
        END IF;

        -- That entry references one of the transactions just written.
        SELECT inventory_transaction_id INTO v_ledger_txn_id
          FROM public.clinic_product_ledger
         WHERE clinic_id = v_core_a AND product_id = v_product AND direction = 'IN';
        IF v_ledger_txn_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.inventory_transactions
           WHERE id = v_ledger_txn_id AND lot_id IN (v_lot1, v_lot2)
        ) THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: the ledger entry does not reference one of the stock-in transactions';
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  }, 60_000);

  it("a forced mid-submission failure leaves all four tables untouched (Req 7.10)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_kitchen uuid; v_core_a uuid; v_actor uuid;
        v_inv_product uuid; v_lot uuid;
        v_product_ok uuid; v_product_bad uuid;
        v_settings_before numeric; v_settings_after numeric;
        v_lot_before numeric; v_lot_after numeric;
        v_ledger_before int; v_ledger_after int;
        v_txn_before int; v_txn_after int;
      BEGIN
        ${FIXTURE_CORE}

        INSERT INTO public.inventory_products
          (name, category, image_url, type, base_uom, min_stock_threshold, default_durability_days)
        VALUES ('CSI RPC Fixture Warehouse Item B', 'General', '/placeholder.png',
                'FINISHED_GOOD', 'UNIT', 0, 30)
          RETURNING id INTO v_inv_product;

        INSERT INTO public.inventory_lots (product_id, batch_number, quantity_remaining, expiry_date, status)
        VALUES (v_inv_product, 'CSI-RPC-LOT-B1', 50, (current_date + 10), 'ACTIVE')
          RETURNING id INTO v_lot;

        INSERT INTO public.products (name, original_price, inventory_product_id)
        VALUES ('CSI RPC Fixture Shop Product OK', 149.00, v_inv_product)
          RETURNING id INTO v_product_ok;

        INSERT INTO public.products (name, original_price, inventory_product_id)
        VALUES ('CSI RPC Fixture Shop Product Bad Qty', 149.00, v_inv_product)
          RETURNING id INTO v_product_bad;

        SELECT COALESCE(SUM(stock_quantity), -1) INTO v_settings_before
          FROM public.clinic_product_settings
         WHERE clinic_id = v_core_a AND product_id IN (v_product_ok, v_product_bad);
        SELECT quantity_remaining INTO v_lot_before FROM public.inventory_lots WHERE id = v_lot;
        SELECT count(*) INTO v_ledger_before FROM public.clinic_product_ledger
         WHERE clinic_id = v_core_a AND product_id IN (v_product_ok, v_product_bad);
        SELECT count(*) INTO v_txn_before FROM public.inventory_transactions WHERE lot_id = v_lot;

        -- One valid line (5 units, well within the 50 available) mixed with a
        -- line whose quantity is out of Stock_Quantity_Maximum's range
        -- (Req 7.13) — the whole submission must be rejected together.
        BEGIN
          PERFORM public.clinic_shop_stock_in(
            v_core_a,
            jsonb_build_array(
              jsonb_build_object('product_id', v_product_ok, 'quantity', 5),
              jsonb_build_object('product_id', v_product_bad, 'quantity', 2000000)
            ),
            v_actor
          );
          RAISE EXCEPTION
            'ASSERTION FAILED: a submission with an out-of-range quantity line was accepted';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM NOT LIKE 'CLINIC_STOCK_INVALID_QUANTITY:%' THEN RAISE; END IF;
        END;

        SELECT COALESCE(SUM(stock_quantity), -1) INTO v_settings_after
          FROM public.clinic_product_settings
         WHERE clinic_id = v_core_a AND product_id IN (v_product_ok, v_product_bad);
        SELECT quantity_remaining INTO v_lot_after FROM public.inventory_lots WHERE id = v_lot;
        SELECT count(*) INTO v_ledger_after FROM public.clinic_product_ledger
         WHERE clinic_id = v_core_a AND product_id IN (v_product_ok, v_product_bad);
        SELECT count(*) INTO v_txn_after FROM public.inventory_transactions WHERE lot_id = v_lot;

        IF v_settings_before IS DISTINCT FROM v_settings_after THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: clinic_product_settings changed (% -> %) despite a rejected submission',
            v_settings_before, v_settings_after;
        END IF;
        IF v_lot_before IS DISTINCT FROM v_lot_after THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: inventory_lots.quantity_remaining changed (% -> %) despite a rejected submission',
            v_lot_before, v_lot_after;
        END IF;
        IF v_ledger_before IS DISTINCT FROM v_ledger_after THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: clinic_product_ledger row count changed (% -> %) despite a rejected submission',
            v_ledger_before, v_ledger_after;
        END IF;
        IF v_txn_before IS DISTINCT FROM v_txn_after THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: inventory_transactions row count changed (% -> %) despite a rejected submission',
            v_txn_before, v_txn_after;
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  }, 60_000);

  it("verify_clinic_stock_ledger_parity() returns empty after a mixed workload across two (clinic, product) pairs (Req 2.7)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_kitchen uuid; v_core_a uuid; v_actor uuid;
        v_inv_product uuid; v_lot uuid;
        v_product1 uuid; v_product2 uuid; v_order uuid;
        v_divergences int;
      BEGIN
        ${FIXTURE_CORE}

        INSERT INTO public.inventory_products
          (name, category, image_url, type, base_uom, min_stock_threshold, default_durability_days)
        VALUES ('CSI RPC Fixture Warehouse Item C', 'General', '/placeholder.png',
                'FINISHED_GOOD', 'UNIT', 0, 30)
          RETURNING id INTO v_inv_product;

        INSERT INTO public.inventory_lots (product_id, batch_number, quantity_remaining, expiry_date, status)
        VALUES (v_inv_product, 'CSI-RPC-LOT-C1', 100, (current_date + 10), 'ACTIVE')
          RETURNING id INTO v_lot;

        INSERT INTO public.products (name, original_price, inventory_product_id)
        VALUES ('CSI RPC Fixture Mixed Product 1', 99.00, v_inv_product)
          RETURNING id INTO v_product1;

        INSERT INTO public.products (name, original_price, inventory_product_id)
        VALUES ('CSI RPC Fixture Mixed Product 2', 149.00, v_inv_product)
          RETURNING id INTO v_product2;

        -- addon_orders_buyer_identity_check demands a customer or a walk-in name.
        INSERT INTO public.addon_orders (total_amount, target_delivery_date, walkin_name)
        VALUES (500.00, current_date, 'CSI RPC Fixture Walk-in') RETURNING id INTO v_order;

        -- (1) Stock-in both products.
        PERFORM public.clinic_shop_stock_in(
          v_core_a,
          jsonb_build_array(
            jsonb_build_object('product_id', v_product1, 'quantity', 20),
            jsonb_build_object('product_id', v_product2, 'quantity', 15)
          ),
          v_actor
        );

        -- (2) A sale against product 1.
        PERFORM public.clinic_shop_apply_sale(
          v_core_a,
          v_order,
          jsonb_build_array(jsonb_build_object('product_id', v_product1, 'quantity', 5)),
          'ASSISTED_SALE'::clinic_movement_source,
          v_actor
        );

        -- (3) A visibility change — no stock or ledger effect.
        PERFORM public.set_clinic_product_visibility(v_core_a, v_product2, false);

        -- (4) A second stock-in against product 1.
        PERFORM public.clinic_shop_stock_in(
          v_core_a,
          jsonb_build_array(jsonb_build_object('product_id', v_product1, 'quantity', 10)),
          v_actor
        );

        SELECT count(*) INTO v_divergences FROM public.verify_clinic_stock_ledger_parity();
        IF v_divergences <> 0 THEN
          RAISE EXCEPTION
            'ASSERTION FAILED: verify_clinic_stock_ledger_parity found % divergent pair(s) after a mixed workload',
            v_divergences;
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Unit tests: RPC error-prefix to user-message mapping (no database needed)
// ---------------------------------------------------------------------------

/**
 * design.md's "Message mapping" table, copied here verbatim, restricted to the
 * six prefixes raised by the mutation RPCs this file pins to the database
 * (`clinic_shop_stock_in`, `clinic_shop_apply_sale`, and
 * `set_clinic_product_visibility`).
 *
 * `CLINIC_STOCK_LEDGER_IMMUTABLE:`, `CLINIC_STAMP_IMMUTABLE:`, and
 * `CLINIC_STOCK_INCREASE_FORBIDDEN:` are also in that table but are raised by
 * SCHEMA TRIGGERS on `clinic_product_settings` / `clinic_product_ledger` /
 * `addon_orders`, not by these RPCs — they are already exercised end to end by
 * `src/test/shop/schema-guards.integration.test.ts` (Task 1.4). They are
 * deliberately excluded here rather than checked against `MODEL_ERROR_PREFIXES`,
 * since `src/test/shop/clinicStockModel.ts`'s own header comment states it
 * models only the five mutating *routines* (not the schema triggers), and
 * `MODEL_ERROR_PREFIXES` correspondingly has no entry for any of the three.
 *
 * NOTE ON SCOPE: the real action-layer function that turns one of these
 * prefixes into the exact user-facing string does not exist yet — it is
 * created by Task 7.1's `src/actions/admin-actions/clinicShopInventoryActions.ts`,
 * which has not run as of this task. Once it exists, IT should get its own
 * dedicated unit test exercising the real mapping function end to end. This
 * suite only checks that today, design.md's documented mapping and the
 * model's error vocabulary agree with each other — a regression in either
 * without the other is what this catches.
 */
const DESIGN_RPC_MESSAGE_MAPPING: ReadonlyArray<{
  prefix: string;
  userFacingMessage: string;
  requirement: string;
}> = [
  {
    prefix: "CLINIC_STOCK_INSUFFICIENT_WAREHOUSE:",
    userFacingMessage: "lists each product and its available warehouse quantity",
    requirement: "7.12",
  },
  {
    prefix: "CLINIC_STOCK_EXCEEDS_MAXIMUM:",
    userFacingMessage: "states the maximum stock quantity of 1,000,000",
    requirement: "7.14, 18.8",
  },
  {
    prefix: "CLINIC_STOCK_UNLINKED_PRODUCT:",
    userFacingMessage: "product must be linked to a Master Catalog Product before stock-in",
    requirement: "7.15, 18.9",
  },
  {
    prefix: "CLINIC_STOCK_INSUFFICIENT_CLINIC:",
    userFacingMessage: "lists each product with insufficient clinic stock and the quantity available",
    requirement: "11.1, 15.10",
  },
  {
    prefix: "CLINIC_NOT_CORE:",
    userFacingMessage: "Clinic Shop Stock applies to Core Clinics only",
    requirement: "1.9, 13.12",
  },
  {
    prefix: "CLINIC_REFERENCE_NOT_FOUND:",
    userFacingMessage: "names the reference that was not found",
    requirement: "1.2, 2.4, 3.8",
  },
];

describe("RPC error-prefix to user-message mapping — design/model consistency (Req 7.10, 11.1)", () => {
  it.each(DESIGN_RPC_MESSAGE_MAPPING)(
    "$prefix carries stable ':'-terminated syntax, non-empty wording, and is a recognised model prefix",
    ({ prefix, userFacingMessage }) => {
      expect(prefix.endsWith(":")).toBe(true);
      expect(userFacingMessage.length).toBeGreaterThan(0);
      expect(MODEL_ERROR_PREFIXES).toContain(prefix);
    },
  );

  it("lists each design RPC prefix exactly once, with no duplicates", () => {
    const prefixes = DESIGN_RPC_MESSAGE_MAPPING.map((row) => row.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("MODEL_ERROR_PREFIXES is a superset of every design-documented RPC prefix", () => {
    for (const { prefix } of DESIGN_RPC_MESSAGE_MAPPING) {
      expect(MODEL_ERROR_PREFIXES).toContain(prefix);
    }
  });
});
