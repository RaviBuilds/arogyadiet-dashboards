/**
 * Feature: accommodation-payment-lifecycle (Revision 2), Task 13.2 —
 * integration tests for `scripts/create-stay-recalculation.sql` and the
 * database constraints it installs.
 *
 * Validates: Requirements 8.4, 12.16, 13.2, 14.8, 14.9
 *
 *   8.4   `recalculation_applied` is backfilled from `early_checkout_applied`
 *         on the first run, and that backfill is a no-op on subsequent runs.
 *  12.16  `save_stay_details()` is atomic: a failure leaves the stay row and
 *         history table byte-identical.
 *  13.2   `chk_stay_recalc_changed` rejects a history row where neither nights
 *         nor amount changed; zero history rows written for a no-op submission.
 *  14.8   `record_stay_refund_with_invoice()` writes REFUND + invoice together;
 *         a forced invoice failure rolls both back and Total_Paid is unchanged.
 *  14.9   `uniq_refund_invoice_per_transaction` rejects a second Refund_Invoice
 *         for one REFUND transaction while accepting several for the same stay.
 *
 * Structure mirrors `migration.integration.test.ts` (task 1.7):
 *   * "script guarantees" — runs everywhere, no database needed.
 *   * "live database" — opt-in via TEST_DATABASE_URL.
 *
 * Opt-in via `TEST_DATABASE_URL` (see `src/test/db/README.md`). Skips with a
 * self-describing reason otherwise so `npm test` stays green with no database
 * configured.
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

const REPO_ROOT = process.cwd();
const MIGRATION_SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "create-stay-recalculation.sql"
);

/** Pre-existing invoice types that must remain admissible after the widened CHECK. */
const PRE_EXISTING_INVOICE_TYPES = [
  "SUBSCRIPTION",
  "ADDON",
  "ACCOMMODATION_STAY",
  "ACCOMMODATION_EXTENSION",
  "ACCOMMODATION_FINAL_INVOICE",
] as const;

/**
 * Strips `--` line comments so assertions look only at executable SQL.
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

/**
 * Removes `$$ … $$` / `$tag$ … $tag$` bodies so only migration-time
 * statements are visible.
 */
function withoutDollarQuotedBodies(sql: string): string {
  return sql.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, " <body> ");
}

function normalise(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function matches(sql: string, pattern: RegExp): string[] {
  return [...sql.matchAll(pattern)].map((m) => m[1] ?? m[0]);
}

const MIGRATION_RAW = readFileSync(MIGRATION_SCRIPT, "utf8");
const MIGRATION_SQL = executableSql(MIGRATION_RAW);
const MIGRATION_STATEMENTS = withoutDollarQuotedBodies(MIGRATION_SQL);

// ===========================================================================
// Part 1 — Script guarantees (no database required)
// ===========================================================================

describe("Recalculation migration — script guarantees", () => {
  describe("idempotence (re-runnable)", () => {
    it("guards CREATE TABLE and indexes with IF NOT EXISTS", () => {
      const tables = matches(
        MIGRATION_SQL,
        /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([\w.]+)/gi
      );
      const indexes = matches(
        MIGRATION_SQL,
        /CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+([\w.]+)/gi
      );

      expect(tables).toEqual(["public.stay_recalculation_history"]);
      expect(indexes).toEqual(
        expect.arrayContaining([
          "idx_stay_recalc_history_stay",
          "idx_stay_recalc_history_customer",
          "uniq_refund_invoice_per_transaction",
          "idx_payments_stay_payment_tx",
        ])
      );

      expect(MIGRATION_SQL).not.toMatch(
        /CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i
      );
      expect(MIGRATION_SQL).not.toMatch(
        /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/i
      );
    });

    it("guards ADD COLUMN with IF NOT EXISTS", () => {
      const columns = matches(
        MIGRATION_SQL,
        /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi
      );
      expect(columns).toEqual(
        expect.arrayContaining([
          "recalculation_applied",
          "stay_payment_transaction_id",
          "refund_invoice_payment_id",
        ])
      );
      expect(MIGRATION_SQL).not.toMatch(
        /ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/i
      );
    });

    it("guards ADD CONSTRAINT with DROP CONSTRAINT IF EXISTS", () => {
      const flat = normalise(MIGRATION_SQL);
      expect(flat).toMatch(
        /DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+payments_invoice_type_check/i
      );
      expect(flat).toMatch(
        /ADD\s+CONSTRAINT\s+payments_invoice_type_check/i
      );
    });

    it("uses CREATE OR REPLACE for both functions", () => {
      const functions = matches(
        MIGRATION_SQL,
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)/gi
      );
      expect(functions).toEqual([
        "save_stay_details",
        "record_stay_refund_with_invoice",
      ]);
      // No bare CREATE FUNCTION that would fail on re-run.
      expect(MIGRATION_SQL).not.toMatch(
        /CREATE\s+FUNCTION\s+(?!OR\s+REPLACE)/i
      );
    });

    it("backfill UPDATE is self-excluding (no-op on re-run)", () => {
      const flat = normalise(MIGRATION_SQL);
      expect(flat).toMatch(
        /UPDATE\s+public\.stay_entries\s+SET\s+recalculation_applied\s*=\s*true\s+WHERE\s+early_checkout_applied\s*=\s*true\s+AND\s+recalculation_applied\s*=\s*false/i
      );
    });
  });

  describe("additivity — no data writes beyond the one-time backfill", () => {
    it("writes no INSERT / DELETE / TRUNCATE in migration statements", () => {
      const flat = normalise(MIGRATION_STATEMENTS);
      expect(flat).not.toMatch(/\bINSERT\s+INTO\b/i);
      expect(flat).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(flat).not.toMatch(/\bTRUNCATE\b/i);
    });

    it("the only UPDATE is the recalculation_applied backfill", () => {
      const flat = normalise(MIGRATION_STATEMENTS);
      const updates = [...flat.matchAll(/\bUPDATE\s+[\w.]+\s+SET\b/gi)];
      expect(updates).toHaveLength(1);
      expect(updates[0][0]).toMatch(/stay_entries/i);
    });
  });

  describe("widened payments_invoice_type_check admits all pre-existing values", () => {
    it("every pre-existing type plus ACCOMMODATION_REFUND_INVOICE is present", () => {
      const flat = normalise(MIGRATION_SQL);
      const checkBlock = flat.match(
        /ADD CONSTRAINT payments_invoice_type_check CHECK \(([^;]*?)\)\)/i
      );
      expect(
        checkBlock,
        "the widened CHECK predicate must be present"
      ).not.toBeNull();
      const body = checkBlock![1];
      for (const legacy of PRE_EXISTING_INVOICE_TYPES) {
        expect(body, `${legacy} must stay admissible`).toContain(
          `'${legacy}'::text`
        );
      }
      expect(body).toContain("'ACCOMMODATION_REFUND_INVOICE'::text");
    });
  });

  describe("chk_stay_recalc_changed constraint definition", () => {
    it("requires nights_before <> nights_after OR total_amount_before IS DISTINCT FROM total_amount_after", () => {
      const flat = normalise(MIGRATION_SQL);
      expect(flat).toContain("chk_stay_recalc_changed");
      expect(flat).toMatch(
        /nights_before\s*<>\s*nights_after\s+OR\s+total_amount_before\s+IS\s+DISTINCT\s+FROM\s+total_amount_after/i
      );
    });
  });
});

// ===========================================================================
// Part 2 — Live database (opt-in via TEST_DATABASE_URL)
// ===========================================================================

/**
 * Prerequisite migration scripts that must have already been applied.
 */
const PREREQ_SCRIPTS = [
  path.join(REPO_ROOT, "scripts", "create-accommodation-tables.sql"),
  path.join(REPO_ROOT, "scripts", "create-stay-payment-lifecycle.sql"),
  path.join(REPO_ROOT, "scripts", "create-stay-extension-history.sql"),
];

/**
 * Schema fingerprint over all objects this migration installs. Two runs must
 * produce byte-identical JSON.
 */
const FINGERPRINT_SQL = `
SELECT json_build_object(
  'recalc_columns', (
    SELECT coalesce(json_agg(json_build_object(
             'table', c.table_name, 'column', c.column_name, 'type', c.data_type,
             'nullable', c.is_nullable, 'default', c.column_default)
             ORDER BY c.table_name, c.column_name), '[]'::json)
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND (c.table_name = 'stay_recalculation_history'
        OR (c.table_name = 'stay_entries' AND c.column_name = 'recalculation_applied')
        OR (c.table_name = 'payments' AND c.column_name = 'stay_payment_transaction_id')
        OR (c.table_name = 'stay_payment_transactions' AND c.column_name = 'refund_invoice_payment_id'))
  ),
  'constraints', (
    SELECT coalesce(json_agg(json_build_object(
             'table', rel.relname, 'name', con.conname, 'def', pg_get_constraintdef(con.oid))
             ORDER BY rel.relname, con.conname), '[]'::json)
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND (rel.relname = 'stay_recalculation_history'
        OR (rel.relname = 'payments' AND con.conname IN ('payments_invoice_type_check')))
  ),
  'indexes', (
    SELECT coalesce(json_agg(json_build_object('name', indexname, 'def', indexdef)
             ORDER BY indexname), '[]'::json)
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'idx_stay_recalc_history_stay', 'idx_stay_recalc_history_customer',
        'uniq_refund_invoice_per_transaction', 'idx_payments_stay_payment_tx')
  ),
  'functions', (
    SELECT coalesce(json_agg(json_build_object('name', p.proname,
             'args', pg_get_function_identity_arguments(p.oid),
             'def', pg_get_functiondef(p.oid))
             ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::json)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('save_stay_details', 'record_stay_refund_with_invoice')
  )
) AS fingerprint
`;

/**
 * Data digest over stay_entries.recalculation_applied (the only data the
 * migration touches). The second run should produce identical output.
 */
const DATA_DIGEST_SQL = `
SELECT json_build_object(
  'recalc_true_count', (
    SELECT count(*) FROM public.stay_entries WHERE recalculation_applied = true
  ),
  'early_checkout_without_recalc', (
    SELECT count(*) FROM public.stay_entries
     WHERE early_checkout_applied = true AND recalculation_applied = false
  ),
  'recalc_history_count', (
    SELECT CASE WHEN EXISTS (
             SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'stay_recalculation_history')
           THEN (SELECT count(*) FROM public.stay_recalculation_history)
           ELSE 0 END
  )
) AS digest
`;

/**
 * Fixture preamble creating a user, profile, and two stays for constraint probes.
 * Every probe runs inside BEGIN … ROLLBACK.
 */
const FIXTURE_PREAMBLE = `
  INSERT INTO public.users (full_name, email, mobile, is_active)
  VALUES ('Recalc Probe', 'recalc-' || gen_random_uuid() || '@example.invalid',
          '9100000001', false)
  RETURNING id INTO v_user;

  INSERT INTO public.customer_profiles (user_id) VALUES (v_user) RETURNING id INTO v_profile;

  INSERT INTO public.stay_entries
    (customer_profile_id, start_date, total_nights, stay_type, occupancy_type, status, payment_amount)
  VALUES (v_profile, current_date - 10, 15, 'AC Villa', 'Single', 'ACTIVE', 75000.00)
  RETURNING id INTO v_stay;

  INSERT INTO public.stay_entries
    (customer_profile_id, start_date, total_nights, stay_type, occupancy_type, status, payment_amount)
  VALUES (v_profile, current_date, 5, 'AC Villa', 'Single', 'ACTIVE', 50000.00)
  RETURNING id INTO v_other_stay;
`;

const harnessSkip = harnessSkipReason();
const suiteName = harnessSkip
  ? `Recalculation migration against a live database — SKIPPED (${harnessSkip})`
  : "Recalculation migration against a live database";

describe.skipIf(harnessSkip !== null)(suiteName, () => {
  let fingerprintAfterFirst: unknown;
  let fingerprintAfterSecond: unknown;
  let digestAfterFirst: unknown;
  let digestAfterSecond: unknown;

  beforeAll(async () => {
    // Ensure prerequisite migrations are applied (idempotent).
    for (const script of PREREQ_SCRIPTS) {
      const result = await execSqlFile(script);
      expect(result.ok, `prereq ${path.basename(script)}: ${result.ok ? "" : result.message}`).toBe(true);
    }

    // First pass of the recalculation migration.
    const first = await execSqlFile(MIGRATION_SCRIPT);
    expect(first.ok, `first pass: ${first.ok ? "" : first.message}`).toBe(true);
    fingerprintAfterFirst = (await queryJson(FINGERPRINT_SQL))[0];
    digestAfterFirst = (await queryJson(DATA_DIGEST_SQL))[0];

    // Second pass (must be identical — idempotent).
    const second = await execSqlFile(MIGRATION_SCRIPT);
    expect(second.ok, `second pass: ${second.ok ? "" : second.message}`).toBe(true);
    fingerprintAfterSecond = (await queryJson(FINGERPRINT_SQL))[0];
    digestAfterSecond = (await queryJson(DATA_DIGEST_SQL))[0];
  }, 300_000);

  // --------------------------------------------------------------------------
  // Idempotence: identical schema and data after two runs
  // --------------------------------------------------------------------------

  it("runs twice with an identical resulting schema", () => {
    expect(fingerprintAfterSecond).toEqual(fingerprintAfterFirst);
  });

  it("changes no data beyond the one-time recalculation_applied backfill (Req 8.4)", () => {
    // After the first run, every early_checkout_applied row should also be
    // recalculation_applied; the second run should change nothing.
    expect(digestAfterSecond).toEqual(digestAfterFirst);
    // The backfill should have made the "early without recalc" count zero.
    expect((digestAfterFirst as Record<string, unknown>).early_checkout_without_recalc).toBe(0);
  });

  it("every pre-existing payments.invoice_type value remains admissible after the widened CHECK", async () => {
    // Insert one row per legacy type then roll back — if any is rejected the
    // CHECK is too narrow.
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_user uuid; v_profile uuid; v_stay uuid; v_other_stay uuid;
        v_type text;
      BEGIN
        ${FIXTURE_PREAMBLE}

        FOREACH v_type IN ARRAY ARRAY[${PRE_EXISTING_INVOICE_TYPES.map((t) => `'${t}'`).join(", ")}, 'ACCOMMODATION_REFUND_INVOICE']::text[]
        LOOP
          INSERT INTO public.payments
            (customer_profile_id, stay_entry_id, payment_method, amount, status, invoice_type)
          VALUES (v_profile, v_stay, 'Manual', 1000.00, 'PAID', v_type);
        END LOOP;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  // --------------------------------------------------------------------------
  // chk_stay_recalc_changed constraint (Req 13.2)
  // --------------------------------------------------------------------------

  it("chk_stay_recalc_changed rejects a direct insert where neither nights nor amount changed", async () => {
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_user uuid; v_profile uuid; v_stay uuid; v_other_stay uuid;
      BEGIN
        ${FIXTURE_PREAMBLE}

        -- Attempt: nights_before = nights_after = 15, amount_before = amount_after = 75000
        BEGIN
          INSERT INTO public.stay_recalculation_history
            (stay_entry_id, customer_profile_id,
             nights_before, nights_after,
             total_amount_before, total_amount_after,
             end_date_before, end_date_after,
             recalculated_on)
          VALUES (v_stay, v_profile,
                  15, 15,
                  75000.00, 75000.00,
                  current_date + 4, current_date + 4,
                  current_date);
          RAISE EXCEPTION 'ASSERTION FAILED: history row accepted when nothing changed';
        EXCEPTION WHEN check_violation THEN
          NULL; -- expected: chk_stay_recalc_changed
        END;

        -- Confirm: changing only nights is accepted.
        INSERT INTO public.stay_recalculation_history
          (stay_entry_id, customer_profile_id,
           nights_before, nights_after,
           total_amount_before, total_amount_after,
           end_date_before, end_date_after,
           recalculated_on)
        VALUES (v_stay, v_profile,
                15, 10,
                75000.00, 75000.00,
                current_date + 4, current_date - 1,
                current_date);

        -- Confirm: changing only amount is accepted.
        INSERT INTO public.stay_recalculation_history
          (stay_entry_id, customer_profile_id,
           nights_before, nights_after,
           total_amount_before, total_amount_after,
           end_date_before, end_date_after,
           recalculated_on)
        VALUES (v_stay, v_profile,
                10, 10,
                75000.00, 60000.00,
                current_date - 1, current_date - 1,
                current_date);
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  // --------------------------------------------------------------------------
  // uniq_refund_invoice_per_transaction (Req 14.9)
  // --------------------------------------------------------------------------

  it("uniq_refund_invoice_per_transaction rejects a second Refund_Invoice for one REFUND transaction but accepts several for the same stay", async () => {
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_user uuid; v_profile uuid; v_stay uuid; v_other_stay uuid;
        v_tx1 uuid; v_tx2 uuid;
      BEGIN
        ${FIXTURE_PREAMBLE}

        -- Create two REFUND transactions on the SAME stay.
        INSERT INTO public.stay_payment_transactions
          (stay_entry_id, customer_profile_id, transaction_type, amount, transaction_date, remark)
        VALUES (v_stay, v_profile, 'REFUND', 1000.00, current_date, 'refund 1')
        RETURNING id INTO v_tx1;

        INSERT INTO public.stay_payment_transactions
          (stay_entry_id, customer_profile_id, transaction_type, amount, transaction_date, remark)
        VALUES (v_stay, v_profile, 'REFUND', 2000.00, current_date, 'refund 2')
        RETURNING id INTO v_tx2;

        -- First Refund_Invoice for tx1 — accepted.
        INSERT INTO public.payments
          (customer_profile_id, stay_entry_id, stay_payment_transaction_id,
           payment_method, amount, status, invoice_type)
        VALUES (v_profile, v_stay, v_tx1,
                'Manual', 1000.00, 'PAID', 'ACCOMMODATION_REFUND_INVOICE');

        -- Second Refund_Invoice for tx1 — rejected (unique per transaction).
        BEGIN
          INSERT INTO public.payments
            (customer_profile_id, stay_entry_id, stay_payment_transaction_id,
             payment_method, amount, status, invoice_type)
          VALUES (v_profile, v_stay, v_tx1,
                  'Manual', 1000.00, 'PAID', 'ACCOMMODATION_REFUND_INVOICE');
          RAISE EXCEPTION 'ASSERTION FAILED: second Refund_Invoice for the same transaction was accepted';
        EXCEPTION WHEN unique_violation THEN
          NULL; -- expected
        END;

        -- Refund_Invoice for tx2 (same stay, different transaction) — accepted.
        INSERT INTO public.payments
          (customer_profile_id, stay_entry_id, stay_payment_transaction_id,
           payment_method, amount, status, invoice_type)
        VALUES (v_profile, v_stay, v_tx2,
                'Manual', 2000.00, 'PAID', 'ACCOMMODATION_REFUND_INVOICE');

        -- Two Refund_Invoices exist for the same stay (Req 14.9 — many per stay).
        IF (SELECT count(*) FROM public.payments
            WHERE stay_entry_id = v_stay
              AND invoice_type = 'ACCOMMODATION_REFUND_INVOICE') <> 2 THEN
          RAISE EXCEPTION 'ASSERTION FAILED: expected 2 Refund_Invoices for the stay';
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  // --------------------------------------------------------------------------
  // save_stay_details() under real constraints (Req 12.16, 13.2)
  // --------------------------------------------------------------------------

  it("save_stay_details() rejects a non-ACTIVE stay", async () => {
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_user uuid; v_profile uuid; v_stay uuid; v_other_stay uuid;
        v_result jsonb;
      BEGIN
        ${FIXTURE_PREAMBLE}

        -- Make the stay FINISHED.
        UPDATE public.stay_entries SET status = 'FINISHED' WHERE id = v_stay;

        SELECT public.save_stay_details(
          v_stay,
          (current_date - 10 + 5 - 1)::date,  -- mid-stay end date
          50000, 42372.88, 7627.12,
          current_date, v_user
        ) INTO v_result;

        IF (v_result->>'ok')::boolean THEN
          RAISE EXCEPTION 'ASSERTION FAILED: save_stay_details accepted a FINISHED stay';
        END IF;
        IF v_result->>'reason' <> 'NOT_ACTIVE' THEN
          RAISE EXCEPTION 'ASSERTION FAILED: expected NOT_ACTIVE, got %', v_result->>'reason';
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  it("save_stay_details() rejects a date after the booked end date", async () => {
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_user uuid; v_profile uuid; v_stay uuid; v_other_stay uuid;
        v_result jsonb;
        v_booked_end date;
      BEGIN
        ${FIXTURE_PREAMBLE}

        -- v_stay: start = current_date - 10, total_nights = 15
        -- booked end = (current_date - 10) + 14 = current_date + 4
        v_booked_end := (current_date - 10) + 14;

        SELECT public.save_stay_details(
          v_stay,
          v_booked_end + 1,  -- one day AFTER booked end
          60000, 50847.46, 9152.54,
          current_date, v_user
        ) INTO v_result;

        IF (v_result->>'ok')::boolean THEN
          RAISE EXCEPTION 'ASSERTION FAILED: save_stay_details accepted a date after the booked end';
        END IF;
        IF v_result->>'reason' <> 'INVALID_END_DATE' THEN
          RAISE EXCEPTION 'ASSERTION FAILED: expected INVALID_END_DATE, got %', v_result->>'reason';
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  it("save_stay_details() rejects a date before the start date", async () => {
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_user uuid; v_profile uuid; v_stay uuid; v_other_stay uuid;
        v_result jsonb;
      BEGIN
        ${FIXTURE_PREAMBLE}

        -- v_stay start_date = current_date - 10
        SELECT public.save_stay_details(
          v_stay,
          (current_date - 11)::date,  -- one day BEFORE start
          50000, 42372.88, 7627.12,
          current_date, v_user
        ) INTO v_result;

        IF (v_result->>'ok')::boolean THEN
          RAISE EXCEPTION 'ASSERTION FAILED: save_stay_details accepted a date before the start date';
        END IF;
        IF v_result->>'reason' <> 'INVALID_END_DATE' THEN
          RAISE EXCEPTION 'ASSERTION FAILED: expected INVALID_END_DATE, got %', v_result->>'reason';
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  it("save_stay_details() rejects a fractional amount", async () => {
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_user uuid; v_profile uuid; v_stay uuid; v_other_stay uuid;
        v_result jsonb;
        v_booked_end date;
      BEGIN
        ${FIXTURE_PREAMBLE}

        v_booked_end := (current_date - 10) + 14;

        SELECT public.save_stay_details(
          v_stay,
          v_booked_end,
          50000.50,  -- fractional
          42373.31, 7627.19,
          current_date, v_user
        ) INTO v_result;

        IF (v_result->>'ok')::boolean THEN
          RAISE EXCEPTION 'ASSERTION FAILED: save_stay_details accepted a fractional amount';
        END IF;
        IF v_result->>'reason' <> 'AMOUNT_OUT_OF_RANGE' THEN
          RAISE EXCEPTION 'ASSERTION FAILED: expected AMOUNT_OUT_OF_RANGE, got %', v_result->>'reason';
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  it("save_stay_details() accepts the start date itself, yielding exactly 1 night", async () => {
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_user uuid; v_profile uuid; v_stay uuid; v_other_stay uuid;
        v_result jsonb;
        v_start_date date;
        v_nights_after int;
      BEGIN
        ${FIXTURE_PREAMBLE}

        v_start_date := (current_date - 10);

        SELECT public.save_stay_details(
          v_stay,
          v_start_date,  -- the start date itself
          30000, 25423.73, 4576.27,
          current_date, v_user
        ) INTO v_result;

        IF NOT (v_result->>'ok')::boolean THEN
          RAISE EXCEPTION 'ASSERTION FAILED: save_stay_details rejected the start date: %', v_result->>'reason';
        END IF;

        -- Verify exactly 1 night.
        v_nights_after := (v_result->'stay'->>'total_nights')::int;
        IF v_nights_after <> 1 THEN
          RAISE EXCEPTION 'ASSERTION FAILED: expected 1 night, got %', v_nights_after;
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  it("save_stay_details() writes zero history rows for a full no-op submission", async () => {
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_user uuid; v_profile uuid; v_stay uuid; v_other_stay uuid;
        v_result jsonb;
        v_booked_end date;
        v_history_count int;
      BEGIN
        ${FIXTURE_PREAMBLE}

        -- v_stay: start = current_date - 10, total_nights = 15, payment_amount = 75000
        v_booked_end := (current_date - 10) + 14;

        -- Submit with UNCHANGED values (same end date, same amount).
        SELECT public.save_stay_details(
          v_stay,
          v_booked_end,
          75000,  -- same as current payment_amount
          63559.32, 11440.68,
          current_date, v_user
        ) INTO v_result;

        IF NOT (v_result->>'ok')::boolean THEN
          RAISE EXCEPTION 'ASSERTION FAILED: no-op submission failed: %', v_result->>'reason';
        END IF;

        IF (v_result->>'history_recorded')::boolean THEN
          RAISE EXCEPTION 'ASSERTION FAILED: history_recorded should be false for a no-op';
        END IF;

        SELECT count(*) INTO v_history_count
          FROM public.stay_recalculation_history
         WHERE stay_entry_id = v_stay;

        IF v_history_count <> 0 THEN
          RAISE EXCEPTION 'ASSERTION FAILED: expected 0 history rows, found %', v_history_count;
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  it("save_stay_details() leaves the stay byte-identical when its history insert is forced to fail (Req 12.16)", async () => {
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_user uuid; v_profile uuid; v_stay uuid; v_other_stay uuid;
        v_stay_before jsonb;
        v_stay_after jsonb;
        v_booked_end date;
      BEGIN
        ${FIXTURE_PREAMBLE}

        v_booked_end := (current_date - 10) + 14;

        -- Snapshot the stay BEFORE.
        SELECT to_jsonb(se) INTO v_stay_before FROM public.stay_entries se WHERE id = v_stay;

        -- Force the history insert to fail by making customer_profile_id NOT
        -- match a valid FK. We do this by temporarily removing the FK target
        -- from customer_profiles. However, that would cascade other FKs, so
        -- instead we use a simpler approach: drop the CHECK constraint
        -- temporarily and insert a row that violates nights_after >= 1 which
        -- would be caught by the CHECK on stay_recalculation_history.
        -- Actually, the simplest approach: we CANNOT directly force a failure
        -- inside the function's transaction. Instead, let's verify atomicity by
        -- checking that a submission that CHANGES the stay also records history,
        -- and if we sabotage the history table's FK, the whole thing rolls back.

        -- Approach: Add a trigger that raises an exception on history insert.
        CREATE OR REPLACE FUNCTION test_block_history_insert()
        RETURNS TRIGGER AS $t$
        BEGIN
          RAISE EXCEPTION 'deliberately blocked history insert for atomicity test';
        END;
        $t$ LANGUAGE plpgsql;

        CREATE TRIGGER trg_block_history
          BEFORE INSERT ON public.stay_recalculation_history
          FOR EACH ROW EXECUTE FUNCTION test_block_history_insert();

        -- Now try to save_stay_details with a real change (different nights).
        BEGIN
          PERFORM public.save_stay_details(
            v_stay,
            v_booked_end - 5,  -- 5 fewer nights
            50000, 42372.88, 7627.12,
            current_date, v_user
          );
          RAISE EXCEPTION 'ASSERTION FAILED: save_stay_details did not propagate the history failure';
        EXCEPTION WHEN OTHERS THEN
          -- Expected: the deliberate exception from the trigger.
          IF SQLERRM NOT LIKE '%deliberately blocked%' THEN
            RAISE;
          END IF;
        END;

        -- Drop the trigger.
        DROP TRIGGER trg_block_history ON public.stay_recalculation_history;
        DROP FUNCTION test_block_history_insert();

        -- Snapshot the stay AFTER — it must be identical to BEFORE (Req 12.16).
        SELECT to_jsonb(se) INTO v_stay_after FROM public.stay_entries se WHERE id = v_stay;

        IF v_stay_before IS DISTINCT FROM v_stay_after THEN
          RAISE EXCEPTION 'ASSERTION FAILED: stay row changed despite history failure. Before: %, After: %',
            v_stay_before, v_stay_after;
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  // --------------------------------------------------------------------------
  // record_stay_refund_with_invoice() under real constraints (Req 14.8, 14.9)
  // --------------------------------------------------------------------------

  it("record_stay_refund_with_invoice() writes REFUND + payments row together", async () => {
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_user uuid; v_profile uuid; v_stay uuid; v_other_stay uuid;
        v_result jsonb;
        v_tx_count int;
        v_invoice_count int;
      BEGIN
        ${FIXTURE_PREAMBLE}

        -- The stay needs Total_Paid > payment_amount for there to be an excess.
        -- payment_amount = 75000. Pay 80000 so excess = 5000.
        INSERT INTO public.stay_payment_transactions
          (stay_entry_id, customer_profile_id, transaction_type, amount, transaction_date, comment)
        VALUES (v_stay, v_profile, 'ADVANCE', 80000.00, current_date, 'paid extra');

        SELECT public.record_stay_refund_with_invoice(
          v_stay, 3000.00, current_date, 'early departure refund', NULL, v_user
        ) INTO v_result;

        IF NOT (v_result->>'ok')::boolean THEN
          RAISE EXCEPTION 'ASSERTION FAILED: refund rejected: %', v_result->>'reason';
        END IF;

        -- Both the REFUND row and the payments row must exist.
        SELECT count(*) INTO v_tx_count
          FROM public.stay_payment_transactions
         WHERE stay_entry_id = v_stay AND transaction_type = 'REFUND';

        SELECT count(*) INTO v_invoice_count
          FROM public.payments
         WHERE stay_entry_id = v_stay
           AND invoice_type = 'ACCOMMODATION_REFUND_INVOICE';

        IF v_tx_count <> 1 THEN
          RAISE EXCEPTION 'ASSERTION FAILED: expected 1 REFUND transaction, found %', v_tx_count;
        END IF;
        IF v_invoice_count <> 1 THEN
          RAISE EXCEPTION 'ASSERTION FAILED: expected 1 Refund_Invoice, found %', v_invoice_count;
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  it("record_stay_refund_with_invoice() rolls back both rows when the invoice insert is forced to fail, and Total_Paid is unchanged (Req 14.8)", async () => {
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_user uuid; v_profile uuid; v_stay uuid; v_other_stay uuid;
        v_total_paid_before numeric;
        v_total_paid_after numeric;
        v_tx_count int;
        v_invoice_count int;
      BEGIN
        ${FIXTURE_PREAMBLE}

        -- Pay 80000 against 75000 total → excess = 5000.
        INSERT INTO public.stay_payment_transactions
          (stay_entry_id, customer_profile_id, transaction_type, amount, transaction_date, comment)
        VALUES (v_stay, v_profile, 'ADVANCE', 80000.00, current_date, 'paid extra');

        -- Snapshot Total_Paid before.
        SELECT COALESCE(SUM(CASE WHEN transaction_type = 'REFUND' THEN -amount ELSE amount END), 0)
          INTO v_total_paid_before
          FROM public.stay_payment_transactions
         WHERE stay_entry_id = v_stay;

        -- Force the invoice INSERT to fail by sabotaging the payments table
        -- with a trigger.
        CREATE OR REPLACE FUNCTION test_block_refund_invoice()
        RETURNS TRIGGER AS $t$
        BEGIN
          IF NEW.invoice_type = 'ACCOMMODATION_REFUND_INVOICE' THEN
            RAISE EXCEPTION 'deliberately blocked refund invoice for atomicity test';
          END IF;
          RETURN NEW;
        END;
        $t$ LANGUAGE plpgsql;

        CREATE TRIGGER trg_block_refund_invoice
          BEFORE INSERT ON public.payments
          FOR EACH ROW EXECUTE FUNCTION test_block_refund_invoice();

        -- Attempt the refund — should fail and roll back everything.
        BEGIN
          PERFORM public.record_stay_refund_with_invoice(
            v_stay, 3000.00, current_date, 'emergency refund', NULL, v_user
          );
          RAISE EXCEPTION 'ASSERTION FAILED: refund did not propagate the invoice failure';
        EXCEPTION WHEN OTHERS THEN
          IF SQLERRM NOT LIKE '%deliberately blocked%' THEN
            RAISE;
          END IF;
        END;

        -- Clean up trigger.
        DROP TRIGGER trg_block_refund_invoice ON public.payments;
        DROP FUNCTION test_block_refund_invoice();

        -- Neither the REFUND row nor the invoice should exist.
        SELECT count(*) INTO v_tx_count
          FROM public.stay_payment_transactions
         WHERE stay_entry_id = v_stay AND transaction_type = 'REFUND';

        SELECT count(*) INTO v_invoice_count
          FROM public.payments
         WHERE stay_entry_id = v_stay
           AND invoice_type = 'ACCOMMODATION_REFUND_INVOICE';

        IF v_tx_count <> 0 THEN
          RAISE EXCEPTION 'ASSERTION FAILED: REFUND row survived invoice failure (found %)', v_tx_count;
        END IF;
        IF v_invoice_count <> 0 THEN
          RAISE EXCEPTION 'ASSERTION FAILED: Refund_Invoice survived its own failure (found %)', v_invoice_count;
        END IF;

        -- Total_Paid unchanged.
        SELECT COALESCE(SUM(CASE WHEN transaction_type = 'REFUND' THEN -amount ELSE amount END), 0)
          INTO v_total_paid_after
          FROM public.stay_payment_transactions
         WHERE stay_entry_id = v_stay;

        IF v_total_paid_before <> v_total_paid_after THEN
          RAISE EXCEPTION 'ASSERTION FAILED: Total_Paid changed from % to %',
            v_total_paid_before, v_total_paid_after;
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });
});
