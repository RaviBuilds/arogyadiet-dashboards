/**
 * Feature: accommodation-payment-lifecycle, Task 4.3 — integration tests for
 * the two row-locking RPCs installed by `scripts/create-stay-payment-lifecycle.sql`:
 * `record_stay_payment_transaction()` and `finalize_stay_checkout()`.
 *
 * Validates: Requirements 5.5, 6.3, 7.4, 7.5, 12.9
 *
 *   5.5   `record_stay_payment_transaction` rejects an amount greater than the
 *         Remaining_Balance with `AMOUNT_EXCEEDS_BALANCE` and the authoritative
 *         remaining balance.
 *   6.3   Total_Paid, as computed by the RPC and by the `stay_payment_balances`
 *         reporting view, matches `AccommodationService.deriveStayBalance`.
 *   7.4   `finalize_stay_checkout` rejects an outstanding (non-zero) balance with
 *         `BALANCE_OUTSTANDING` and the authoritative remaining balance.
 *   7.5   `finalize_stay_checkout` rejects a non-ACTIVE stay with `NOT_ACTIVE`
 *         and the current status.
 *  12.9   A REFUND greater than the excess already paid (`max(0, -remaining)`)
 *         is rejected with `REFUND_EXCEEDS_EXCESS` and the correct excess.
 *
 * Scope note: `migration.integration.test.ts` (task 1.7) fingerprints these two
 * functions' *definitions* so a re-run of the migration cannot silently change
 * them, and covers the four schema-level constraints (unique indexes, the
 * `amount > 0` CHECK, `chk_stay_actual_nights`). This file is the RPCs'
 * *behavioural* counterpart — task 1.7 explicitly deferred concurrency, refund
 * gating, checkout gating, and balance parity here.
 *
 * Opt-in via `TEST_DATABASE_URL` (see `src/test/db/README.md`), skips with a
 * self-describing reason otherwise so `npm test` stays green with no database
 * configured. `.env.local` is never read.
 *
 * Every probe that only needs a pass/fail verdict runs inside `BEGIN … ROLLBACK`,
 * reusing task 1.7's `FIXTURE_PREAMBLE` pattern (a user, a profile, one or two
 * stays) so nothing it writes survives. The balance-parity probe additionally
 * needs the RPC's *returned values*, not just a pass/fail — it gets them without
 * ever committing a mutating row by deliberately submitting a transaction sized
 * to be rejected (see "Balance parity" below), so it can also run inside
 * `BEGIN … ROLLBACK`.
 *
 * The one exception is the concurrency probe (Req 5.5): two genuinely
 * concurrent callers cannot share a single `BEGIN … ROLLBACK` block and still
 * race — each needs its own connection. Two `psql` subprocesses raced via
 * `Promise.all` (exactly the mechanism `src/test/dietitian/concurrency-and-auth.integration.test.ts`
 * already uses for the Franchise Dietitian uniqueness race) give a REAL race
 * between two independent sessions, not a proxy for one — so this is genuine
 * concurrency, not the "sequential serialization" fallback the task
 * description allows for. Its fixture is therefore committed (not rolled back)
 * and torn down explicitly with `DELETE` once the race has been observed.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { deriveStayBalance } from "@/services/AccommodationService";
import type { StayPaymentTransaction } from "@/types/accommodation";

import { DB_URL_ENV, execSql, harnessSkipReason, queryJson } from "../db/sqlRunner";

// ---------------------------------------------------------------------------
// Helpers shared by every probe
// ---------------------------------------------------------------------------

/** A distinct mobile prefix for this file, away from other integration suites' fixtures. */
let mobileCounter = 90000700;
function nextMobile(): string {
  mobileCounter += 1;
  return String(mobileCounter);
}

/** Minimal but fully-typed `StayPaymentTransaction` for feeding `deriveStayBalance`. */
function makeTx(
  transactionType: StayPaymentTransaction["transactionType"],
  amount: number,
  index: number
): StayPaymentTransaction {
  return {
    id: randomUUID(),
    stayEntryId: "00000000-0000-4000-8000-000000000000",
    customerProfileId: "00000000-0000-4000-8000-000000000000",
    transactionType,
    amount,
    transactionDate: "2025-01-15",
    comment: null,
    remark: null,
    createdBy: null,
    createdAt: new Date(Date.UTC(2025, 0, 15, 0, 0, index)).toISOString(),
  };
}

/** Formats a rupee amount as a SQL numeric literal at exact paise precision. */
function sqlAmount(rupees: number): string {
  return (Math.round(rupees * 100) / 100).toFixed(2);
}

/**
 * A fresh user + customer_profile + one stay_entries row, matching task 1.7's
 * `FIXTURE_PREAMBLE` shape. Declares `v_user`, `v_profile`, `v_stay` for use by
 * the surrounding `DO $do$ … $do$` block. Every caller wraps this in
 * `BEGIN; DO $do$ … END $do$; ROLLBACK;` so nothing persists.
 */
function fixturePreamble(options: {
  status?: "PENDING" | "ACTIVE" | "FINISHED" | "EXPIRED";
  paymentAmount?: number | null;
  sharedPaymentHost?: boolean;
}): string {
  const { status = "ACTIVE", paymentAmount = 10000, sharedPaymentHost = false } = options;
  const paymentAmountLiteral = paymentAmount === null ? "NULL" : sqlAmount(paymentAmount);

  return `
  INSERT INTO public.users (full_name, email, mobile, is_active)
  VALUES ('Stay RPC Probe', 'stay-rpc-' || gen_random_uuid() || '@example.invalid',
          '${nextMobile()}', false)
  RETURNING id INTO v_user;

  INSERT INTO public.customer_profiles (user_id) VALUES (v_user) RETURNING id INTO v_profile;

  ${
    sharedPaymentHost
      ? `
  INSERT INTO public.users (full_name, email, mobile, is_active)
  VALUES ('Stay RPC Host Probe', 'stay-rpc-host-' || gen_random_uuid() || '@example.invalid',
          '${nextMobile()}', false)
  RETURNING id INTO v_host_user;

  INSERT INTO public.customer_profiles (user_id) VALUES (v_host_user) RETURNING id INTO v_host_profile;
  `
      : ""
  }

  INSERT INTO public.stay_entries
    (customer_profile_id, start_date, total_nights, stay_type, occupancy_type, status,
     payment_amount, payment_host_profile_id)
  VALUES (v_profile, current_date, 5, 'AC Villa', 'Single', '${status}',
          ${paymentAmountLiteral}, ${sharedPaymentHost ? "v_host_profile" : "NULL"})
  RETURNING id INTO v_stay;
  `;
}

const DECLARE_BLOCK = `
DECLARE
  v_user uuid; v_profile uuid; v_stay uuid;
  v_host_user uuid; v_host_profile uuid;
  v_probe jsonb;
`;

const harnessSkip = harnessSkipReason();
const suiteName = harnessSkip
  ? `Accommodation payment lifecycle RPCs against a live database — SKIPPED (${harnessSkip})`
  : "Accommodation payment lifecycle RPCs against a live database";

describe.skipIf(harnessSkip !== null)(suiteName, () => {
  let baselineSkip: string | null = null;

  async function ensureBaseline(): Promise<string | null> {
    if (baselineSkip !== undefined && baselineSkip !== null) return baselineSkip;

    const tables = await queryJson<{ name: string; present: boolean }>(`
      SELECT t.name,
             EXISTS (SELECT 1 FROM information_schema.tables i
                     WHERE i.table_schema = 'public' AND i.table_name = t.name) AS present
      FROM unnest(ARRAY['users', 'customer_profiles', 'stay_entries', 'payments',
                        'stay_payment_transactions']) AS t(name)
    `);
    const missingTables = tables.filter((r) => !r.present).map((r) => r.name);

    const objects = await queryJson<{ name: string; present: boolean }>(`
      SELECT t.name,
             EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public' AND p.proname = t.name) AS present
      FROM unnest(ARRAY['record_stay_payment_transaction', 'finalize_stay_checkout']) AS t(name)
    `);
    const missingObjects = objects.filter((r) => !r.present).map((r) => r.name);

    const view = await queryJson<{ present: boolean }>(`
      SELECT EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public'
                     AND viewname = 'stay_payment_balances') AS present
    `);

    if (missingTables.length > 0 || missingObjects.length > 0 || !view[0]?.present) {
      baselineSkip =
        `the database at ${DB_URL_ENV} is missing prerequisites for this suite — ` +
        `tables: [${missingTables.join(", ") || "none"}], ` +
        `functions: [${missingObjects.join(", ") || "none"}], ` +
        `stay_payment_balances view present: ${view[0]?.present ?? false}. ` +
        `Apply create-accommodation-tables.sql then create-stay-payment-lifecycle.sql ` +
        `first — see src/test/db/README.md.`;
      return baselineSkip;
    }

    baselineSkip = null;
    return null;
  }

  // -------------------------------------------------------------------------
  // record_stay_payment_transaction — refund beyond excess rejected (Req 12.9)
  // -------------------------------------------------------------------------

  it("rejects a REFUND greater than the excess with REFUND_EXCEEDS_EXCESS and the correct excess (Req 12.9)", async (ctx) => {
    const skip = await ensureBaseline();
    if (skip) return ctx.skip(skip);

    // Total 10,000; ADVANCE of 15,000 inserted directly (bypassing the RPC,
    // exactly like task 1.7's fixtures do) so the stay is overpaid by 5,000 —
    // the excess a refund must not be allowed to exceed.
    const outcome = await execSql(`
      BEGIN;
      DO $do$
      ${DECLARE_BLOCK}
      BEGIN
        ${fixturePreamble({ status: "ACTIVE", paymentAmount: 10000 })}

        INSERT INTO public.stay_payment_transactions
          (stay_entry_id, customer_profile_id, transaction_type, amount, transaction_date)
        VALUES (v_stay, v_profile, 'ADVANCE', ${sqlAmount(15000)}, current_date);

        -- Exactly the excess (5,000) is refundable.
        SELECT public.record_stay_payment_transaction(
          v_stay, 'REFUND', ${sqlAmount(5000)}, current_date, NULL, 'refund at excess', NULL
        ) INTO v_probe;
        IF (v_probe->>'ok')::boolean IS NOT TRUE THEN
          RAISE EXCEPTION 'ASSERTION FAILED: refund of exactly the excess was rejected: %', v_probe;
        END IF;

        -- One paise beyond the excess must be rejected, with the correct excess.
        SELECT public.record_stay_payment_transaction(
          v_stay, 'REFUND', ${sqlAmount(0.01)}, current_date, NULL, 'refund beyond excess', NULL
        ) INTO v_probe;
        IF (v_probe->>'ok')::boolean IS TRUE THEN
          RAISE EXCEPTION 'ASSERTION FAILED: refund beyond the excess was accepted: %', v_probe;
        END IF;
        IF (v_probe->>'reason') <> 'REFUND_EXCEEDS_EXCESS' THEN
          RAISE EXCEPTION 'ASSERTION FAILED: expected reason REFUND_EXCEEDS_EXCESS, got %', v_probe->>'reason';
        END IF;
        -- Excess is now 0 (the first refund consumed it).
        IF round((v_probe->>'excess')::numeric, 2) <> 0.00 THEN
          RAISE EXCEPTION 'ASSERTION FAILED: expected excess 0.00, got %', v_probe->'excess';
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  it("rejects any REFUND when there is no excess yet, reporting excess = 0 (Req 12.9)", async (ctx) => {
    const skip = await ensureBaseline();
    if (skip) return ctx.skip(skip);

    const outcome = await execSql(`
      BEGIN;
      DO $do$
      ${DECLARE_BLOCK}
      BEGIN
        ${fixturePreamble({ status: "ACTIVE", paymentAmount: 20000 })}
        -- No transactions at all: remaining balance is the full total, so
        -- there is no excess to refund.
        SELECT public.record_stay_payment_transaction(
          v_stay, 'REFUND', ${sqlAmount(1)}, current_date, NULL, 'no excess yet', NULL
        ) INTO v_probe;
        IF (v_probe->>'ok')::boolean IS TRUE THEN
          RAISE EXCEPTION 'ASSERTION FAILED: refund with no excess was accepted: %', v_probe;
        END IF;
        IF (v_probe->>'reason') <> 'REFUND_EXCEEDS_EXCESS' THEN
          RAISE EXCEPTION 'ASSERTION FAILED: expected reason REFUND_EXCEEDS_EXCESS, got %', v_probe->>'reason';
        END IF;
        IF round((v_probe->>'excess')::numeric, 2) <> 0.00 THEN
          RAISE EXCEPTION 'ASSERTION FAILED: expected excess 0.00, got %', v_probe->'excess';
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  // -------------------------------------------------------------------------
  // record_stay_payment_transaction — shared-payment stay rejected
  // -------------------------------------------------------------------------

  it("rejects every transaction type for a shared-payment stay with SHARED_PAYMENT", async (ctx) => {
    const skip = await ensureBaseline();
    if (skip) return ctx.skip(skip);

    const outcome = await execSql(`
      BEGIN;
      DO $do$
      ${DECLARE_BLOCK}
      DECLARE
        v_type text;
      BEGIN
        ${fixturePreamble({ status: "ACTIVE", paymentAmount: null, sharedPaymentHost: true })}

        FOREACH v_type IN ARRAY ARRAY['ADVANCE', 'PARTIAL_BALANCE_PAYMENT', 'REFUND']::text[]
        LOOP
          SELECT public.record_stay_payment_transaction(
            v_stay, v_type, ${sqlAmount(100)}, current_date, NULL, NULL, NULL
          ) INTO v_probe;
          IF (v_probe->>'ok')::boolean IS TRUE THEN
            RAISE EXCEPTION 'ASSERTION FAILED: % was accepted for a shared-payment stay: %', v_type, v_probe;
          END IF;
          IF (v_probe->>'reason') <> 'SHARED_PAYMENT' THEN
            RAISE EXCEPTION 'ASSERTION FAILED: expected reason SHARED_PAYMENT for %, got %', v_type, v_probe->>'reason';
          END IF;
        END LOOP;

        -- No row was inserted for the shared-payment stay.
        IF (SELECT count(*) FROM public.stay_payment_transactions WHERE stay_entry_id = v_stay) <> 0 THEN
          RAISE EXCEPTION 'ASSERTION FAILED: a ledger row was inserted for a shared-payment stay';
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  // -------------------------------------------------------------------------
  // finalize_stay_checkout — outstanding balance and non-ACTIVE status
  // (Req 7.4, 7.5)
  // -------------------------------------------------------------------------

  it("rejects finalize_stay_checkout with BALANCE_OUTSTANDING and the authoritative remaining balance (Req 7.4)", async (ctx) => {
    const skip = await ensureBaseline();
    if (skip) return ctx.skip(skip);

    const outcome = await execSql(`
      BEGIN;
      DO $do$
      ${DECLARE_BLOCK}
      BEGIN
        ${fixturePreamble({ status: "ACTIVE", paymentAmount: 30000 })}

        INSERT INTO public.stay_payment_transactions
          (stay_entry_id, customer_profile_id, transaction_type, amount, transaction_date)
        VALUES (v_stay, v_profile, 'ADVANCE', ${sqlAmount(12000)}, current_date);

        SELECT public.finalize_stay_checkout(v_stay) INTO v_probe;
        IF (v_probe->>'ok')::boolean IS TRUE THEN
          RAISE EXCEPTION 'ASSERTION FAILED: checkout succeeded with an outstanding balance: %', v_probe;
        END IF;
        IF (v_probe->>'reason') <> 'BALANCE_OUTSTANDING' THEN
          RAISE EXCEPTION 'ASSERTION FAILED: expected reason BALANCE_OUTSTANDING, got %', v_probe->>'reason';
        END IF;
        IF round((v_probe->>'remaining_balance')::numeric, 2) <> ${sqlAmount(18000)}::numeric THEN
          RAISE EXCEPTION 'ASSERTION FAILED: expected remaining_balance 18000.00, got %', v_probe->'remaining_balance';
        END IF;

        -- The stay must still be ACTIVE — nothing was finalised.
        IF (SELECT status FROM public.stay_entries WHERE id = v_stay) <> 'ACTIVE' THEN
          RAISE EXCEPTION 'ASSERTION FAILED: stay status changed despite the rejected checkout';
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  it("rejects finalize_stay_checkout for a negative (refund-due) balance too — the gate is exact zero (Req 7.4)", async (ctx) => {
    const skip = await ensureBaseline();
    if (skip) return ctx.skip(skip);

    const outcome = await execSql(`
      BEGIN;
      DO $do$
      ${DECLARE_BLOCK}
      BEGIN
        ${fixturePreamble({ status: "ACTIVE", paymentAmount: 10000 })}

        INSERT INTO public.stay_payment_transactions
          (stay_entry_id, customer_profile_id, transaction_type, amount, transaction_date)
        VALUES (v_stay, v_profile, 'ADVANCE', ${sqlAmount(14000)}, current_date);

        SELECT public.finalize_stay_checkout(v_stay) INTO v_probe;
        IF (v_probe->>'ok')::boolean IS TRUE THEN
          RAISE EXCEPTION 'ASSERTION FAILED: checkout succeeded with a refund still due: %', v_probe;
        END IF;
        IF (v_probe->>'reason') <> 'BALANCE_OUTSTANDING' THEN
          RAISE EXCEPTION 'ASSERTION FAILED: expected reason BALANCE_OUTSTANDING, got %', v_probe->>'reason';
        END IF;
        IF round((v_probe->>'remaining_balance')::numeric, 2) <> ${sqlAmount(-4000)}::numeric THEN
          RAISE EXCEPTION 'ASSERTION FAILED: expected remaining_balance -4000.00, got %', v_probe->'remaining_balance';
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  it("rejects finalize_stay_checkout for a non-ACTIVE stay with NOT_ACTIVE and the current status (Req 7.5)", async (ctx) => {
    const skip = await ensureBaseline();
    if (skip) return ctx.skip(skip);

    const outcome = await execSql(`
      BEGIN;
      DO $do$
      ${DECLARE_BLOCK}
      DECLARE
        v_status text;
      BEGIN
        FOREACH v_status IN ARRAY ARRAY['PENDING', 'FINISHED', 'EXPIRED']::text[]
        LOOP
          ${fixturePreamble({ status: "ACTIVE", paymentAmount: 5000 })}
          -- Force the exact status under test directly, so a fully-paid
          -- FINISHED stay is exercised too (BALANCE_OUTSTANDING must not fire
          -- first — NOT_ACTIVE is checked before the balance).
          UPDATE public.stay_entries SET status = v_status WHERE id = v_stay;

          SELECT public.finalize_stay_checkout(v_stay) INTO v_probe;
          IF (v_probe->>'ok')::boolean IS TRUE THEN
            RAISE EXCEPTION 'ASSERTION FAILED: checkout succeeded for a % stay: %', v_status, v_probe;
          END IF;
          IF (v_probe->>'reason') <> 'NOT_ACTIVE' THEN
            RAISE EXCEPTION 'ASSERTION FAILED: expected reason NOT_ACTIVE for %, got %', v_status, v_probe->>'reason';
          END IF;
          IF (v_probe->>'status') <> v_status THEN
            RAISE EXCEPTION 'ASSERTION FAILED: expected status % in the response, got %', v_status, v_probe->>'status';
          END IF;
        END LOOP;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  it("rejects finalize_stay_checkout for an unknown stay id with NOT_FOUND", async (ctx) => {
    const skip = await ensureBaseline();
    if (skip) return ctx.skip(skip);

    const outcome = await execSql(`
      BEGIN;
      DO $do$
      ${DECLARE_BLOCK}
      BEGIN
        SELECT public.finalize_stay_checkout('${randomUUID()}') INTO v_probe;
        IF (v_probe->>'ok')::boolean IS TRUE THEN
          RAISE EXCEPTION 'ASSERTION FAILED: checkout succeeded for a non-existent stay: %', v_probe;
        END IF;
        IF (v_probe->>'reason') <> 'NOT_FOUND' THEN
          RAISE EXCEPTION 'ASSERTION FAILED: expected reason NOT_FOUND, got %', v_probe->>'reason';
        END IF;
      END
      $do$;
      ROLLBACK;
    `);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  // -------------------------------------------------------------------------
  // record_stay_payment_transaction — genuine concurrency (Req 5.5)
  // -------------------------------------------------------------------------

  /**
   * Two concurrent calls that each individually fit the remaining balance but
   * together would overdraw it — exactly one must succeed.
   *
   * This is GENUINE concurrency, not a sequential-serialization proxy: each
   * call is issued from its own `psql` subprocess (its own Postgres backend
   * connection/session), raced via `Promise.all`, mirroring the mechanism
   * `src/test/dietitian/concurrency-and-auth.integration.test.ts` already uses
   * for the Franchise Dietitian uniqueness race. Because that requires two
   * separate sessions, the fixture cannot live inside a single
   * `BEGIN … ROLLBACK` (a transaction is confined to the session that opened
   * it) — it is committed for real via plain autocommit statements and torn
   * down explicitly with `DELETE` once the race has been observed, exactly as
   * the dietitian suite does.
   */
  it("lets exactly one of two concurrent record_stay_payment_transaction calls succeed when together they would overdraw the balance (Req 5.5)", async (ctx) => {
    const skip = await ensureBaseline();
    if (skip) return ctx.skip(skip);

    const userId = randomUUID();
    const profileId = randomUUID();
    const stayId = randomUUID();
    const mobile = nextMobile();

    // Fixture: Total_Stay_Amount 10,000; a committed ADVANCE of 6,000 leaves a
    // Remaining_Balance of 4,000. Two concurrent PARTIAL_BALANCE_PAYMENT calls
    // of 3,000 each individually fit within 4,000, but together (6,000) would
    // overdraw it — exactly the race Req 5.5 requires the row lock to prevent.
    const setup = await execSql(`
      INSERT INTO public.users (id, full_name, email, mobile, is_active)
      VALUES ('${userId}', 'Stay RPC Race Probe', 'stay-rpc-race-${userId}@example.invalid',
              '${mobile}', false);

      INSERT INTO public.customer_profiles (id, user_id) VALUES ('${profileId}', '${userId}');

      INSERT INTO public.stay_entries
        (id, customer_profile_id, start_date, total_nights, stay_type, occupancy_type,
         status, payment_amount)
      VALUES ('${stayId}', '${profileId}', current_date, 5, 'AC Villa', 'Single', 'ACTIVE',
              ${sqlAmount(10000)});

      INSERT INTO public.stay_payment_transactions
        (stay_entry_id, customer_profile_id, transaction_type, amount, transaction_date)
      VALUES ('${stayId}', '${profileId}', 'ADVANCE', ${sqlAmount(6000)}, current_date);
    `);
    expect(setup.ok, setup.ok ? "" : setup.message).toBe(true);

    try {
      const raceCall = (label: string) =>
        queryJson<{ result: { ok: boolean; reason?: string; remaining_balance?: number } }>(`
          SELECT public.record_stay_payment_transaction(
            '${stayId}', 'PARTIAL_BALANCE_PAYMENT', ${sqlAmount(3000)}, current_date,
            'concurrent ${label}', NULL, NULL
          ) AS result
        `);

      const [rowsA, rowsB] = await Promise.all([raceCall("A"), raceCall("B")]);
      const resultA = rowsA[0]!.result;
      const resultB = rowsB[0]!.result;

      const outcomes = [resultA, resultB];
      const winners = outcomes.filter((r) => r.ok === true);
      const losers = outcomes.filter((r) => r.ok !== true);

      // The row lock inside the RPC serialises the two sessions, so the
      // second to acquire the lock sees the first's committed effect — this
      // is what makes "exactly one succeeds" true under a REAL race, with no
      // application-level coordination between the two calls at all.
      expect(winners.length).toBe(1);
      expect(losers.length).toBe(1);
      expect(losers[0]!.reason).toBe("AMOUNT_EXCEEDS_BALANCE");
      // Deterministic regardless of which of the two wins the race: the loser
      // always observes the balance AFTER the winner's 3,000 was applied —
      // 4,000 - 3,000 = 1,000 — because the lock forces strict before/after
      // ordering between the two sessions.
      expect(Math.round(Number(losers[0]!.remaining_balance) * 100)).toBe(100_000);

      const ledgerCount = await queryJson<{ n: string }>(`
        SELECT count(*)::text AS n FROM public.stay_payment_transactions
        WHERE stay_entry_id = '${stayId}'
      `);
      // The onboarding ADVANCE plus exactly one of the two PARTIAL_BALANCE_PAYMENT calls.
      expect(Number(ledgerCount[0]!.n)).toBe(2);
    } finally {
      // This fixture is committed for real (two separate sessions cannot
      // share one rollback-able transaction) — clean up explicitly.
      await execSql(`
        DELETE FROM public.stay_payment_transactions WHERE stay_entry_id = '${stayId}';
        DELETE FROM public.stay_entries WHERE id = '${stayId}';
        DELETE FROM public.customer_profiles WHERE id = '${profileId}';
        DELETE FROM public.users WHERE id = '${userId}';
      `);
    }
  }, 30_000);

  // -------------------------------------------------------------------------
  // Balance parity — the SQL formula (RPC and stay_payment_balances) matches
  // AccommodationService.deriveStayBalance (Req 6.3)
  // -------------------------------------------------------------------------

  interface LedgerScenario {
    name: string;
    totalStayAmount: number;
    txs: Array<{ type: StayPaymentTransaction["transactionType"]; amount: number }>;
  }

  /**
   * A fixed, representative set of ledger shapes mirroring what
   * `arbLedgerWith` (task 1.4) describes: empty, advance-only,
   * advance+partials, refund-heavy (overpaid), and a fully mixed ledger with
   * paise-bearing amounts. A fixed set rather than a full property run, since
   * this probe is SQL-backed (one round trip per scenario) — task 1.7 took
   * the same approach for the migration's constraint checks.
   */
  const LEDGER_SCENARIOS: LedgerScenario[] = [
    { name: "empty ledger", totalStayAmount: 50000, txs: [] },
    {
      name: "advance only",
      totalStayAmount: 50000,
      txs: [{ type: "ADVANCE", amount: 20000 }],
    },
    {
      name: "advance + partials",
      totalStayAmount: 75000,
      txs: [
        { type: "ADVANCE", amount: 15000 },
        { type: "PARTIAL_BALANCE_PAYMENT", amount: 30000 },
        { type: "PARTIAL_BALANCE_PAYMENT", amount: 30000 },
      ],
    },
    {
      name: "refund-heavy (overpaid, negative remaining balance)",
      totalStayAmount: 40000,
      txs: [
        { type: "ADVANCE", amount: 40000 },
        { type: "PARTIAL_BALANCE_PAYMENT", amount: 20000 },
        { type: "REFUND", amount: 15000 },
        { type: "REFUND", amount: 5000 },
      ],
    },
    {
      name: "fully mixed, paise-bearing amounts",
      totalStayAmount: 12345.67,
      txs: [
        { type: "ADVANCE", amount: 1000.01 },
        { type: "PARTIAL_BALANCE_PAYMENT", amount: 5000.33 },
        { type: "REFUND", amount: 100.5 },
        { type: "PARTIAL_BALANCE_PAYMENT", amount: 6444.83 },
      ],
    },
  ];

  it("the SQL balance formula (RPC and stay_payment_balances) matches deriveStayBalance across a seeded set of ledgers (Req 6.3)", async (ctx) => {
    const skip = await ensureBaseline();
    if (skip) return ctx.skip(skip);

    for (const scenario of LEDGER_SCENARIOS) {
      // (a) The reference: AccommodationService.deriveStayBalance computed in
      // TS from the exact same transaction list.
      const transactions = scenario.txs.map((tx, index) => makeTx(tx.type, tx.amount, index));
      const reference = deriveStayBalance(scenario.totalStayAmount, transactions);
      const expectedTotalPaidPaise = Math.round(reference.totalPaid * 100);
      const expectedRemainingPaise = Math.round(reference.remainingBalance * 100);

      const ledgerInsertSql =
        scenario.txs.length === 0
          ? ""
          : `
        INSERT INTO public.stay_payment_transactions
          (stay_entry_id, customer_profile_id, transaction_type, amount, transaction_date)
        VALUES
        ${scenario.txs
          .map((tx) => `(v_stay, v_profile, '${tx.type}', ${sqlAmount(tx.amount)}, current_date)`)
          .join(",\n        ")};
      `;

      // An amount guaranteed to exceed the Remaining_Balance for ANY ledger
      // against this total (remaining_balance <= total_stay_amount always),
      // so the RPC call below is a read-only probe: it is always rejected
      // with AMOUNT_EXCEEDS_BALANCE and never inserts a row, letting
      // (b) — the RPC's authoritative remaining_balance — be read without
      // ever committing a mutation.
      const excessiveProbeAmount = scenario.totalStayAmount + 1_000_000;

      const outcome = await execSql(`
        BEGIN;
        DO $do$
        ${DECLARE_BLOCK}
        DECLARE
          v_view_total_paid numeric;
          v_view_remaining numeric;
        BEGIN
          ${fixturePreamble({ status: "ACTIVE", paymentAmount: scenario.totalStayAmount })}
          ${ledgerInsertSql}

          -- (c) The stay_payment_balances reporting view, read directly.
          SELECT total_paid, remaining_balance INTO v_view_total_paid, v_view_remaining
            FROM public.stay_payment_balances WHERE stay_entry_id = v_stay;

          IF round(v_view_total_paid * 100) <> ${expectedTotalPaidPaise} THEN
            RAISE EXCEPTION
              'ASSERTION FAILED [%]: stay_payment_balances.total_paid = % (paise), expected % (paise)',
              '${scenario.name}', round(v_view_total_paid * 100), ${expectedTotalPaidPaise};
          END IF;
          IF round(v_view_remaining * 100) <> ${expectedRemainingPaise} THEN
            RAISE EXCEPTION
              'ASSERTION FAILED [%]: stay_payment_balances.remaining_balance = % (paise), expected % (paise)',
              '${scenario.name}', round(v_view_remaining * 100), ${expectedRemainingPaise};
          END IF;

          -- (b) The RPC's authoritative remaining_balance, via a read-only
          -- probe that is always rejected and never mutates the ledger.
          SELECT public.record_stay_payment_transaction(
            v_stay, 'PARTIAL_BALANCE_PAYMENT', ${sqlAmount(excessiveProbeAmount)},
            current_date, NULL, NULL, NULL
          ) INTO v_probe;

          IF (v_probe->>'reason') <> 'AMOUNT_EXCEEDS_BALANCE' THEN
            RAISE EXCEPTION
              'ASSERTION FAILED [%]: expected the read-only probe to be rejected with AMOUNT_EXCEEDS_BALANCE, got %',
              '${scenario.name}', v_probe;
          END IF;
          IF round((v_probe->>'remaining_balance')::numeric * 100) <> ${expectedRemainingPaise} THEN
            RAISE EXCEPTION
              'ASSERTION FAILED [%]: record_stay_payment_transaction remaining_balance = % (paise), expected % (paise)',
              '${scenario.name}', round((v_probe->>'remaining_balance')::numeric * 100), ${expectedRemainingPaise};
          END IF;

          -- The read-only probe must not have inserted anything.
          IF (SELECT count(*) FROM public.stay_payment_transactions WHERE stay_entry_id = v_stay)
             <> ${scenario.txs.length} THEN
            RAISE EXCEPTION
              'ASSERTION FAILED [%]: the read-only probe mutated the ledger', '${scenario.name}';
          END IF;
        END
        $do$;
        ROLLBACK;
      `);
      expect(outcome.ok, `[${scenario.name}] ${outcome.ok ? "" : outcome.message}`).toBe(true);
    }
  }, 60_000);
});
