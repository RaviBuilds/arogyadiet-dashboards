/**
 * Feature: accommodation-payment-lifecycle (Revision 2), Task 17.4 —
 * integration tests for the two new RPCs (`save_stay_details` and
 * `record_stay_refund_with_invoice`) exercised through their repository
 * wrappers (`stayRepository.saveStayDetails` and
 * `stayPaymentRepository.recordRefundWithInvoice`).
 *
 * Validates: Requirements 12.16, 13.2, 14.8, 14.9
 *
 *  12.16  `save_stay_details()` is atomic: each reason mapped correctly under
 *         real constraints; a no-op submission returns `historyRecorded: false`
 *         with zero history rows; `original_total_*` pinned across repeated
 *         submissions.
 *  13.2   History rows are only written when something changed.
 *  14.8   `record_stay_refund_with_invoice()` writes ledger row and `payments`
 *         row committed together; forced invoice failure leaves neither and
 *         Total_Paid is unchanged.
 *  14.9   A second Refund_Invoice for the same transaction is impossible.
 *
 * Structure:
 *   Part 1 — Repository contract tests (no database, mocked Supabase client).
 *   Part 2 — Live database (opt-in via TEST_DATABASE_URL, skipped by default).
 *
 * Follows the pattern of `recalculationMigration.integration.test.ts` (task 13.2).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { execSql, harnessSkipReason } from "../db/sqlRunner";

// ===========================================================================
// Part 1 — Repository contract tests (no database required)
// ===========================================================================

/**
 * Mock the Supabase admin client. Each test configures what `.rpc()` returns,
 * and we verify the repository correctly maps the RPC result into the typed
 * outcome.
 */
const mockRpc = vi.fn();
const mockSupabase = { rpc: mockRpc };

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockSupabase,
}));

// Import AFTER the mock is set up.
const stayRepository = await import("@/repositories/stayRepository");
const stayPaymentRepository = await import("@/repositories/stayPaymentRepository");

describe("Part 1: Repository contract tests (no database)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // saveStayDetails — reason mapping
  // -------------------------------------------------------------------------
  describe("stayRepository.saveStayDetails — reason mapping", () => {
    const baseInput = {
      stayId: "stay-1",
      recalculatedEndDate: "2025-07-10",
      recalculatedTotalNights: 5,
      recalculatedStayAmount: 50000,
      gst: { baseAmount: 42372.88, taxAmount: 7627.12 },
      recalculatedOn: "2025-07-15",
      createdBy: "admin-1",
    };

    it("maps NOT_FOUND correctly", async () => {
      mockRpc.mockResolvedValueOnce({
        data: { ok: false, reason: "NOT_FOUND" },
        error: null,
      });
      const result = await stayRepository.saveStayDetails(baseInput);
      expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
    });

    it("maps NOT_ACTIVE correctly with status", async () => {
      mockRpc.mockResolvedValueOnce({
        data: { ok: false, reason: "NOT_ACTIVE", status: "FINISHED" },
        error: null,
      });
      const result = await stayRepository.saveStayDetails(baseInput);
      expect(result).toEqual({
        ok: false,
        reason: "NOT_ACTIVE",
        status: "FINISHED",
      });
    });

    it("maps INVALID_END_DATE correctly with bounds", async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          ok: false,
          reason: "INVALID_END_DATE",
          min_end_date: "2025-07-06",
          max_end_date: "2025-07-20",
        },
        error: null,
      });
      const result = await stayRepository.saveStayDetails(baseInput);
      expect(result).toEqual({
        ok: false,
        reason: "INVALID_END_DATE",
        minEndDate: "2025-07-06",
        maxEndDate: "2025-07-20",
      });
    });

    it("maps AMOUNT_OUT_OF_RANGE correctly", async () => {
      mockRpc.mockResolvedValueOnce({
        data: { ok: false, reason: "AMOUNT_OUT_OF_RANGE" },
        error: null,
      });
      const result = await stayRepository.saveStayDetails(baseInput);
      expect(result).toEqual({ ok: false, reason: "AMOUNT_OUT_OF_RANGE" });
    });

    it("maps a successful result with historyRecorded: true", async () => {
      const stayRow = {
        id: "stay-1",
        customer_profile_id: "profile-1",
        total_nights: 5,
        payment_amount: 50000,
        status: "ACTIVE",
        recalculation_applied: true,
        original_total_nights: 15,
        original_total_amount: 75000,
      };
      mockRpc.mockResolvedValueOnce({
        data: { ok: true, stay: stayRow, history_recorded: true },
        error: null,
      });
      const result = await stayRepository.saveStayDetails(baseInput);
      expect(result).toEqual({
        ok: true,
        stay: stayRow,
        historyRecorded: true,
      });
    });

    it("maps a no-op submission with historyRecorded: false", async () => {
      const stayRow = {
        id: "stay-1",
        customer_profile_id: "profile-1",
        total_nights: 15,
        payment_amount: 75000,
        status: "ACTIVE",
        recalculation_applied: false,
      };
      mockRpc.mockResolvedValueOnce({
        data: { ok: true, stay: stayRow, history_recorded: false },
        error: null,
      });
      const result = await stayRepository.saveStayDetails(baseInput);
      expect(result).toEqual({
        ok: true,
        stay: stayRow,
        historyRecorded: false,
      });
    });
  });

  // -------------------------------------------------------------------------
  // saveStayDetails — original_total_* pinning logic
  // -------------------------------------------------------------------------
  describe("stayRepository.saveStayDetails — original_total_* pinning", () => {
    const baseInput = {
      stayId: "stay-1",
      recalculatedEndDate: "2025-07-10",
      recalculatedTotalNights: 5,
      recalculatedStayAmount: 50000,
      gst: { baseAmount: 42372.88, taxAmount: 7627.12 },
      recalculatedOn: "2025-07-15",
      createdBy: "admin-1",
    };

    it("first application stores original_total_* values", async () => {
      // First submission: original_total_nights/amount are set from pre-submission values
      const stayRow = {
        id: "stay-1",
        total_nights: 5,
        payment_amount: 50000,
        recalculation_applied: true,
        original_total_nights: 15,   // pinned from pre-submission value
        original_total_amount: 75000, // pinned from pre-submission value
        status: "ACTIVE",
      };
      mockRpc.mockResolvedValueOnce({
        data: { ok: true, stay: stayRow, history_recorded: true },
        error: null,
      });
      const result = await stayRepository.saveStayDetails(baseInput);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.stay.original_total_nights).toBe(15);
        expect(result.stay.original_total_amount).toBe(75000);
      }
    });

    it("subsequent applications don't overwrite original_total_*", async () => {
      // Second submission: original_total_nights/amount stay at the first-time values
      const stayRow = {
        id: "stay-1",
        total_nights: 3,
        payment_amount: 30000,
        recalculation_applied: true,
        original_total_nights: 15,   // still pinned to original
        original_total_amount: 75000, // still pinned to original
        status: "ACTIVE",
      };
      mockRpc.mockResolvedValueOnce({
        data: { ok: true, stay: stayRow, history_recorded: true },
        error: null,
      });
      const secondInput = {
        ...baseInput,
        recalculatedEndDate: "2025-07-08",
        recalculatedTotalNights: 3,
        recalculatedStayAmount: 30000,
        gst: { baseAmount: 25423.73, taxAmount: 4576.27 },
      };
      const result = await stayRepository.saveStayDetails(secondInput);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.stay.original_total_nights).toBe(15);
        expect(result.stay.original_total_amount).toBe(75000);
      }
    });
  });

  // -------------------------------------------------------------------------
  // recordRefundWithInvoice — reason mapping
  // -------------------------------------------------------------------------
  describe("stayPaymentRepository.recordRefundWithInvoice — mapping", () => {
    const baseInput = {
      stayEntryId: "stay-1",
      amount: 3000,
      transactionDate: "2025-07-15",
      remark: "early departure refund",
      comment: null as string | null,
      createdBy: "admin-1" as string | null,
    };

    it("maps a successful result with transaction and invoice ID", async () => {
      const txRow = {
        id: "tx-1",
        stay_entry_id: "stay-1",
        customer_profile_id: "profile-1",
        transaction_type: "REFUND",
        amount: 3000,
        transaction_date: "2025-07-15",
        comment: null,
        remark: "early departure refund",
        created_by: "admin-1",
        created_at: "2025-07-15T00:00:00Z",
        updated_at: "2025-07-15T00:00:00Z",
        refund_invoice_payment_id: null,
      };
      mockRpc.mockResolvedValueOnce({
        data: {
          ok: true,
          transaction: txRow,
          refund_invoice_payment_id: "payment-inv-1",
          total_paid: 7000,
          remaining_balance: 3000,
        },
        error: null,
      });
      const result = await stayPaymentRepository.recordRefundWithInvoice(baseInput);
      expect(result).toEqual({
        ok: true,
        transaction: txRow,
        refundInvoicePaymentId: "payment-inv-1",
        totalPaid: 7000,
        remainingBalance: 3000,
      });
    });

    it("maps NOT_FOUND correctly", async () => {
      mockRpc.mockResolvedValueOnce({
        data: { ok: false, reason: "NOT_FOUND" },
        error: null,
      });
      const result = await stayPaymentRepository.recordRefundWithInvoice(baseInput);
      expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
    });

    it("maps NOT_ACTIVE correctly with status", async () => {
      mockRpc.mockResolvedValueOnce({
        data: { ok: false, reason: "NOT_ACTIVE", status: "FINISHED" },
        error: null,
      });
      const result = await stayPaymentRepository.recordRefundWithInvoice(baseInput);
      expect(result).toEqual({
        ok: false,
        reason: "NOT_ACTIVE",
        status: "FINISHED",
      });
    });

    it("maps SHARED_PAYMENT correctly", async () => {
      mockRpc.mockResolvedValueOnce({
        data: { ok: false, reason: "SHARED_PAYMENT" },
        error: null,
      });
      const result = await stayPaymentRepository.recordRefundWithInvoice(baseInput);
      expect(result).toEqual({ ok: false, reason: "SHARED_PAYMENT" });
    });

    it("maps AMOUNT_NOT_POSITIVE correctly", async () => {
      mockRpc.mockResolvedValueOnce({
        data: { ok: false, reason: "AMOUNT_NOT_POSITIVE" },
        error: null,
      });
      const result = await stayPaymentRepository.recordRefundWithInvoice(baseInput);
      expect(result).toEqual({ ok: false, reason: "AMOUNT_NOT_POSITIVE" });
    });

    it("maps NO_EXCESS_TO_REFUND correctly", async () => {
      mockRpc.mockResolvedValueOnce({
        data: { ok: false, reason: "NO_EXCESS_TO_REFUND" },
        error: null,
      });
      const result = await stayPaymentRepository.recordRefundWithInvoice(baseInput);
      expect(result).toEqual({ ok: false, reason: "NO_EXCESS_TO_REFUND" });
    });

    it("maps REFUND_EXCEEDS_EXCESS correctly with excess", async () => {
      mockRpc.mockResolvedValueOnce({
        data: { ok: false, reason: "REFUND_EXCEEDS_EXCESS", excess: 2000 },
        error: null,
      });
      const result = await stayPaymentRepository.recordRefundWithInvoice(baseInput);
      expect(result).toEqual({
        ok: false,
        reason: "REFUND_EXCEEDS_EXCESS",
        excess: 2000,
      });
    });

    it("maps REMARK_INVALID correctly", async () => {
      mockRpc.mockResolvedValueOnce({
        data: { ok: false, reason: "REMARK_INVALID" },
        error: null,
      });
      const result = await stayPaymentRepository.recordRefundWithInvoice(baseInput);
      expect(result).toEqual({ ok: false, reason: "REMARK_INVALID" });
    });

    it("throws on infrastructure error from Supabase", async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: "connection reset" },
      });
      await expect(
        stayPaymentRepository.recordRefundWithInvoice(baseInput)
      ).rejects.toThrow(/connection reset/);
    });
  });
});


// ===========================================================================
// Part 2 — Live database (opt-in via TEST_DATABASE_URL)
// ===========================================================================

/**
 * Fixture preamble creating a user, profile, and an ACTIVE stay for probes.
 * Declares variables used by probes and inserts minimal rows within
 * `BEGIN … ROLLBACK` blocks.
 */
const FIXTURE_PREAMBLE = `
  INSERT INTO public.users (full_name, email, mobile, is_active)
  VALUES ('RPC Repo Probe', 'rpc-repo-' || gen_random_uuid() || '@example.invalid',
          '9100000099', false)
  RETURNING id INTO v_user;

  INSERT INTO public.customer_profiles (user_id) VALUES (v_user) RETURNING id INTO v_profile;

  INSERT INTO public.stay_entries
    (customer_profile_id, start_date, total_nights, stay_type, occupancy_type, status, payment_amount)
  VALUES (v_profile, current_date - 10, 15, 'AC Villa', 'Single', 'ACTIVE', 75000.00)
  RETURNING id INTO v_stay;
`;

const harnessSkip = harnessSkipReason();
const suiteName = harnessSkip
  ? `RPC repositories against a live database — SKIPPED (${harnessSkip})`
  : "RPC repositories against a live database";

describe.skipIf(harnessSkip !== null)(suiteName, () => {
  // --------------------------------------------------------------------------
  // saveStayDetails — reason mapping under real constraints (Req 12.16)
  // --------------------------------------------------------------------------

  describe("save_stay_details() — reason mapping under real constraints", () => {
    it("each reason mapped correctly: NOT_FOUND for missing stay", async () => {
      const outcome = await execSql(`
        BEGIN;
        DO $do$
        DECLARE
          v_user uuid; v_profile uuid; v_stay uuid;
          v_result jsonb;
        BEGIN
          ${FIXTURE_PREAMBLE}

          SELECT public.save_stay_details(
            '00000000-0000-4000-8000-000000000000'::uuid,  -- non-existent
            current_date,
            50000, 42372.88, 7627.12,
            current_date, v_user
          ) INTO v_result;

          IF (v_result->>'ok')::boolean THEN
            RAISE EXCEPTION 'ASSERTION FAILED: accepted a non-existent stay';
          END IF;
          IF v_result->>'reason' <> 'NOT_FOUND' THEN
            RAISE EXCEPTION 'ASSERTION FAILED: expected NOT_FOUND, got %', v_result->>'reason';
          END IF;
        END
        $do$;
        ROLLBACK;
      `);
      expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
    });

    it("each reason mapped correctly: NOT_ACTIVE for a FINISHED stay", async () => {
      const outcome = await execSql(`
        BEGIN;
        DO $do$
        DECLARE
          v_user uuid; v_profile uuid; v_stay uuid;
          v_result jsonb;
        BEGIN
          ${FIXTURE_PREAMBLE}

          UPDATE public.stay_entries SET status = 'FINISHED' WHERE id = v_stay;

          SELECT public.save_stay_details(
            v_stay,
            (current_date - 10 + 4)::date,
            50000, 42372.88, 7627.12,
            current_date, v_user
          ) INTO v_result;

          IF (v_result->>'ok')::boolean THEN
            RAISE EXCEPTION 'ASSERTION FAILED: accepted a FINISHED stay';
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

    it("each reason mapped correctly: INVALID_END_DATE for date after booked end", async () => {
      const outcome = await execSql(`
        BEGIN;
        DO $do$
        DECLARE
          v_user uuid; v_profile uuid; v_stay uuid;
          v_result jsonb;
          v_booked_end date;
        BEGIN
          ${FIXTURE_PREAMBLE}

          -- start = current_date - 10, total_nights = 15, booked_end = start + 14
          v_booked_end := (current_date - 10) + 14;

          SELECT public.save_stay_details(
            v_stay,
            v_booked_end + 1,  -- beyond the booked end
            60000, 50847.46, 9152.54,
            current_date, v_user
          ) INTO v_result;

          IF (v_result->>'ok')::boolean THEN
            RAISE EXCEPTION 'ASSERTION FAILED: accepted date after booked end';
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

    it("each reason mapped correctly: AMOUNT_OUT_OF_RANGE for fractional amount", async () => {
      const outcome = await execSql(`
        BEGIN;
        DO $do$
        DECLARE
          v_user uuid; v_profile uuid; v_stay uuid;
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
            RAISE EXCEPTION 'ASSERTION FAILED: accepted a fractional amount';
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
  });

  // --------------------------------------------------------------------------
  // saveStayDetails — no-op submission (Req 13.2)
  // --------------------------------------------------------------------------

  describe("save_stay_details() — no-op submission", () => {
    it("returns historyRecorded: false with zero history rows when nothing changed", async () => {
      const outcome = await execSql(`
        BEGIN;
        DO $do$
        DECLARE
          v_user uuid; v_profile uuid; v_stay uuid;
          v_result jsonb;
          v_booked_end date;
          v_history_count int;
        BEGIN
          ${FIXTURE_PREAMBLE}

          -- start = current_date - 10, total_nights = 15, payment_amount = 75000
          v_booked_end := (current_date - 10) + 14;

          -- Submit with UNCHANGED values (same end date → same nights, same amount).
          SELECT public.save_stay_details(
            v_stay,
            v_booked_end,
            75000,
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
  });

  // --------------------------------------------------------------------------
  // saveStayDetails — original_total_* pinned across repeated submissions (Req 12.16)
  // --------------------------------------------------------------------------

  describe("save_stay_details() — original_total_* pinning", () => {
    it("first submission stores originals; second submission does not overwrite them", async () => {
      const outcome = await execSql(`
        BEGIN;
        DO $do$
        DECLARE
          v_user uuid; v_profile uuid; v_stay uuid;
          v_result jsonb;
          v_booked_end date;
          v_orig_nights int;
          v_orig_amount numeric;
        BEGIN
          ${FIXTURE_PREAMBLE}

          -- start = current_date - 10, total_nights = 15, payment_amount = 75000
          v_booked_end := (current_date - 10) + 14;

          -- First submission: shorten to 10 nights, amount = 50000
          SELECT public.save_stay_details(
            v_stay,
            (current_date - 10) + 9,  -- end = start + 9 → 10 nights
            50000, 42372.88, 7627.12,
            current_date, v_user
          ) INTO v_result;

          IF NOT (v_result->>'ok')::boolean THEN
            RAISE EXCEPTION 'ASSERTION FAILED: first submission failed: %', v_result->>'reason';
          END IF;

          -- original_total_* should be pinned to the pre-submission values (15, 75000)
          v_orig_nights := (v_result->'stay'->>'original_total_nights')::int;
          v_orig_amount := (v_result->'stay'->>'original_total_amount')::numeric;

          IF v_orig_nights <> 15 THEN
            RAISE EXCEPTION 'ASSERTION FAILED: expected original_total_nights = 15, got %', v_orig_nights;
          END IF;
          IF v_orig_amount <> 75000 THEN
            RAISE EXCEPTION 'ASSERTION FAILED: expected original_total_amount = 75000, got %', v_orig_amount;
          END IF;

          -- Second submission: further shorten to 5 nights, amount = 30000
          -- The new "booked end" is now what save_stay_details set: start + 9
          -- But the RPC bounds against the ORIGINAL booked end (total_nights before first change)
          -- Actually no - the RPC bounds against the CURRENT total_nights.
          -- After first submission, total_nights = 10, so new booked_end = start + 9.
          -- We submit start + 4 = 5 nights.
          SELECT public.save_stay_details(
            v_stay,
            (current_date - 10) + 4,  -- end = start + 4 → 5 nights
            30000, 25423.73, 4576.27,
            current_date, v_user
          ) INTO v_result;

          IF NOT (v_result->>'ok')::boolean THEN
            RAISE EXCEPTION 'ASSERTION FAILED: second submission failed: %', v_result->>'reason';
          END IF;

          -- original_total_* must STILL be the first-time values (15, 75000)
          v_orig_nights := (v_result->'stay'->>'original_total_nights')::int;
          v_orig_amount := (v_result->'stay'->>'original_total_amount')::numeric;

          IF v_orig_nights <> 15 THEN
            RAISE EXCEPTION 'ASSERTION FAILED: second submission overwrote original_total_nights: got %', v_orig_nights;
          END IF;
          IF v_orig_amount <> 75000 THEN
            RAISE EXCEPTION 'ASSERTION FAILED: second submission overwrote original_total_amount: got %', v_orig_amount;
          END IF;
        END
        $do$;
        ROLLBACK;
      `);
      expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // recordRefundWithInvoice — ledger row and payments row committed together (Req 14.8)
  // --------------------------------------------------------------------------

  describe("record_stay_refund_with_invoice() — atomicity", () => {
    it("ledger row and payments row appear together on success", async () => {
      const outcome = await execSql(`
        BEGIN;
        DO $do$
        DECLARE
          v_user uuid; v_profile uuid; v_stay uuid;
          v_result jsonb;
          v_tx_count int;
          v_invoice_count int;
        BEGIN
          ${FIXTURE_PREAMBLE}

          -- Pay 80000 against 75000 total → excess = 5000
          INSERT INTO public.stay_payment_transactions
            (stay_entry_id, customer_profile_id, transaction_type, amount, transaction_date, comment)
          VALUES (v_stay, v_profile, 'ADVANCE', 80000.00, current_date, 'overpaid');

          SELECT public.record_stay_refund_with_invoice(
            v_stay, 3000.00, current_date, 'early departure refund', NULL, v_user
          ) INTO v_result;

          IF NOT (v_result->>'ok')::boolean THEN
            RAISE EXCEPTION 'ASSERTION FAILED: refund rejected: %', v_result->>'reason';
          END IF;

          -- Both rows must exist.
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

    it("forced invoice failure leaves neither row and Total_Paid is unchanged (Req 14.8)", async () => {
      const outcome = await execSql(`
        BEGIN;
        DO $do$
        DECLARE
          v_user uuid; v_profile uuid; v_stay uuid;
          v_total_paid_before numeric;
          v_total_paid_after numeric;
          v_tx_count int;
          v_invoice_count int;
        BEGIN
          ${FIXTURE_PREAMBLE}

          -- Pay 80000 against 75000 total → excess = 5000
          INSERT INTO public.stay_payment_transactions
            (stay_entry_id, customer_profile_id, transaction_type, amount, transaction_date, comment)
          VALUES (v_stay, v_profile, 'ADVANCE', 80000.00, current_date, 'overpaid');

          -- Snapshot Total_Paid before.
          SELECT COALESCE(SUM(CASE WHEN transaction_type = 'REFUND' THEN -amount ELSE amount END), 0)
            INTO v_total_paid_before
            FROM public.stay_payment_transactions
           WHERE stay_entry_id = v_stay;

          -- Block the invoice INSERT with a trigger.
          CREATE OR REPLACE FUNCTION test_block_refund_invoice_repo()
          RETURNS TRIGGER AS $t$
          BEGIN
            IF NEW.invoice_type = 'ACCOMMODATION_REFUND_INVOICE' THEN
              RAISE EXCEPTION 'deliberately blocked refund invoice for repo atomicity test';
            END IF;
            RETURN NEW;
          END;
          $t$ LANGUAGE plpgsql;

          CREATE TRIGGER trg_block_refund_invoice_repo
            BEFORE INSERT ON public.payments
            FOR EACH ROW EXECUTE FUNCTION test_block_refund_invoice_repo();

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
          DROP TRIGGER trg_block_refund_invoice_repo ON public.payments;
          DROP FUNCTION test_block_refund_invoice_repo();

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

          -- Total_Paid must be unchanged.
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

  // --------------------------------------------------------------------------
  // recordRefundWithInvoice — second Refund_Invoice impossible (Req 14.9)
  // --------------------------------------------------------------------------

  describe("record_stay_refund_with_invoice() — uniqueness per transaction", () => {
    it("a second Refund_Invoice for the same REFUND transaction is impossible", async () => {
      const outcome = await execSql(`
        BEGIN;
        DO $do$
        DECLARE
          v_user uuid; v_profile uuid; v_stay uuid;
          v_result1 jsonb;
          v_result2 jsonb;
          v_tx_id uuid;
          v_invoice_count int;
        BEGIN
          ${FIXTURE_PREAMBLE}

          -- Pay 90000 against 75000 total → excess = 15000
          INSERT INTO public.stay_payment_transactions
            (stay_entry_id, customer_profile_id, transaction_type, amount, transaction_date, comment)
          VALUES (v_stay, v_profile, 'ADVANCE', 90000.00, current_date, 'overpaid');

          -- First refund: 5000 (valid, excess was 15000)
          SELECT public.record_stay_refund_with_invoice(
            v_stay, 5000.00, current_date, 'first refund', NULL, v_user
          ) INTO v_result1;

          IF NOT (v_result1->>'ok')::boolean THEN
            RAISE EXCEPTION 'ASSERTION FAILED: first refund rejected: %', v_result1->>'reason';
          END IF;

          -- Second refund: 5000 (valid, remaining excess = 10000)
          SELECT public.record_stay_refund_with_invoice(
            v_stay, 5000.00, current_date, 'second refund', NULL, v_user
          ) INTO v_result2;

          IF NOT (v_result2->>'ok')::boolean THEN
            RAISE EXCEPTION 'ASSERTION FAILED: second refund rejected: %', v_result2->>'reason';
          END IF;

          -- Both Refund_Invoices exist for the same stay (many per stay is allowed).
          SELECT count(*) INTO v_invoice_count
            FROM public.payments
           WHERE stay_entry_id = v_stay
             AND invoice_type = 'ACCOMMODATION_REFUND_INVOICE';

          IF v_invoice_count <> 2 THEN
            RAISE EXCEPTION 'ASSERTION FAILED: expected 2 Refund_Invoices for the stay, found %', v_invoice_count;
          END IF;

          -- Now try to manually insert a SECOND Refund_Invoice for the same
          -- transaction (tx from v_result1). The unique index must reject it.
          v_tx_id := (v_result1->'transaction'->>'id')::uuid;

          BEGIN
            INSERT INTO public.payments
              (customer_profile_id, stay_entry_id, stay_payment_transaction_id,
               payment_method, amount, status, invoice_type)
            VALUES (v_profile, v_stay, v_tx_id,
                    'Manual', 5000.00, 'PAID', 'ACCOMMODATION_REFUND_INVOICE');
            RAISE EXCEPTION 'ASSERTION FAILED: duplicate Refund_Invoice for the same transaction was accepted';
          EXCEPTION WHEN unique_violation THEN
            NULL; -- expected: uniq_refund_invoice_per_transaction
          END;
        END
        $do$;
        ROLLBACK;
      `);
      expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
    });
  });
});
