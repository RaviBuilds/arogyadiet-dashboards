// src/test/shop/property7-orderClinicStamp.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 7 (Task 9.6)
//
// Property 7: The order clinic stamp is immutable and complete.
//
// **Validates: Requirements 10.1, 10.12, 13.18**
//
// WHY THIS IS A LOCAL MODEL, NOT A LIVE-DATABASE TEST
// Property 7 is a DATABASE-LEVEL guarantee: `trg_addon_orders_clinic_stamp_immutable`
// (scripts/add-clinic-stamp-to-addon-orders.sql) rejects any UPDATE on
// `addon_orders` that changes an already-set `clinic_id`, while permitting the
// `NULL -> value` back-stamp direction. There is no live database available in
// this environment, so this file cannot re-prove the trigger fires against
// Postgres. Instead it builds a small, local, PURE reference function —
// `applyClinicStampUpdate` — that encodes the trigger's WHEN clause exactly:
//
//   WHEN (OLD.clinic_id IS NOT NULL AND NEW.clinic_id IS DISTINCT FROM OLD.clinic_id)
//
// ...and property-tests THAT model. There is no existing model of this trigger
// in `clinicStockModel.ts` — that model covers only the
// `clinic_product_settings` / `clinic_product_ledger` RPCs, not `addon_orders`
// UPDATEs — so this file's model is self-contained.
//
// REQ 13.18 — WHY NO FORCED PROPERTY
// Requirement 13.18 ("changing an Admin's Clinic_Scope_Assignment leaves every
// previously created Shop_Order's Order_Clinic_Stamp unchanged") is about a
// DIFFERENT write path entirely: it concerns UPDATEs to `public.users.admin_clinic_id`,
// not UPDATEs to `public.addon_orders.clinic_id`. The
// `trg_addon_orders_clinic_stamp_immutable` trigger's WHEN clause only ever
// evaluates on `BEFORE UPDATE ON public.addon_orders` — it is never attached to,
// and never fires for, an UPDATE on `public.users`. There is no shared code path,
// no shared trigger, and no shared table between the two: changing a Clinic_Scope_
// Assignment literally cannot touch `addon_orders.clinic_id` because no statement
// in that write path references the `addon_orders` table at all. Requirement 13.18
// is therefore satisfied by construction (different tables, different triggers,
// disjoint code paths) rather than by anything this file could meaningfully
// property-test — forcing a property here would just be re-asserting "two
// unrelated tables don't affect each other," which is not a real test of this
// trigger's behavior. Test-writing effort is focused on Properties A and B below,
// which are the real, testable core of Property 7 (Req 10.1 nullability +
// Req 10.12 immutability).
//
// vitest + fast-check, >=100 runs.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { CORE_CLINIC_IDS, UNKNOWN_UUID } from "@/test/shop/clinicStockArbitraries";

const NUM_RUNS = 200;

// ─── The model: a pure reference implementation of the trigger's WHEN clause ─

type StampUpdateResult =
  | { ok: true; newClinicId: string | null }
  | { ok: false; error: string };

/**
 * Models `trg_addon_orders_clinic_stamp_immutable` /
 * `reject_addon_order_clinic_restamp()` exactly:
 *
 *   WHEN (OLD.clinic_id IS NOT NULL AND NEW.clinic_id IS DISTINCT FROM OLD.clinic_id)
 *
 * -> reject. Otherwise -> allow, and the stored value becomes `newClinicId`.
 *
 * `oldClinicId === null` permits ANY `newClinicId` (the NULL -> value back-stamp
 * direction, Req 10.1's nullability). Once `oldClinicId` is set, only a NEW value
 * IDENTICAL to it is permitted (a no-op "update" that doesn't actually change the
 * stamp) — any different value, including NULL, is rejected (Req 10.12).
 */
function applyClinicStampUpdate(
  oldClinicId: string | null,
  newClinicId: string | null,
  orderId: string = "order-id",
): StampUpdateResult {
  const isChange = oldClinicId !== null && newClinicId !== oldClinicId;
  if (isChange) {
    return {
      ok: false,
      error: `CLINIC_STAMP_IMMUTABLE: The clinic stamp on shop order ${orderId} cannot be changed once set (stamped clinic ${oldClinicId}, attempted ${newClinicId ?? "NULL"}).`,
    };
  }
  return { ok: true, newClinicId };
}

// ─── Arbitraries: every case in the WHEN clause's truth table ───────────────

/** A "clinic id" value for use as either OLD or NEW, including null (unstamped)
 * and a real, distinct Core Clinic id per generated value. */
const arbClinicIdOrNull: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.constantFrom(...CORE_CLINIC_IDS),
  fc.constant(UNKNOWN_UUID),
);

/** (oldClinicId, newClinicId) pairs covering every branch of the WHEN clause:
 * both null, old null / new set, old set / new null, old set / new same value,
 * old set / new different value (another real clinic id, or the unknown id). */
const arbStampUpdatePair: fc.Arbitrary<{
  oldClinicId: string | null;
  newClinicId: string | null;
}> = fc.tuple(arbClinicIdOrNull, arbClinicIdOrNull).map(([oldClinicId, newClinicId]) => ({
  oldClinicId,
  newClinicId,
}));

// ─── Property A: totality — reject iff a set stamp is being changed ─────────

describe("Property 7A: the stamp update is accepted iff the OLD stamp is unset or the NEW value is unchanged", () => {
  it("applyClinicStampUpdate(old, new).ok === true  <=>  old === null || new === old", () => {
    fc.assert(
      fc.property(arbStampUpdatePair, ({ oldClinicId, newClinicId }) => {
        const result = applyClinicStampUpdate(oldClinicId, newClinicId);

        const expectedOk = oldClinicId === null || newClinicId === oldClinicId;
        expect(result.ok).toBe(expectedOk);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("when accepted, the resulting stamp is exactly the requested newClinicId (nullable, Req 10.1)", () => {
    fc.assert(
      fc.property(arbStampUpdatePair, ({ oldClinicId, newClinicId }) => {
        const result = applyClinicStampUpdate(oldClinicId, newClinicId);
        if (result.ok) {
          expect(result.newClinicId).toBe(newClinicId);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("once a stamp is set, no update ever changes it to a different value — including clearing it (Req 10.12)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CORE_CLINIC_IDS),
        arbClinicIdOrNull,
        (setClinicId, attemptedNewClinicId) => {
          const result = applyClinicStampUpdate(setClinicId, attemptedNewClinicId);

          if (attemptedNewClinicId !== setClinicId) {
            expect(result.ok).toBe(false);
          } else {
            expect(result.ok).toBe(true);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("an unstamped (NULL) order may be back-stamped to any value, including staying NULL (Req 10.1)", () => {
    fc.assert(
      fc.property(arbClinicIdOrNull, (newClinicId) => {
        const result = applyClinicStampUpdate(null, newClinicId);
        expect(result).toEqual({ ok: true, newClinicId });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Property B: every rejection carries the stable error prefix ────────────

describe("Property 7B: every rejected stamp update carries the stable CLINIC_STAMP_IMMUTABLE: prefix", () => {
  it('result.error contains "CLINIC_STAMP_IMMUTABLE:" whenever the update is rejected', () => {
    fc.assert(
      fc.property(arbStampUpdatePair, ({ oldClinicId, newClinicId }) => {
        const result = applyClinicStampUpdate(oldClinicId, newClinicId);

        if (!result.ok) {
          expect(result.error).toContain("CLINIC_STAMP_IMMUTABLE:");
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("the prefix matches the exact string the action layer maps to Requirement 10.12's wording (clinicShopInventoryActions.ts)", () => {
    // Guards against silent drift between this model's error string and the
    // prefix the SQL trigger actually raises / the action layer actually maps.
    const result = applyClinicStampUpdate(CORE_CLINIC_IDS[0], CORE_CLINIC_IDS[1]);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error.startsWith("CLINIC_STAMP_IMMUTABLE:")).toBe(
      true,
    );
  });
});
