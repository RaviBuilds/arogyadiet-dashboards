// src/lib/clinic/order-stamp.ts
// Pure, side-effect-free clinic-stamp logic for Delivery_Orders and
// Delivery_Batches (core-clinic-architecture, Requirement 19 / 22.3). These
// functions perform NO Supabase / network / IO work so they can be unit- and
// property-tested in isolation.
//
// Two clinic stamps are recorded once, at creation time, and are then immutable:
//   - Order_Clinic_Stamp on `delivery_orders.clinic_id`  — set from the
//     customer's DELIVERY address resolution for that delivery day (Req 19.2 /
//     22.3). This is the value the Conflict_Clinic flow compares against the
//     customer's Primary_Address clinic.
//   - Order_Clinic_Stamp on `delivery_batches.clinic_id` — set from the rider's
//     linked clinic for the routing scope at routing time (Req 19.3).
//
// Neither stamp blocks creation: an unresolved delivery address (Req 19.8) or an
// unlinked rider (Req 19.9) yields a `null` stamp rather than an error.

/**
 * Resolve the Order_Clinic_Stamp for a Delivery_Order at creation time
 * (Requirement 19.2 / 22.3).
 *
 * The stamp is the clinic the customer's delivery address for that day resolves
 * to. When the delivery address does not resolve to any clinic the stamp is
 * `null` and order creation is NOT blocked (Requirement 19.8).
 *
 * @param deliveryAddressClinicId The clinic the delivery address resolved to, or
 *   `null` when it resolves to no clinic.
 * @returns The clinic id to stamp, or `null` when unresolved.
 */
export function resolveOrderClinicStamp(
  deliveryAddressClinicId: string | null
): string | null {
  return deliveryAddressClinicId;
}

/**
 * Resolve the Order_Clinic_Stamp for a Delivery_Batch at routing time
 * (Requirement 19.3).
 *
 * The stamp is the rider's linked clinic for the routing scope. When the rider
 * has no linked clinic the stamp is `null` and batch creation is NOT blocked
 * (Requirement 19.9).
 *
 * @param riderClinicId The rider's linked clinic, or `null` when unlinked.
 * @returns The clinic id to stamp, or `null` when the rider has no linked clinic.
 */
export function resolveBatchClinicStamp(
  riderClinicId: string | null
): string | null {
  return riderClinicId;
}

/** Result of an immutability check on an order/batch clinic stamp. */
export type StampImmutableResult =
  | { ok: true }
  | { ok: false; reason: "immutable" };

/**
 * Immutability guard for an order/batch Order_Clinic_Stamp (Requirements 19.4,
 * 19.5).
 *
 * A stamp may only transition from unset (`null`) to a set value. This permits
 * the single creation-time write while rejecting any later modification of an
 * already-set stamp — including a change to a different value, a change back to
 * `null`, or any other mutation. A no-op write that keeps an already-set stamp
 * at its current value is allowed (it does not modify the value).
 *
 * @param current The currently persisted stamp (`null` when unset).
 * @param incoming The stamp value an operation is attempting to write.
 * @returns `{ ok: true }` when the write is permitted; otherwise
 *   `{ ok: false, reason: "immutable" }`.
 */
export function assertStampImmutable(
  current: string | null,
  incoming: string | null
): StampImmutableResult {
  // Unset -> set (or unset -> unset): the creation-time write is allowed.
  if (current === null) {
    return { ok: true };
  }

  // Already set: only an identical no-op write is allowed; any change is rejected.
  if (current === incoming) {
    return { ok: true };
  }

  return { ok: false, reason: "immutable" };
}
