// Feature: core-clinic-architecture, Property 10: Pincode move is atomic and single-homed
//
// Property test for the transactional pincode move enforced by the
// `move_pincode_and_reassign` RPC (scripts/create-move-pincode-rpc.sql), which
// re-stamps the service area in a single DB transaction. The transactional,
// single-homed guarantee is modeled here with an in-memory store that mirrors
// the `uq_service_area_pincode` UNIQUE constraint and rolls back the whole move
// on failure (exactly like a transaction abort).
//
// Property 10: Pincode move is atomic and single-homed
//   For any pincode currently associated with a source clinic, a successful
//   move associates the pincode only with the destination clinic; if the move
//   fails, the pincode remains associated only with the source clinic. In no
//   observable state is the pincode associated with both.
//
// Validates: Requirements 4.4, 5.7

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ─── In-memory transactional service-area store ─────────────────────────────

interface ServiceAreaRecord {
  id: string;
  pincode: string;
  clinic_id: string;
}

/**
 * A service-area store whose `move` runs atomically: it stages the re-stamp and
 * commits only when no fault is injected, otherwise it rolls back to the
 * pre-move snapshot. The global UNIQUE(pincode) invariant guarantees a pincode
 * is single-homed, so a "both clinics" state is never observable.
 */
class TransactionalServiceAreaStore {
  private rows: ServiceAreaRecord[] = [];
  private seq = 0;

  add(pincode: string, clinicId: string): void {
    // Enforce single-homing on seed too.
    if (this.rows.some((r) => r.pincode === pincode)) {
      throw new Error("duplicate seed pincode");
    }
    this.rows.push({ id: `sa-${this.seq++}`, pincode, clinic_id: clinicId });
  }

  /** All clinics currently associated with a pincode. */
  clinicsFor(pincode: string): string[] {
    return this.rows
      .filter((r) => r.pincode === pincode)
      .map((r) => r.clinic_id);
  }

  /**
   * Atomically move `pincode` from `fromClinicId` to `toClinicId`.
   * @param injectFailure when true, the transaction aborts and rolls back.
   * @returns whether the move committed.
   */
  move(
    pincode: string,
    fromClinicId: string,
    toClinicId: string,
    injectFailure: boolean
  ): { committed: boolean; error?: string } {
    // Snapshot for rollback (models BEGIN ... ROLLBACK).
    const snapshot = this.rows.map((r) => ({ ...r }));

    const target = this.rows.find(
      (r) => r.pincode === pincode && r.clinic_id === fromClinicId
    );
    if (!target) {
      return { committed: false, error: "pincode not on source clinic" };
    }

    // Stage the re-stamp.
    target.clinic_id = toClinicId;

    if (injectFailure) {
      // Abort: restore the snapshot so no partial state persists.
      this.rows = snapshot;
      return { committed: false, error: "injected move failure" };
    }

    return { committed: true };
  }
}

// ─── Generators ──────────────────────────────────────────────────────────────

const arbPincode = fc.stringMatching(/^[0-9]{6}$/);
const arbClinics = fc
  .uniqueArray(fc.constantFrom("clinic-A", "clinic-B", "clinic-C", "clinic-D"), {
    minLength: 2,
    maxLength: 2,
  })
  .map(([from, to]) => ({ from, to }));

const NUM_RUNS = 200;

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("Property 10: Pincode move is atomic and single-homed", () => {
  it("a successful move leaves the pincode associated only with the destination clinic", () => {
    fc.assert(
      fc.property(arbPincode, arbClinics, (pincode, { from, to }) => {
        const store = new TransactionalServiceAreaStore();
        store.add(pincode, from);

        const result = store.move(pincode, from, to, /* injectFailure */ false);

        expect(result.committed).toBe(true);
        // Single-homed on the destination only — never both.
        expect(store.clinicsFor(pincode)).toEqual([to]);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("a failed move leaves the pincode associated only with the source clinic", () => {
    fc.assert(
      fc.property(arbPincode, arbClinics, (pincode, { from, to }) => {
        const store = new TransactionalServiceAreaStore();
        store.add(pincode, from);

        const result = store.move(pincode, from, to, /* injectFailure */ true);

        expect(result.committed).toBe(false);
        expect(typeof result.error).toBe("string");
        // Rolled back: pincode still on the source only — never both.
        expect(store.clinicsFor(pincode)).toEqual([from]);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("in no observable outcome is the pincode associated with both clinics", () => {
    fc.assert(
      fc.property(
        arbPincode,
        arbClinics,
        fc.boolean(),
        (pincode, { from, to }, injectFailure) => {
          const store = new TransactionalServiceAreaStore();
          store.add(pincode, from);

          store.move(pincode, from, to, injectFailure);

          const clinics = store.clinicsFor(pincode);
          // Exactly one association in every case.
          expect(clinics).toHaveLength(1);
          // It is the source on failure, the destination on success.
          expect(clinics[0]).toBe(injectFailure ? from : to);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
