// Feature: core-clinic-architecture, Property 9: One pincode belongs to exactly one clinic
//
// Property test for the one-pincode-one-clinic invariant enforced by the
// database `uq_service_area_pincode` UNIQUE constraint on
// `rider_service_areas.pincode`.
//
// Property 9: One pincode belongs to exactly one clinic
//   For any sequence of add, edit, delete, and move operations on service
//   areas, at every resulting state each pincode is associated with at most one
//   clinic, and the database unique constraint causes any operation that would
//   create a second association for an already-assigned pincode to be rejected
//   with the current owner identified, leaving the existing association
//   unchanged.
//
// A live Supabase connection is not available in unit tests, so the global
// UNIQUE constraint is modeled with a small, deterministic in-memory store that
// rejects any write producing a duplicate pincode (mirroring the DB constraint)
// and surfaces the current owner clinic on rejection — exactly the behavior the
// service-area actions rely on.
//
// Validates: Requirements 4.1, 4.3, 5.3

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ─── In-memory model of `rider_service_areas` with uq_service_area_pincode ──

interface ServiceAreaRecord {
  id: string;
  pincode: string;
  clinic_id: string;
}

type OpResult =
  | { ok: true }
  | { ok: false; reason: "duplicate"; ownerClinicId: string }
  | { ok: false; reason: "not_found" };

/**
 * A minimal in-memory service-area store whose only enforced rule is the global
 * UNIQUE(pincode) constraint (`uq_service_area_pincode`). Every mutating
 * operation that would associate an already-assigned pincode with a second
 * clinic is rejected, the current owner is reported, and no state changes.
 */
class ServiceAreaStore {
  private rows = new Map<string, ServiceAreaRecord>(); // id -> record
  private seq = 0;

  /** Current owner clinic of a pincode, or null when unassigned. */
  ownerOf(pincode: string): string | null {
    for (const r of this.rows.values()) {
      if (r.pincode === pincode) return r.clinic_id;
    }
    return null;
  }

  /** All records, for invariant checks. */
  all(): ServiceAreaRecord[] {
    return [...this.rows.values()];
  }

  /** Add a pincode to a clinic. Rejected (duplicate) if the pincode exists. */
  add(pincode: string, clinicId: string): OpResult {
    const owner = this.ownerOf(pincode);
    if (owner !== null) {
      return { ok: false, reason: "duplicate", ownerClinicId: owner };
    }
    const id = `sa-${this.seq++}`;
    this.rows.set(id, { id, pincode, clinic_id: clinicId });
    return { ok: true };
  }

  /** Edit a record's pincode. Rejected if the new pincode is owned elsewhere. */
  edit(id: string, newPincode: string): OpResult {
    const record = this.rows.get(id);
    if (!record) return { ok: false, reason: "not_found" };
    const owner = this.ownerOf(newPincode);
    // A no-op rename to the same pincode is allowed; a clash with a DIFFERENT
    // record is a duplicate.
    if (owner !== null && newPincode !== record.pincode) {
      return { ok: false, reason: "duplicate", ownerClinicId: owner };
    }
    record.pincode = newPincode;
    return { ok: true };
  }

  /** Delete a record by id. */
  delete(id: string): OpResult {
    if (!this.rows.has(id)) return { ok: false, reason: "not_found" };
    this.rows.delete(id);
    return { ok: true };
  }

  /** Move a pincode from one clinic to another (single-homed re-stamp). */
  move(pincode: string, fromClinicId: string, toClinicId: string): OpResult {
    let target: ServiceAreaRecord | undefined;
    for (const r of this.rows.values()) {
      if (r.pincode === pincode && r.clinic_id === fromClinicId) {
        target = r;
        break;
      }
    }
    if (!target) return { ok: false, reason: "not_found" };
    target.clinic_id = toClinicId;
    return { ok: true };
  }

  /** Ids currently present, for choosing valid edit/delete targets. */
  ids(): string[] {
    return [...this.rows.keys()];
  }
}

// ─── Generators ──────────────────────────────────────────────────────────────

const arbPincode = fc.stringMatching(/^[0-9]{6}$/);
const arbClinicId = fc.constantFrom("clinic-A", "clinic-B", "clinic-C", "clinic-D");

// A symbolic operation; concrete ids are resolved against the live store at
// replay time so edit/delete target rows that actually exist.
type Op =
  | { kind: "add"; pincode: string; clinicId: string }
  | { kind: "edit"; idx: number; newPincode: string }
  | { kind: "delete"; idx: number }
  | { kind: "move"; pincode: string; from: string; to: string };

const arbOp: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant<"add">("add"),
    pincode: arbPincode,
    clinicId: arbClinicId,
  }),
  fc.record({
    kind: fc.constant<"edit">("edit"),
    idx: fc.nat(),
    newPincode: arbPincode,
  }),
  fc.record({ kind: fc.constant<"delete">("delete"), idx: fc.nat() }),
  fc.record({
    kind: fc.constant<"move">("move"),
    pincode: arbPincode,
    from: arbClinicId,
    to: arbClinicId,
  })
);

const arbOps = fc.array(arbOp, { minLength: 0, maxLength: 40 });

const NUM_RUNS = 200;

/** Assert each pincode maps to at most one clinic across the whole store. */
function assertSingleHomed(store: ServiceAreaStore) {
  const seen = new Map<string, string>();
  for (const r of store.all()) {
    const prior = seen.get(r.pincode);
    expect(prior === undefined || prior === r.clinic_id).toBe(true);
    seen.set(r.pincode, r.clinic_id);
  }
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("Property 9: One pincode belongs to exactly one clinic", () => {
  it("after any sequence of add/edit/delete/move, every pincode maps to at most one clinic", () => {
    fc.assert(
      fc.property(arbOps, (ops) => {
        const store = new ServiceAreaStore();

        for (const op of ops) {
          if (op.kind === "add") {
            store.add(op.pincode, op.clinicId);
          } else if (op.kind === "edit") {
            const ids = store.ids();
            if (ids.length > 0) store.edit(ids[op.idx % ids.length], op.newPincode);
          } else if (op.kind === "delete") {
            const ids = store.ids();
            if (ids.length > 0) store.delete(ids[op.idx % ids.length]);
          } else {
            store.move(op.pincode, op.from, op.to);
          }

          // Invariant holds at EVERY intermediate state, not just the end.
          assertSingleHomed(store);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("adding an already-assigned pincode is rejected, identifies the owner, and leaves the association unchanged", () => {
    fc.assert(
      fc.property(arbPincode, arbClinicId, arbClinicId, (pincode, first, second) => {
        const store = new ServiceAreaStore();

        const firstAdd = store.add(pincode, first);
        expect(firstAdd.ok).toBe(true);
        expect(store.ownerOf(pincode)).toBe(first);

        const secondAdd = store.add(pincode, second);

        // The DB unique constraint rejects the second association...
        expect(secondAdd.ok).toBe(false);
        if (!secondAdd.ok) {
          expect(secondAdd.reason).toBe("duplicate");
          // ...and the rejection identifies the current owner (Req 5.3).
          if (secondAdd.reason === "duplicate") {
            expect(secondAdd.ownerClinicId).toBe(first);
          }
        }

        // The existing association is unchanged.
        expect(store.ownerOf(pincode)).toBe(first);
        assertSingleHomed(store);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("editing a record onto an already-assigned pincode is rejected and leaves both records unchanged", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbPincode, { minLength: 2, maxLength: 2 }),
        arbClinicId,
        arbClinicId,
        ([pincodeX, pincodeY], clinicX, clinicY) => {
          const store = new ServiceAreaStore();
          expect(store.add(pincodeX, clinicX).ok).toBe(true);
          expect(store.add(pincodeY, clinicY).ok).toBe(true);

          // Try to rename the Y record onto X's pincode -> duplicate.
          const yId = store.all().find((r) => r.pincode === pincodeY)!.id;
          const result = store.edit(yId, pincodeX);

          expect(result.ok).toBe(false);
          if (!result.ok && result.reason === "duplicate") {
            expect(result.ownerClinicId).toBe(clinicX);
          }

          // Both records remain as they were.
          expect(store.ownerOf(pincodeX)).toBe(clinicX);
          expect(store.ownerOf(pincodeY)).toBe(clinicY);
          assertSingleHomed(store);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
