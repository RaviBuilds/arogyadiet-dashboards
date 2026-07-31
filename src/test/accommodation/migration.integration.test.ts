/**
 * Feature: accommodation-payment-lifecycle, Task 1.7 — integration tests for
 * `scripts/create-stay-payment-lifecycle.sql` and the database constraints it
 * installs.
 *
 * Validates: Requirements 4.5, 6.1, 8.6, 12.6
 *
 *   4.5  Exactly one Payment_Transaction of type ADVANCE per Stay_Entry —
 *        enforced by the partial unique index `uniq_stay_advance_transaction`.
 *   6.1  The ledger holds one row per money movement: every PARTIAL_BALANCE_PAYMENT
 *        and REFUND stays unrestricted in number, and `amount > 0` rejects a
 *        non-positive direct write.
 *   8.6  At most one Final_Consolidated_Invoice per Stay_Entry — enforced by the
 *        partial unique index `uniq_final_stay_invoice_per_stay`, while the
 *        historical ACCOMMODATION_STAY / ACCOMMODATION_EXTENSION rows stay
 *        unconstrained.
 *  12.6  `actual_nights_stayed` is at least 1 whenever set — enforced by
 *        `chk_stay_actual_nights`, so a direct write cannot bypass the
 *        application bound.
 *
 * Plus the migration-level guarantee the task calls for: the script runs twice
 * with an identical resulting schema and no data change, and existing
 * accommodation `payments` rows are left untouched.
 *
 * The file has two halves:
 *
 *   * "script guarantees" — reads `scripts/create-stay-payment-lifecycle.sql`
 *     and asserts the structural properties that make it idempotent and purely
 *     additive. These run everywhere, including on a machine with no database.
 *
 *   * "live database" — applies the script to a scratch Postgres twice,
 *     fingerprints the catalog before/after each pass, and drives the four
 *     constraints with direct writes inside rolled-back transactions. Opt-in via
 *     `TEST_DATABASE_URL`; skips with a message naming the missing prerequisite
 *     otherwise. See `src/test/db/README.md`.
 *
 * Scope note: the two RPCs' behaviour (concurrency, refund gating, balance
 * parity with `deriveStayBalance`) is task 4.3's subject, not this file's. Here
 * they are only fingerprinted, so re-running the migration cannot silently
 * change their definitions.
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
const MIGRATION_SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "create-stay-payment-lifecycle.sql"
);

/** The `payments.invoice_type` values that existed before this migration. */
const LEGACY_INVOICE_TYPES = [
  "SUBSCRIPTION",
  "ADDON",
  "ACCOMMODATION_STAY",
  "ACCOMMODATION_EXTENSION",
] as const;

/** Columns this migration adds, excluded from the "data unchanged" digests. */
const NEW_STAY_COLUMNS = [
  "is_backdated",
  "early_checkout_applied",
  "actual_nights_stayed",
  "original_total_nights",
  "original_total_amount",
  "checked_out_at",
  "final_invoice_payment_id",
  "final_invoice_generated_at",
  "final_invoice_error",
] as const;

/**
 * Strips `--` line comments so the assertions below only ever look at what the
 * server actually executes. The script carries its rollback plan in comments,
 * and that plan contains exactly the DROP statements several assertions check
 * for the *absence* of. No `--` appears inside a string literal in the script,
 * so a line-wise strip is sufficient.
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
 * Removes `$$ … $$` / `$do$ … $do$` bodies, leaving the statements the
 * migration itself runs. Needed because the two RPCs contain DML that executes
 * at call time, not at migration time.
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

describe("Accommodation payment lifecycle migration — script guarantees", () => {
  describe("idempotence (re-runnable, Req 4.5, 6.1, 8.6, 12.6)", () => {
    it("guards every CREATE TABLE, index and ADD COLUMN with IF NOT EXISTS", () => {
      const tables = matches(
        MIGRATION_SQL,
        /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([\w.]+)/gi
      );
      const indexes = matches(
        MIGRATION_SQL,
        /CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+([\w.]+)/gi
      );
      const columns = matches(MIGRATION_SQL, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi);

      // Guard against the absence-assertions below being vacuous.
      expect(tables).toEqual(["public.stay_payment_transactions"]);
      expect(indexes).toEqual(
        expect.arrayContaining([
          "idx_stay_payment_tx_stay",
          "idx_stay_payment_tx_customer",
          "uniq_stay_advance_transaction",
          "uniq_final_stay_invoice_per_stay",
          "idx_payments_stay_entry",
        ])
      );
      expect(columns).toEqual(
        expect.arrayContaining([...NEW_STAY_COLUMNS, "stay_entry_id"])
      );

      expect(MIGRATION_SQL).not.toMatch(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i);
      expect(MIGRATION_SQL).not.toMatch(
        /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/i
      );
      expect(MIGRATION_SQL).not.toMatch(/ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/i);
    });

    it("guards each ADD CONSTRAINT with a DROP IF EXISTS or a pg_constraint existence check", () => {
      const added = matches(MIGRATION_SQL, /ADD\s+CONSTRAINT\s+(\w+)/gi);
      expect(added).toEqual(
        expect.arrayContaining(["chk_stay_actual_nights", "payments_invoice_type_check"])
      );

      const flat = normalise(MIGRATION_SQL);
      for (const name of added) {
        const dropped = new RegExp(
          `DROP\\s+CONSTRAINT\\s+IF\\s+EXISTS\\s+${name}\\b`,
          "i"
        ).test(flat);
        const guarded = new RegExp(
          `IF\\s+NOT\\s+EXISTS\\s*\\([^)]*pg_constraint[^)]*conname\\s*=\\s*'${name}'`,
          "i"
        ).test(flat);
        expect(
          dropped || guarded,
          `${name} must be dropped first or guarded on pg_constraint`
        ).toBe(true);
      }
    });

    it("replaces rather than duplicates every function and the view", () => {
      expect(MIGRATION_SQL).not.toMatch(/CREATE\s+FUNCTION\s/i);
      expect(MIGRATION_SQL).not.toMatch(/CREATE\s+VIEW\s/i);

      expect(
        matches(MIGRATION_SQL, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)/gi)
      ).toEqual([
        "update_stay_payment_transactions_updated_at",
        "record_stay_payment_transaction",
        "finalize_stay_checkout",
      ]);
      expect(
        matches(MIGRATION_SQL, /CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.(\w+)/gi)
      ).toEqual(["stay_payment_balances"]);
    });

    it("drops the updated_at trigger before creating it", () => {
      const triggers = matches(MIGRATION_SQL, /CREATE\s+TRIGGER\s+(\w+)/gi);
      expect(triggers).toEqual(["trg_stay_payment_tx_updated_at"]);
      for (const name of triggers) {
        expect(MIGRATION_SQL).toMatch(
          new RegExp(`DROP\\s+TRIGGER\\s+IF\\s+EXISTS\\s+${name}\\b`, "i")
        );
      }
    });
  });

  describe("additivity over existing rows", () => {
    it("writes no data at all", () => {
      // Function bodies are excluded: the RPCs' INSERT/UPDATE run when called,
      // not when the migration is applied.
      const flat = normalise(MIGRATION_STATEMENTS);
      expect(flat).not.toMatch(/\bINSERT\s+INTO\b/i);
      expect(flat).not.toMatch(/\bUPDATE\s+(?:ONLY\s+)?[\w.]+\s+SET\b/i);
      expect(flat).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(flat).not.toMatch(/\bTRUNCATE\b/i);
    });

    it("never mutates payments rows, in the migration or in either RPC (Req 8.6)", () => {
      const flat = normalise(MIGRATION_SQL);
      const qualified = "(?:public\\.)?payments\\b";
      const forbidden: Array<[string, RegExp]> = [
        ["INSERT", new RegExp(`INSERT INTO ${qualified}`, "i")],
        ["UPDATE", new RegExp(`UPDATE (?:ONLY )?${qualified}`, "i")],
        ["DELETE", new RegExp(`DELETE FROM (?:ONLY )?${qualified}`, "i")],
        ["TRUNCATE", new RegExp(`TRUNCATE (?:TABLE )?${qualified}`, "i")],
        ["DROP", new RegExp(`DROP TABLE (?:IF EXISTS )?${qualified}`, "i")],
        ["DROP COLUMN", /ALTER TABLE public\.payments[^;]*DROP COLUMN/i],
      ];
      for (const [label, pattern] of forbidden) {
        expect(flat, `${label} must not target payments`).not.toMatch(pattern);
      }
    });

    it("widens payments_invoice_type_check without dropping any legacy value (Req 8.6)", () => {
      const flat = normalise(MIGRATION_SQL);
      const predicate = flat.match(
        /ADD CONSTRAINT payments_invoice_type_check CHECK \(([^;]*?)\)\);/i
      );
      expect(predicate, "the widened CHECK predicate must be present").not.toBeNull();
      const body = predicate![1];
      for (const legacy of LEGACY_INVOICE_TYPES) {
        expect(body, `${legacy} must stay admissible`).toContain(`'${legacy}'::text`);
      }
      expect(body).toContain("'ACCOMMODATION_FINAL_INVOICE'::text");
    });

    it("adds the lifecycle columns as nullable or defaulted, so existing stays stay valid", () => {
      const flat = normalise(MIGRATION_SQL);
      const stayAlter = flat.match(/ALTER TABLE public\.stay_entries ([^;]*?);/i);
      expect(stayAlter).not.toBeNull();
      const clauses = stayAlter![1];
      // The only NOT NULL additions carry a DEFAULT.
      const notNullAdds = matches(
        clauses,
        /ADD COLUMN IF NOT EXISTS (\w+)[^,]*NOT NULL[^,]*/gi
      );
      expect(notNullAdds.sort()).toEqual(["early_checkout_applied", "is_backdated"]);
      expect(clauses).toMatch(/is_backdated BOOLEAN NOT NULL DEFAULT false/i);
      expect(clauses).toMatch(/early_checkout_applied BOOLEAN NOT NULL DEFAULT false/i);

      expect(flat).toMatch(
        /ALTER TABLE public\.payments ADD COLUMN IF NOT EXISTS stay_entry_id UUID REFERENCES public\.stay_entries\(id\)/i
      );
    });
  });

  describe("the constraints carry the specified predicates", () => {
    it("permits at most one ADVANCE per stay (Req 4.5)", () => {
      expect(normalise(MIGRATION_SQL)).toContain(
        "CREATE UNIQUE INDEX IF NOT EXISTS uniq_stay_advance_transaction ON public.stay_payment_transactions(stay_entry_id) WHERE transaction_type = 'ADVANCE'"
      );
    });

    it("permits at most one final invoice per stay (Req 8.6)", () => {
      expect(normalise(MIGRATION_SQL)).toContain(
        "CREATE UNIQUE INDEX IF NOT EXISTS uniq_final_stay_invoice_per_stay ON public.payments(stay_entry_id) WHERE invoice_type = 'ACCOMMODATION_FINAL_INVOICE'"
      );
    });

    it("requires a positive ledger amount and the three transaction types (Req 6.1)", () => {
      const flat = normalise(MIGRATION_SQL);
      expect(flat).toContain(
        "transaction_type IN ('ADVANCE', 'PARTIAL_BALANCE_PAYMENT', 'REFUND')"
      );
      expect(flat).toContain("amount NUMERIC(10,2) NOT NULL CHECK (amount > 0)");
    });

    it("requires actual_nights_stayed to be NULL or at least 1 (Req 12.6)", () => {
      const flat = normalise(MIGRATION_SQL);
      expect(flat).toContain("ADD CONSTRAINT chk_stay_actual_nights");
      expect(flat).toContain(
        "CHECK (actual_nights_stayed IS NULL OR actual_nights_stayed >= 1)"
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Live database half — opt-in via TEST_DATABASE_URL (see src/test/db/README.md)
// ---------------------------------------------------------------------------

const BASELINE_TABLES = ["users", "customer_profiles", "stay_entries", "payments"];

const BASELINE_COLUMNS: Array<[table: string, column: string]> = [
  ["stay_entries", "payment_amount"],
  ["stay_entries", "payment_host_profile_id"],
  ["stay_entries", "status"],
  ["stay_entries", "total_nights"],
  ["payments", "invoice_type"],
];

/**
 * Everything this migration installs, read straight out of the catalog:
 * `information_schema.columns` for shape, `pg_constraint` for the CHECKs and
 * FKs, `pg_indexes` for the two partial unique indexes, plus the trigger,
 * function and view definitions. Two passes must produce byte-identical JSON.
 */
const FINGERPRINT_SQL = `
SELECT json_build_object(
  'columns', (
    SELECT coalesce(json_agg(json_build_object(
             'table', c.table_name, 'column', c.column_name, 'type', c.data_type,
             'max_length', c.character_maximum_length, 'precision', c.numeric_precision,
             'scale', c.numeric_scale, 'nullable', c.is_nullable, 'default', c.column_default)
             ORDER BY c.table_name, c.column_name), '[]'::json)
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND (c.table_name = 'stay_payment_transactions'
        OR (c.table_name = 'stay_entries' AND c.column_name IN (
              ${NEW_STAY_COLUMNS.map((c) => `'${c}'`).join(", ")}))
        OR (c.table_name = 'payments' AND c.column_name = 'stay_entry_id'))
  ),
  'constraints', (
    SELECT coalesce(json_agg(json_build_object(
             'table', rel.relname, 'name', con.conname, 'def', pg_get_constraintdef(con.oid))
             ORDER BY rel.relname, con.conname), '[]'::json)
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname IN ('stay_payment_transactions', 'stay_entries', 'payments')
  ),
  'indexes', (
    SELECT coalesce(json_agg(json_build_object('name', indexname, 'def', indexdef)
             ORDER BY indexname), '[]'::json)
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('stay_payment_transactions', 'stay_entries', 'payments')
  ),
  'triggers', (
    SELECT coalesce(json_agg(json_build_object('name', t.tgname, 'def', pg_get_triggerdef(t.oid))
             ORDER BY t.tgname), '[]'::json)
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname = 'public'
      AND c.relname = 'stay_payment_transactions'
  ),
  'functions', (
    SELECT coalesce(json_agg(json_build_object('name', p.proname,
             'args', pg_get_function_identity_arguments(p.oid),
             'def', pg_get_functiondef(p.oid))
             ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::json)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('record_stay_payment_transaction', 'finalize_stay_checkout',
                        'update_stay_payment_transactions_updated_at')
  ),
  'views', (
    SELECT coalesce(json_agg(json_build_object('name', viewname, 'def', definition)
             ORDER BY viewname), '[]'::json)
    FROM pg_views WHERE schemaname = 'public' AND viewname = 'stay_payment_balances'
  )
) AS fingerprint
`;

/**
 * Row-level digests over the two tables the migration touches, with the columns
 * it ADDS projected away — so the digest is comparable across the migration
 * boundary and any rewrite of an existing value would show up.
 */
const DATA_DIGEST_SQL = `
SELECT json_build_object(
  'payments_total', (SELECT count(*) FROM public.payments),
  'payments_by_type', (
    SELECT coalesce(json_agg(json_build_object('invoice_type', invoice_type, 'n', n)
             ORDER BY invoice_type), '[]'::json)
    FROM (SELECT invoice_type, count(*) AS n FROM public.payments GROUP BY invoice_type) s
  ),
  'accommodation_payments_digest', (
    SELECT md5(coalesce(string_agg((to_jsonb(p) - 'stay_entry_id')::text, '|' ORDER BY p.id), ''))
    FROM public.payments p
    WHERE p.invoice_type IN (${LEGACY_INVOICE_TYPES.filter((t) => t.startsWith("ACCOMMODATION"))
      .map((t) => `'${t}'`)
      .join(", ")})
  ),
  'stay_entries_total', (SELECT count(*) FROM public.stay_entries),
  'stay_entries_digest', (
    SELECT md5(coalesce(string_agg(
             (to_jsonb(se) - ARRAY[${NEW_STAY_COLUMNS.map((c) => `'${c}'`).join(", ")}]::text[])::text,
             '|' ORDER BY se.id), ''))
    FROM public.stay_entries se
  ),
  'ledger_rows', (
    SELECT CASE WHEN EXISTS (
             SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'stay_payment_transactions')
           THEN (SELECT count(*) FROM public.stay_payment_transactions)
           ELSE 0 END
  )
) AS digest
`;

/**
 * Creates a customer, a stay and returns their ids. Shared preamble for the
 * constraint probes below; every probe runs inside BEGIN … ROLLBACK, so nothing
 * survives the test.
 */
const FIXTURE_PREAMBLE = `
  INSERT INTO public.users (full_name, email, mobile, is_active)
  VALUES ('Stay Ledger Probe', 'stay-ledger-' || gen_random_uuid() || '@example.invalid',
          '9000000001', false)
  RETURNING id INTO v_user;

  INSERT INTO public.customer_profiles (user_id) VALUES (v_user) RETURNING id INTO v_profile;

  INSERT INTO public.stay_entries
    (customer_profile_id, start_date, total_nights, stay_type, occupancy_type, status, payment_amount)
  VALUES (v_profile, current_date, 5, 'AC Villa', 'Single', 'ACTIVE', 50000.00)
  RETURNING id INTO v_stay;

  INSERT INTO public.stay_entries
    (customer_profile_id, start_date, total_nights, stay_type, occupancy_type, status, payment_amount)
  VALUES (v_profile, current_date, 5, 'AC Villa', 'Single', 'ACTIVE', 50000.00)
  RETURNING id INTO v_other_stay;
`;

const harnessSkip = harnessSkipReason();
const suiteName = harnessSkip
  ? `Accommodation payment lifecycle migration against a live database — SKIPPED (${harnessSkip})`
  : "Accommodation payment lifecycle migration against a live database";

describe.skipIf(harnessSkip !== null)(suiteName, () => {
  let baselineSkip: string | null = null;
  let fingerprintAfterFirst: unknown;
  let fingerprintAfterSecond: unknown;
  let digestBefore: unknown;
  let digestAfterFirst: unknown;
  let digestAfterSecond: unknown;

  beforeAll(async () => {
    const tables = await queryJson<{ name: string; present: boolean }>(`
      SELECT t.name,
             EXISTS (SELECT 1 FROM information_schema.tables i
                     WHERE i.table_schema = 'public' AND i.table_name = t.name) AS present
      FROM unnest(ARRAY[${BASELINE_TABLES.map((t) => `'${t}'`).join(", ")}]) AS t(name)
    `);
    const missingTables = tables.filter((r) => !r.present).map((r) => r.name);

    const columns = await queryJson<{ label: string; present: boolean }>(`
      SELECT t.label,
             EXISTS (SELECT 1 FROM information_schema.columns c
                     WHERE c.table_schema = 'public'
                       AND c.table_name = split_part(t.label, '.', 1)
                       AND c.column_name = split_part(t.label, '.', 2)) AS present
      FROM unnest(ARRAY[${BASELINE_COLUMNS.map(([t, c]) => `'${t}.${c}'`).join(", ")}])
        AS t(label)
    `);
    const missingColumns = columns.filter((r) => !r.present).map((r) => r.label);

    if (missingTables.length > 0 || missingColumns.length > 0) {
      baselineSkip =
        `the database at ${DB_URL_ENV} is missing the pre-feature baseline — ` +
        `tables: [${missingTables.join(", ") || "none"}], ` +
        `columns: [${missingColumns.join(", ") || "none"}]. ` +
        `Apply create-accommodation-tables.sql (and restore a schema-only dump of ` +
        `users / customer_profiles / payments) first — see src/test/db/README.md.`;
      return;
    }

    digestBefore = (await queryJson(DATA_DIGEST_SQL))[0];

    const first = await execSqlFile(MIGRATION_SCRIPT);
    expect(first.ok, `first pass: ${first.ok ? "" : first.message}`).toBe(true);
    fingerprintAfterFirst = (await queryJson(FINGERPRINT_SQL))[0];
    digestAfterFirst = (await queryJson(DATA_DIGEST_SQL))[0];

    const second = await execSqlFile(MIGRATION_SCRIPT);
    expect(second.ok, `second pass: ${second.ok ? "" : second.message}`).toBe(true);
    fingerprintAfterSecond = (await queryJson(FINGERPRINT_SQL))[0];
    digestAfterSecond = (await queryJson(DATA_DIGEST_SQL))[0];
  }, 300_000);

  it("runs twice with an identical resulting schema", (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    expect(fingerprintAfterSecond).toEqual(fingerprintAfterFirst);
  });

  it("changes no data, leaving existing accommodation payments rows untouched (Req 8.6)", (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    expect(digestAfterFirst).toEqual(digestBefore);
    expect(digestAfterSecond).toEqual(digestBefore);
  });

  it("rejects a second ADVANCE for the same stay via uniq_stay_advance_transaction (Req 4.5)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_user uuid; v_profile uuid; v_stay uuid; v_other_stay uuid;
      BEGIN
        ${FIXTURE_PREAMBLE}

        INSERT INTO public.stay_payment_transactions
          (stay_entry_id, customer_profile_id, transaction_type, amount, transaction_date)
        VALUES (v_stay, v_profile, 'ADVANCE', 10000.00, current_date);

        BEGIN
          INSERT INTO public.stay_payment_transactions
            (stay_entry_id, customer_profile_id, transaction_type, amount, transaction_date)
          VALUES (v_stay, v_profile, 'ADVANCE', 1.00, current_date);
          RAISE EXCEPTION 'ASSERTION FAILED: a second ADVANCE was accepted for the same stay';
        EXCEPTION WHEN unique_violation THEN
          NULL;
        END;

        -- The index is per stay, so another stay may still take its own advance.
        INSERT INTO public.stay_payment_transactions
          (stay_entry_id, customer_profile_id, transaction_type, amount, transaction_date)
        VALUES (v_other_stay, v_profile, 'ADVANCE', 500.00, current_date);

        -- It is partial, so payments and refunds stay unrestricted in number (Req 6.1).
        INSERT INTO public.stay_payment_transactions
          (stay_entry_id, customer_profile_id, transaction_type, amount, transaction_date, comment)
        VALUES (v_stay, v_profile, 'PARTIAL_BALANCE_PAYMENT', 5000.00, current_date, 'first'),
               (v_stay, v_profile, 'PARTIAL_BALANCE_PAYMENT', 5000.00, current_date, 'second'),
               (v_stay, v_profile, 'REFUND', 100.00, current_date, 'r1'),
               (v_stay, v_profile, 'REFUND', 100.00, current_date, 'r2');

        IF (SELECT count(*) FROM public.stay_payment_transactions WHERE stay_entry_id = v_stay) <> 5 THEN
          RAISE EXCEPTION 'ASSERTION FAILED: expected 5 ledger rows for the stay, found %',
            (SELECT count(*) FROM public.stay_payment_transactions WHERE stay_entry_id = v_stay);
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  it("rejects a non-positive ledger amount via the amount > 0 CHECK (Req 6.1)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_user uuid; v_profile uuid; v_stay uuid; v_other_stay uuid;
        v_bad numeric; v_type text;
      BEGIN
        ${FIXTURE_PREAMBLE}

        FOREACH v_bad IN ARRAY ARRAY[0, 0.00, -0.01, -1, -9999999]::numeric[]
        LOOP
          FOREACH v_type IN ARRAY ARRAY['ADVANCE', 'PARTIAL_BALANCE_PAYMENT', 'REFUND']::text[]
          LOOP
            BEGIN
              INSERT INTO public.stay_payment_transactions
                (stay_entry_id, customer_profile_id, transaction_type, amount, transaction_date)
              VALUES (v_stay, v_profile, v_type, v_bad, current_date);
              RAISE EXCEPTION 'ASSERTION FAILED: amount % was accepted for type %', v_bad, v_type;
            EXCEPTION WHEN check_violation THEN
              NULL;
            END;
          END LOOP;
        END LOOP;

        -- The smallest representable positive amount is fine.
        INSERT INTO public.stay_payment_transactions
          (stay_entry_id, customer_profile_id, transaction_type, amount, transaction_date)
        VALUES (v_stay, v_profile, 'PARTIAL_BALANCE_PAYMENT', 0.01, current_date);

        -- An unknown transaction type is refused too (Req 6.1).
        BEGIN
          INSERT INTO public.stay_payment_transactions
            (stay_entry_id, customer_profile_id, transaction_type, amount, transaction_date)
          VALUES (v_stay, v_profile, 'PARTIAL', 100.00, current_date);
          RAISE EXCEPTION 'ASSERTION FAILED: transaction_type PARTIAL was accepted';
        EXCEPTION WHEN check_violation THEN
          NULL;
        END;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  it("rejects a second final invoice per stay via uniq_final_stay_invoice_per_stay (Req 8.6)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_user uuid; v_profile uuid; v_stay uuid; v_other_stay uuid;
      BEGIN
        ${FIXTURE_PREAMBLE}

        INSERT INTO public.payments
          (customer_profile_id, stay_entry_id, payment_method, amount, status, invoice_type)
        VALUES (v_profile, v_stay, 'Manual', 50000.00, 'PAID', 'ACCOMMODATION_FINAL_INVOICE');

        BEGIN
          INSERT INTO public.payments
            (customer_profile_id, stay_entry_id, payment_method, amount, status, invoice_type)
          VALUES (v_profile, v_stay, 'Manual', 50000.00, 'PAID', 'ACCOMMODATION_FINAL_INVOICE');
          RAISE EXCEPTION 'ASSERTION FAILED: a second final invoice was accepted for the same stay';
        EXCEPTION WHEN unique_violation THEN
          NULL;
        END;

        -- One per stay, so a different stay may still get its own.
        INSERT INTO public.payments
          (customer_profile_id, stay_entry_id, payment_method, amount, status, invoice_type)
        VALUES (v_profile, v_other_stay, 'Manual', 50000.00, 'PAID', 'ACCOMMODATION_FINAL_INVOICE');

        -- The index is partial: the historical accommodation rows are unconstrained.
        INSERT INTO public.payments
          (customer_profile_id, stay_entry_id, payment_method, amount, status, invoice_type)
        VALUES (v_profile, v_stay, 'Manual', 25000.00, 'PAID', 'ACCOMMODATION_STAY'),
               (v_profile, v_stay, 'Manual', 25000.00, 'PAID', 'ACCOMMODATION_STAY'),
               (v_profile, v_stay, 'Manual', 5000.00, 'PAID', 'ACCOMMODATION_EXTENSION'),
               (v_profile, v_stay, 'Manual', 5000.00, 'PAID', 'ACCOMMODATION_EXTENSION');

        IF (SELECT count(*) FROM public.payments WHERE stay_entry_id = v_stay) <> 5 THEN
          RAISE EXCEPTION 'ASSERTION FAILED: expected 5 payments rows for the stay, found %',
            (SELECT count(*) FROM public.payments WHERE stay_entry_id = v_stay);
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  it("rejects an out-of-range actual_nights_stayed via chk_stay_actual_nights (Req 12.6)", async (ctx) => {
    if (baselineSkip) return ctx.skip(baselineSkip);
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      DECLARE
        v_user uuid; v_profile uuid; v_stay uuid; v_other_stay uuid;
        v_bad int;
      BEGIN
        ${FIXTURE_PREAMBLE}

        FOREACH v_bad IN ARRAY ARRAY[0, -1, -365]
        LOOP
          BEGIN
            UPDATE public.stay_entries SET actual_nights_stayed = v_bad WHERE id = v_stay;
            RAISE EXCEPTION 'ASSERTION FAILED: actual_nights_stayed = % was accepted', v_bad;
          EXCEPTION WHEN check_violation THEN
            NULL;
          END;
        END LOOP;

        -- A direct INSERT cannot bypass it either.
        BEGIN
          INSERT INTO public.stay_entries
            (customer_profile_id, start_date, total_nights, stay_type, occupancy_type,
             status, payment_amount, actual_nights_stayed, early_checkout_applied)
          VALUES (v_profile, current_date, 5, 'AC Villa', 'Single', 'ACTIVE', 50000.00, 0, true);
          RAISE EXCEPTION 'ASSERTION FAILED: inserting actual_nights_stayed = 0 was accepted';
        EXCEPTION WHEN check_violation THEN
          NULL;
        END;

        -- NULL (never early-checked-out) and any value >= 1 are admissible.
        UPDATE public.stay_entries SET actual_nights_stayed = NULL WHERE id = v_stay;
        UPDATE public.stay_entries SET actual_nights_stayed = 1 WHERE id = v_stay;
        UPDATE public.stay_entries SET actual_nights_stayed = 4 WHERE id = v_stay;

        IF (SELECT actual_nights_stayed FROM public.stay_entries WHERE id = v_stay) <> 4 THEN
          RAISE EXCEPTION 'ASSERTION FAILED: actual_nights_stayed did not persist';
        END IF;

        -- Every pre-existing stay keeps the additive defaults.
        IF (SELECT is_backdated OR early_checkout_applied FROM public.stay_entries
              WHERE id = v_other_stay) THEN
          RAISE EXCEPTION 'ASSERTION FAILED: lifecycle flags did not default to false';
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });
});
