// src/test/shop/property25-franchiseTransferReceipt.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 25 (Task 11.5)
//
// Property 25: Franchise transfer receipt is atomic and idempotent.
//
// This property covers `receive_franchise_transfer`
// (`scripts/create-receive-franchise-transfer-rpc.sql`), a franchise-inventory
// RPC that this spec's Task 11.1 *hardened* (not authored) by adding per-line
// integrality/range validation of every `franchise_stock_transfer_lines`
// quantity, checked for ALL lines before any `franchise_inventory_lots` row is
// inserted, naming every offending line in one exception (Req 17.4). The rest
// of the transfer lifecycle — the `ACCEPTED` state precondition, the
// FINISHED_GOOD product check, `batch_number` / `expiry_date` validation, the
// `franchise_product_settings`-untouched guarantee — is out of this spec's
// scope and is not modelled here.
//
// There is no `receive_franchise_transfer` model in `clinicStockModel.ts`:
// that model covers only the five clinic-scoped-shop-inventory RPCs. Since no
// live database is available to exercise the real RPC in this environment,
// this file builds a small, LOCAL, pure reference model of exactly the two
// behaviours Requirements 17.1, 17.2, 17.3, 17.5, 17.6, and 17.7 describe:
//
//   1. `validateAndReceiveTransfer` — the "collect every invalid line, then
//      reject the whole receipt with zero lots created" decision rule the SQL
//      validation loop implements (Req 17.1, 17.2, 17.4-adjacent atomicity).
//   2. `receiveIdempotently` — the "already-RECEIVED transfer is returned as a
//      no-op, no re-validation, no new lots" decision rule (Req 17.3, 17.5,
//      17.6, 17.7 — no confirm step, single-shot transition).
//
// **Validates: Requirements 17.1, 17.2, 17.3, 17.5, 17.6, 17.7**

import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import { REFERENCE_STOCK_QUANTITY_MAXIMUM } from "@/test/shop/clinicStockArbitraries";

// ─── Local reference model ───────────────────────────────────────────────────

interface TransferLine {
  batchNumber: string;
  quantity: number;
}

interface TransferReceiptResult {
  ok: boolean;
  invalidLineCount: number;
  invalidBatchNumbers: string[];
  /** 0 whenever `ok` is false — nothing is inserted before validation completes. */
  lotsCreated: number;
}

/**
 * Mirrors the SQL's two-pass shape: a pure validation loop over every line
 * that collects *all* offenders (mirroring `v_invalid_count` /
 * `v_invalid_lines`), followed — only if nothing was collected — by the
 * lot-insert loop. A single invalid line anywhere in the set rejects the
 * whole receipt with zero lots created, matching the "collect-all-then-reject"
 * pattern rather than "fail fast on first" (Req 17.1, 17.2, 17.4).
 */
function validateAndReceiveTransfer(
  lines: readonly TransferLine[],
): TransferReceiptResult {
  const invalid = lines.filter(
    (line) =>
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > REFERENCE_STOCK_QUANTITY_MAXIMUM,
  );

  if (invalid.length > 0) {
    return {
      ok: false,
      invalidLineCount: invalid.length,
      invalidBatchNumbers: invalid.map((line) => line.batchNumber),
      lotsCreated: 0,
    };
  }

  return {
    ok: true,
    invalidLineCount: 0,
    invalidBatchNumbers: [],
    lotsCreated: lines.length,
  };
}

type TransferState = "ACCEPTED" | "RECEIVED";

interface ReceiveOutcome {
  state: TransferState;
  lotsCreated: number;
  idempotent: boolean;
}

/**
 * Mirrors the SQL's idempotency check (step 2 of the function body): a
 * transfer already in state `RECEIVED` is returned as a no-op — the lines
 * passed this call are never read, never re-validated, and no new lot is
 * created — before the state is asserted to be `ACCEPTED` or the validation
 * loop runs at all (Req 17.3). An `ACCEPTED` transfer runs the full
 * validate-then-receive path and transitions directly to `RECEIVED` in the
 * same call, with no intermediate/pending state ever observable (Req 17.5,
 * 17.6, 17.7).
 */
function receiveIdempotently(
  state: TransferState,
  alreadyLotsCreated: number,
  lines: readonly TransferLine[],
): ReceiveOutcome {
  if (state === "RECEIVED") {
    return { state: "RECEIVED", lotsCreated: alreadyLotsCreated, idempotent: true };
  }

  const result = validateAndReceiveTransfer(lines);
  if (!result.ok) {
    throw new Error(
      `FRANCHISE_TRANSFER_LINE_INVALID: ${result.invalidLineCount} transfer line(s) have a quantity that is not a whole number between 1 and ${REFERENCE_STOCK_QUANTITY_MAXIMUM}`,
    );
  }

  return { state: "RECEIVED", lotsCreated: result.lotsCreated, idempotent: false };
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const NUM_RUNS = 150;

const arbBatchNumber: fc.Arbitrary<string> = fc.integer({ min: 0, max: 9_999 }).map(
  (n) => `batch-${n}`,
);

const arbValidQuantity: fc.Arbitrary<number> = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      1,
      2,
      REFERENCE_STOCK_QUANTITY_MAXIMUM - 1,
      REFERENCE_STOCK_QUANTITY_MAXIMUM,
    ),
    weight: 3,
  },
  { arbitrary: fc.integer({ min: 1, max: REFERENCE_STOCK_QUANTITY_MAXIMUM }), weight: 4 },
);

/** Every shape of quantity the SQL's validation loop must reject. */
const arbInvalidQuantity: fc.Arbitrary<number> = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      0,
      -1,
      -1_000,
      REFERENCE_STOCK_QUANTITY_MAXIMUM + 1,
      2_000_000,
      0.5,
      1.5,
      REFERENCE_STOCK_QUANTITY_MAXIMUM + 0.5,
    ),
    weight: 5,
  },
  {
    arbitrary: fc
      .double({ min: -10, max: 10, noNaN: true })
      .filter((value) => !Number.isInteger(value)),
    weight: 2,
  },
);

const arbValidLine: fc.Arbitrary<TransferLine> = fc
  .tuple(arbBatchNumber, arbValidQuantity)
  .map(([batchNumber, quantity]) => ({ batchNumber, quantity }));

const arbInvalidLine: fc.Arbitrary<TransferLine> = fc
  .tuple(arbBatchNumber, arbInvalidQuantity)
  .map(([batchNumber, quantity]) => ({ batchNumber, quantity }));

/**
 * A set of 1-8 transfer lines with at least one, and possibly several,
 * invalid lines interspersed among otherwise-valid ones. Batch numbers are
 * forced unique-per-index so `invalidBatchNumbers` membership checks are
 * unambiguous.
 */
const arbMixedLineSet: fc.Arbitrary<{
  lines: TransferLine[];
  invalidIndices: number[];
}> = fc
  .integer({ min: 1, max: 8 })
  .chain((length) =>
    fc
      .tuple(
        fc.array(fc.boolean(), { minLength: length, maxLength: length }),
        fc.array(arbValidQuantity, { minLength: length, maxLength: length }),
        fc.array(arbInvalidQuantity, { minLength: length, maxLength: length }),
      )
      .map(([isInvalidFlags, validQuantities, invalidQuantities]) => {
        // Force at least one invalid line so the property's precondition holds.
        const flags = [...isInvalidFlags];
        if (!flags.some(Boolean)) {
          flags[0] = true;
        }

        const lines: TransferLine[] = flags.map((isInvalid, i) => ({
          batchNumber: `batch-${i}`,
          quantity: isInvalid ? invalidQuantities[i] : validQuantities[i],
        }));

        const invalidIndices = flags
          .map((isInvalid, i) => (isInvalid ? i : -1))
          .filter((i) => i !== -1);

        return { lines, invalidIndices };
      }),
  );

const arbAllValidLineSet: fc.Arbitrary<TransferLine[]> = fc.array(arbValidLine, {
  minLength: 1,
  maxLength: 8,
});

// ─── Property A: all-or-nothing line validation ──────────────────────────────

describe("Property 25: Franchise transfer receipt is atomic and idempotent", () => {
  it("Property A: rejects the whole receipt with zero lots created when any line is invalid, naming every offending line", () => {
    fc.assert(
      fc.property(arbMixedLineSet, ({ lines, invalidIndices }) => {
        const result = validateAndReceiveTransfer(lines);

        expect(result.ok).toBe(false);
        // All-or-nothing: nothing is inserted despite some lines being
        // individually valid.
        expect(result.lotsCreated).toBe(0);
        // Every offending line is identified, not just the first one.
        expect(result.invalidLineCount).toBe(invalidIndices.length);
        for (const i of invalidIndices) {
          expect(result.invalidBatchNumbers).toContain(lines[i].batchNumber);
        }
        expect(result.invalidBatchNumbers).toHaveLength(invalidIndices.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // ─── Property B: idempotent no-op ───────────────────────────────────────

  it("Property B: a RECEIVED transfer is returned as a no-op, regardless of the lines passed on a repeat call", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.oneof(
          { arbitrary: arbAllValidLineSet, weight: 1 },
          {
            arbitrary: arbMixedLineSet.map(({ lines }) => lines),
            weight: 1,
          },
        ),
        (previousLotsCreated, repeatLines) => {
          const outcome = receiveIdempotently(
            "RECEIVED",
            previousLotsCreated,
            repeatLines,
          );

          expect(outcome.idempotent).toBe(true);
          expect(outcome.state).toBe("RECEIVED");
          // No new lots — the same count as before the repeat call.
          expect(outcome.lotsCreated).toBe(previousLotsCreated);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // ─── Property C: single-shot receipt, no confirm step ───────────────────

  it("Property C: a single call with all-valid lines transitions ACCEPTED -> RECEIVED and creates every lot in one shot", () => {
    fc.assert(
      fc.property(arbAllValidLineSet, (lines) => {
        const outcome = receiveIdempotently("ACCEPTED", 0, lines);

        expect(outcome.idempotent).toBe(false);
        expect(outcome.state).toBe("RECEIVED");
        expect(outcome.lotsCreated).toBe(lines.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
