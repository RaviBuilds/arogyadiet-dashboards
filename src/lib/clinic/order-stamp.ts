// src/lib/clinic/order-stamp.ts
// Pure, side-effect-free helpers for the order/batch clinic stamp
// (core-clinic-architecture, Requirement 19). This module performs NO
// Supabase / network / IO work so it can be unit- and property-tested in
// isolation.
//
// Delivery orders and batches each carry an IMMUTABLE `clinic_id` recorded at
// the moment they are created. This stamp is the authoritative basis for
// per-clinic workload snapshots, routing, and delivery history — it must never
// drift when a customer later moves between clinics (Req 19.6, 19.7).
//
//   - Order stamp (creation-time): the customer's resolved clinic for the
//     delivery address at the time the order is created (Req 19.2). When the
//     address resolves to no clinic, the stamp is `null` and order creation is
//     NOT blocked (Req 19.8).
//   - Batch stamp (routing-time): the routing rider's linked clinic for that
//     routing scope (Req 19.3). When the rider has no linked clinic, the stamp
//     is `null` and batch creation is NOT blocked (Req 19.9).
//   - Immutability: once a stamp is set (non-null) it can never change
//     (Req 19.4, 19.5). The {@link assertStampImmutable} guard is used by every
//     order/batch writer to reject any attempt to mutate an already-set stamp.
//
// The actual persistence (the INSERT that creates the order/batch) happens
// within the same write that creates the row — these helpers only resolve the
// value to stamp and guard against later mutation.

/**
 * Resolve the clinic stamp for a delivery order at creation time.
 *
 * Pure. The order stamp is the customer's resolved clinic for the delivery
 * address at creation time. The caller supplies the already-resolved clinic id
 * stamped on the delivery address (`addresses.clinic_id`), which was computed
 * by the pincode resolver / customer stamp at signup or address-update. This
 * helper returns that value as-is, or `null` when the address resolves to no
 * clinic — in which case order creation proceeds with a `null` stamp and is
 * never blocked.
 *
 * Validates: Requirements 19.2, 19.8.
 *
 * @param addressClinicId the clinic stamped on the delivery address, or `null`
 *   when the address does not resolve to a clinic
 * @returns the clinic id to stamp on the order, or `null` when unresolved
 */
export function resolveOrderClinicStamp(
  addressClinicId: string | null
): string | null {
  return addressClinicId;
}

/**
 * Resolve the clinic stamp for a delivery batch at routing time.
 *
 * Pure. The batch stamp is the routing rider's linked clinic for that routing
 * scope. The caller supplies the rider's currently linked clinic id
 * (`rider_profiles.clinic_id`). This helper returns that value as-is, or `null`
 * when the rider has no linked clinic — in which case batch creation proceeds
 * with a `null` stamp and is never blocked.
 *
 * Validates: Requirements 19.3, 19.9.
 *
 * @param riderClinicId the rider's linked clinic id, or `null` when unlinked
 * @returns the clinic id to stamp on the batch, or `null` when unlinked
 */
export function resolveBatchClinicStamp(
  riderClinicId: string | null
): string | null {
  return riderClinicId;
}

/**
 * The result of an immutability check on a clinic stamp. `ok: true` means the
 * write is allowed (a first-time set, or a no-op re-write of the same value);
 * `ok: false` with `reason: "immutable"` means the write would change an
 * already-set stamp and must be rejected, leaving the original value intact.
 */
export type StampImmutabilityResult =
  | { ok: true }
  | { ok: false; reason: "immutable" };

/**
 * Guard the immutability of an order/batch clinic stamp (Req 19.4, 19.5).
 *
 * Pure. Used by every order/batch writer before persisting a `clinic_id`:
 *
 *   - When `current === null` the stamp has never been set, so setting it to
 *     any `incoming` value (including `null`) is allowed — returns `{ ok: true }`.
 *   - When the stamp is already set (`current !== null`):
 *       - if `incoming === current` the write is a no-op change and is allowed
 *         — returns `{ ok: true }`.
 *       - otherwise the write would change an already-set stamp and is rejected
 *         — returns `{ ok: false, reason: "immutable" }`, leaving the original
 *         value intact.
 *
 * Validates: Requirements 19.4, 19.5.
 *
 * @param current the stamp currently persisted on the order/batch (`null` when
 *   it has never been set)
 * @param incoming the stamp value the caller wants to write
 */
export function assertStampImmutable(
  current: string | null,
  incoming: string | null
): StampImmutabilityResult {
  // First-time set: any incoming value is allowed when nothing is set yet.
  if (current === null) {
    return { ok: true };
  }

  // Already set: only a no-op re-write of the identical value is permitted.
  if (incoming === current) {
    return { ok: true };
  }

  // Any attempt to change an already-set stamp is rejected; the original value
  // is left intact by the caller.
  return { ok: false, reason: "immutable" };
}
