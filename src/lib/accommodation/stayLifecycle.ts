// src/lib/accommodation/stayLifecycle.ts
//
// Client-safe pure predicates about where a Stay_Entry sits in its lifecycle.
//
// Lives here rather than in `AccommodationService.ts` (which imports
// repositories that pull in `createAdminClient()` / the service-role key) so
// the "use client" Accommodation tab and the server-side visibility derivation
// can share ONE definition of each state instead of re-spelling it in two
// places and drifting apart. `AccommodationService.ts` re-exports everything
// from here unchanged.

/**
 * The minimum a stay must expose to be classified. Deliberately structural
 * rather than `StayEntry`, so a test fixture or a partially-selected row can be
 * passed without ceremony.
 */
export interface StayLifecycleFields {
  status: string;
  /** Timestamp the stay was finalised through Mark_As_Checked_Out. */
  checkedOutAt: string | null;
  /** True when the stay was onboarded with an already-past end date. */
  isBackdated: boolean;
}

/**
 * Awaiting_Checkout: the stay has run its course but no admin has closed it.
 *
 * How a stay lands here: the daily cron transitions ACTIVE → FINISHED as soon
 * as the end date passes (`AccommodationService.transitionStays`). That
 * transition is a calendar fact — it stamps no `checked_out_at`, settles no
 * money, and generates no Final_Consolidated_Invoice. So FINISHED on its own
 * does NOT mean "closed": the admin still has to settle the balance (collect
 * the remainder or refund the excess) and press Mark as Checked Out.
 *
 * The three clauses:
 * - `status === "FINISHED"` — the stay is past its end date.
 * - `!checkedOutAt` — nobody has closed it. A real checkout always stamps this
 *   (`finalize_stay_checkout`), so it is the authoritative "closed" marker and
 *   the reason this predicate cannot be expressed with status alone.
 * - `!isBackdated` — a Backdated_Stay is created FINISHED at onboarding and
 *   also carries a null `checked_out_at`, but it is NOT awaiting a checkout:
 *   its close-out path is Generate Final Invoice, never Mark as Checked Out.
 *   Excluding it keeps the two flows disjoint.
 *
 * A stay in this state must keep behaving like a live one on the Accommodation
 * tab — full dates, payment figures, and the settle-then-checkout actions —
 * which is exactly what it is used for.
 */
export function isAwaitingCheckout(stay: StayLifecycleFields): boolean {
  return stay.status === "FINISHED" && !stay.checkedOutAt && !stay.isBackdated;
}

/**
 * Whether the stay should occupy the "Current Stay" surface: it is either still
 * running, not yet started, or done-but-not-closed. Everything else (a
 * checked-out stay, a Backdated_Stay, a no-show) belongs to history only.
 */
export function isCurrentStay(stay: StayLifecycleFields): boolean {
  return (
    stay.status === "ACTIVE" ||
    stay.status === "PENDING" ||
    isAwaitingCheckout(stay)
  );
}
