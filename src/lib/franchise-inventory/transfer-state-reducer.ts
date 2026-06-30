// src/lib/franchise-inventory/transfer-state-reducer.ts
// Pure transfer state-machine reducer for franchise stock transfers.
// No DB access — takes current state, action, and transfer lines;
// returns the transition result including any lots/on-hand delta.
//
// Requirements validated: 7.4, 7.5, 7.6, 8.3, 8.5, 8.6, 8.8

import type {
  FranchiseTransferState,
  FranchiseBatch,
} from "@/types/franchiseInventory";

/** The action a franchise operator can request on a transfer. */
export type TransferAction = "ACCEPT" | "REJECT" | "RECEIVE";

/** Result returned by the transfer-state reducer. */
export interface TransferStateResult {
  /** Whether the transition was permitted. */
  success: boolean;
  /** The resulting state (unchanged if the transition was invalid). */
  newState: FranchiseTransferState;
  /** Human-readable explanation when the transition is rejected. */
  error?: string;
  /** The lots to create in the franchise inventory (only on RECEIVE). */
  lotsDelta?: FranchiseBatch[];
  /** Quantity change: positive for receive, 0 for accept/reject. */
  onHandDelta?: number;
  /** True if the transfer was already RECEIVED and RECEIVE was requested again. */
  idempotent?: boolean;
}

/**
 * The valid edges in the transfer state machine:
 *   DISPATCHED → ACCEPTED  (via ACCEPT)
 *   DISPATCHED → REJECTED  (via REJECT)
 *   ACCEPTED  → RECEIVED  (via RECEIVE)
 */
const VALID_TRANSITIONS: Record<
  FranchiseTransferState,
  Partial<Record<TransferAction, FranchiseTransferState>>
> = {
  DISPATCHED: {
    ACCEPT: "ACCEPTED",
    REJECT: "REJECTED",
  },
  ACCEPTED: {
    RECEIVE: "RECEIVED",
  },
  RECEIVED: {},
  REJECTED: {},
};

/**
 * Pure transfer-state reducer.
 *
 * @param currentState  The transfer's current lifecycle state.
 * @param action        The requested transition action.
 * @param transferLines The per-batch breakdown of the transfer (used to compute
 *                      the lots/on-hand delta when receiving).
 * @returns A `TransferStateResult` describing whether the transition succeeded,
 *          the new state, and any inventory delta produced.
 */
export function reduceTransferState(
  currentState: FranchiseTransferState,
  action: TransferAction,
  transferLines: FranchiseBatch[]
): TransferStateResult {
  // Idempotent receive: already RECEIVED → no-op (Requirement 8.8)
  if (currentState === "RECEIVED" && action === "RECEIVE") {
    return {
      success: true,
      newState: "RECEIVED",
      onHandDelta: 0,
      idempotent: true,
    };
  }

  const allowedForState = VALID_TRANSITIONS[currentState];
  const targetState = allowedForState[action];

  // Invalid transition
  if (!targetState) {
    return {
      success: false,
      newState: currentState,
      error: `Cannot ${action} a transfer in state ${currentState}. ` +
        `Allowed transitions from ${currentState}: ${describeAllowed(currentState)}.`,
      onHandDelta: 0,
    };
  }

  // ACCEPT and REJECT produce no inventory delta (stock stays in transit or is terminal)
  if (action === "ACCEPT" || action === "REJECT") {
    return {
      success: true,
      newState: targetState,
      onHandDelta: 0,
    };
  }

  // RECEIVE: compute lots delta from transfer lines (Requirement 8.4, 9.1)
  const lotsDelta: FranchiseBatch[] = transferLines.map((line) => ({
    batchNumber: line.batchNumber,
    quantity: line.quantity,
    expiryDate: line.expiryDate,
  }));

  const onHandDelta = transferLines.reduce(
    (sum, line) => sum + line.quantity,
    0
  );

  return {
    success: true,
    newState: targetState,
    lotsDelta,
    onHandDelta,
  };
}

/** Helper: describes the allowed actions from a given state for error messages. */
function describeAllowed(state: FranchiseTransferState): string {
  const edges = VALID_TRANSITIONS[state];
  const actions = Object.keys(edges) as TransferAction[];
  if (actions.length === 0) {
    return "none (terminal state)";
  }
  return actions
    .map((a) => `${a} → ${edges[a]}`)
    .join(", ");
}
