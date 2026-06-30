// src/lib/franchise-inventory/__tests__/transfer-state-reducer.property.test.ts
// Property-based test for the transfer state-machine reducer.
//
// **Property 12: The transfer state machine permits only its legal edges**
//
// For any transfer state and any lifecycle event, the transition is permitted
// if and only if it is one of DISPATCHED→ACCEPTED, DISPATCHED→REJECTED, or
// ACCEPTED→RECEIVED; any other request leaves the transfer's state unchanged
// and returns an error. Accept and Reject succeed only from DISPATCHED
// (without changing on-hand), and Received succeeds only from ACCEPTED.
//
// **Validates: Requirements 7.4, 7.5, 7.6, 8.3, 8.5, 8.6**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  reduceTransferState,
  type TransferAction,
} from "../transfer-state-reducer";
import type {
  FranchiseTransferState,
  FranchiseBatch,
} from "@/types/franchiseInventory";

// --- Arbitraries ---

const STATES: FranchiseTransferState[] = [
  "DISPATCHED",
  "ACCEPTED",
  "RECEIVED",
  "REJECTED",
];

const ACTIONS: TransferAction[] = ["ACCEPT", "REJECT", "RECEIVE"];

const arbState: fc.Arbitrary<FranchiseTransferState> = fc.constantFrom(
  ...STATES,
);

const arbAction: fc.Arbitrary<TransferAction> = fc.constantFrom(...ACTIONS);

/** Generates a FranchiseBatch with a non-empty batch number, positive quantity, and an ISO date string. */
const arbBatch: fc.Arbitrary<FranchiseBatch> = fc.record({
  batchNumber: fc.stringMatching(/^[A-Z0-9]{1,10}$/),
  quantity: fc.integer({ min: 1, max: 1000 }),
  expiryDate: fc
    .integer({ min: 1704067200000, max: 1924905600000 }) // 2024-01-01 to 2030-12-31 ms
    .map((ts) => new Date(ts).toISOString()),
});

/** Generates an array of 1–5 transfer lines (FranchiseBatch[]). */
const arbTransferLines: fc.Arbitrary<FranchiseBatch[]> = fc.array(arbBatch, {
  minLength: 1,
  maxLength: 5,
});

// --- Valid transitions lookup ---

const VALID_EDGES: Array<{
  from: FranchiseTransferState;
  action: TransferAction;
  to: FranchiseTransferState;
}> = [
  { from: "DISPATCHED", action: "ACCEPT", to: "ACCEPTED" },
  { from: "DISPATCHED", action: "REJECT", to: "REJECTED" },
  { from: "ACCEPTED", action: "RECEIVE", to: "RECEIVED" },
];

function isValidTransition(
  state: FranchiseTransferState,
  action: TransferAction,
): boolean {
  return VALID_EDGES.some((e) => e.from === state && e.action === action);
}

function expectedTarget(
  state: FranchiseTransferState,
  action: TransferAction,
): FranchiseTransferState | undefined {
  return VALID_EDGES.find((e) => e.from === state && e.action === action)?.to;
}

// --- Property tests ---

describe("Property 12: Transfer state machine permits only its legal edges", () => {
  it("valid transitions produce the correct newState with success=true", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALID_EDGES),
        arbTransferLines,
        (edge, lines) => {
          const result = reduceTransferState(edge.from, edge.action, lines);

          expect(result.success).toBe(true);
          expect(result.newState).toBe(edge.to);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("all other (state, action) combinations return success=false with newState unchanged", () => {
    fc.assert(
      fc.property(arbState, arbAction, arbTransferLines, (state, action, lines) => {
        // Skip the valid transitions and the idempotent RECEIVED+RECEIVE case
        if (isValidTransition(state, action)) return;
        if (state === "RECEIVED" && action === "RECEIVE") return;

        const result = reduceTransferState(state, action, lines);

        expect(result.success).toBe(false);
        expect(result.newState).toBe(state); // state unchanged
        expect(result.error).toBeDefined();
        expect(result.error!.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it("ACCEPT and REJECT always produce onHandDelta=0", () => {
    fc.assert(
      fc.property(arbState, arbTransferLines, (state, lines) => {
        const acceptResult = reduceTransferState(state, "ACCEPT", lines);
        const rejectResult = reduceTransferState(state, "REJECT", lines);

        // Whether valid or invalid, ACCEPT/REJECT never change on-hand
        expect(acceptResult.onHandDelta).toBe(0);
        expect(rejectResult.onHandDelta).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it("only RECEIVE from ACCEPTED produces onHandDelta > 0 (equal to sum of line quantities)", () => {
    fc.assert(
      fc.property(arbTransferLines, (lines) => {
        const result = reduceTransferState("ACCEPTED", "RECEIVE", lines);

        expect(result.success).toBe(true);
        expect(result.newState).toBe("RECEIVED");

        const expectedDelta = lines.reduce((sum, l) => sum + l.quantity, 0);
        expect(result.onHandDelta).toBe(expectedDelta);
        expect(expectedDelta).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it("RECEIVE from non-ACCEPTED states (except RECEIVED) produces onHandDelta=0", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("DISPATCHED" as FranchiseTransferState, "REJECTED" as FranchiseTransferState),
        arbTransferLines,
        (state, lines) => {
          const result = reduceTransferState(state, "RECEIVE", lines);

          expect(result.success).toBe(false);
          expect(result.newState).toBe(state);
          expect(result.onHandDelta).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
