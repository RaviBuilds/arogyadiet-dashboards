// src/lib/franchise/status-transitions.ts
// Pure, side-effect-free franchise lifecycle status-transition rules
// (multi-tenant-franchise — Task 6.2, Requirement 4.8). This module performs NO
// Supabase / network / IO work, so the no-op-rejection rule can be unit- and
// property-tested in isolation (see Property 9 / task 6.4).
//
// A Franchise is persisted as `onboarding` and moves onboarding → active →
// suspended → active. The lifecycle actions (activate / reactivate / suspend)
// must reject any transition that would leave the status UNCHANGED — i.e. a
// no-op (Req 4.8):
//   - activate / reactivate target `active`   → valid iff current !== 'active'
//   - suspend             targets `suspended` → valid iff current !== 'suspended'
// No transition ever targets `onboarding` (a franchise can never be moved back
// into onboarding), so that target is always invalid.

import type { FranchiseStatus } from "@/types/franchise";

/**
 * Pure predicate for whether a franchise lifecycle transition `from → to` is
 * valid (Req 4.8). A transition is valid only when it changes the status:
 *
 *   - `to === "active"`    (activate / reactivate) → valid iff `from !== "active"`
 *   - `to === "suspended"` (suspend)               → valid iff `from !== "suspended"`
 *   - `to === "onboarding"`                        → never valid (no transition
 *     ever targets onboarding)
 *
 * Returns `false` for any no-op transition (e.g. activate-when-active,
 * suspend-when-suspended) so the lifecycle leaves the status unchanged.
 *
 * Validates: Requirement 4.8.
 */
export function isValidStatusTransition(
  from: FranchiseStatus,
  to: FranchiseStatus
): boolean {
  switch (to) {
    case "active":
      // activate / reactivate — valid only when not already active.
      return from !== "active";
    case "suspended":
      // suspend — valid only when not already suspended.
      return from !== "suspended";
    case "onboarding":
      // No lifecycle transition ever moves a franchise back into onboarding.
      return false;
    default:
      return false;
  }
}

/**
 * Imperative companion to {@link isValidStatusTransition}: throws a
 * {@link InvalidStatusTransitionError} when the `from → to` transition is a
 * no-op / otherwise invalid (Req 4.8), and returns normally when it is valid.
 *
 * Useful at action boundaries that prefer a throw-and-catch style over a boolean
 * check. Pure aside from the thrown error.
 */
export function assertTransition(
  from: FranchiseStatus,
  to: FranchiseStatus
): void {
  if (!isValidStatusTransition(from, to)) {
    throw new InvalidStatusTransitionError(from, to);
  }
}

/**
 * Error raised by {@link assertTransition} for an invalid (no-op or disallowed)
 * franchise status transition. Carries the offending `from`/`to` pair so callers
 * can surface a precise, user-facing message.
 */
export class InvalidStatusTransitionError extends Error {
  readonly from: FranchiseStatus;
  readonly to: FranchiseStatus;

  constructor(from: FranchiseStatus, to: FranchiseStatus) {
    super(
      from === to
        ? `Franchise is already "${to}"`
        : `Invalid franchise status transition: "${from}" → "${to}"`
    );
    this.name = "InvalidStatusTransitionError";
    this.from = from;
    this.to = to;
  }
}
