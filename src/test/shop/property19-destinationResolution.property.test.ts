// src/test/shop/property19-destinationResolution.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 19 (Task 2.10)
//
// Property 19: Destination resolution always yields a renderable mode.
//
// For any raw `?destination=` parameter value and any set of known Core Clinics
// and active Franchises, resolution yields either the named existing
// destination or a fallback to All Clinics with a notice — never an unresolved
// or partially-resolved state — and the resulting mode's available row actions
// match the mode exactly.
//
// The expectation is derived from a reference resolver written below directly
// from Requirements 5.2, 5.11, 5.12 (and the `clinic:` / `franchise:` parameter
// format the design fixes), plus reference row-action sets transcribed from
// Requirements 5.4/5.7/5.8 and 19.2/19.3. Neither reads the module under test,
// so the model cannot inherit a bug from the code it exercises.
//
// **Validates: Requirements 5.2, 5.7, 5.8, 5.11, 5.12, 19.2, 19.3**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  ALL_CLINICS_DESTINATION_VALUE,
  DESTINATION_LIST_LOAD_FAILED_NOTICE,
  DESTINATION_UNAVAILABLE_NOTICE,
  formatDestinationParam,
  resolveDestination,
  rowActionsForDestination,
  type Destination,
  type ShopProductRowAction,
} from "@/lib/shop/clinicStock";
import {
  arbDestinationParam,
  arbKnownDestinations,
  type KnownDestinationsSample,
} from "@/test/shop/clinicStockArbitraries";

const NUM_RUNS = 300;

// ─── Reference model: the three renderable modes ─────────────────────────────

/** The only kinds a resolved destination may carry — there is no fourth state. */
const RENDERABLE_KINDS = ["all-clinics", "clinic", "franchise"] as const;

/**
 * Requirements 5.2, 5.11, 5.12 transcribed, together with the `clinic:<id>` /
 * `franchise:<id>` parameter format the design fixes for the selector:
 *
 * - a failed option-list load falls back to All Clinics with the load-failure
 *   notice whatever the raw value says (Req 5.12)
 * - absent, empty, or `all` is All Clinics, and that is the default rather than
 *   a fallback, so it carries no notice (Req 5.2)
 * - a prefixed or bare identifier naming a destination that exists resolves to
 *   that destination
 * - anything else — unknown identifier, mismatched prefix, malformed text —
 *   falls back to All Clinics with the unavailable notice (Req 5.11)
 */
function referenceResolve(
  raw: string | undefined,
  known: KnownDestinationsSample,
): Destination {
  if (known.loadFailed === true) {
    return { kind: "all-clinics", notice: DESTINATION_LIST_LOAD_FAILED_NOTICE };
  }

  const unavailable: Destination = {
    kind: "all-clinics",
    notice: DESTINATION_UNAVAILABLE_NOTICE,
  };

  const value = (raw ?? "").trim();
  if (value === "" || value.toLowerCase() === ALL_CLINICS_DESTINATION_VALUE) {
    return { kind: "all-clinics", notice: null };
  }

  const separator = value.indexOf(":");
  if (separator === -1) {
    if (known.clinicIds.includes(value)) {
      return { kind: "clinic", clinicId: value };
    }
    if (known.franchiseIds.includes(value)) {
      return { kind: "franchise", franchiseId: value };
    }
    return unavailable;
  }

  const prefix = value.slice(0, separator).trim().toLowerCase();
  const id = value.slice(separator + 1).trim();
  if (prefix === "clinic" && known.clinicIds.includes(id)) {
    return { kind: "clinic", clinicId: id };
  }
  if (prefix === "franchise" && known.franchiseIds.includes(id)) {
    return { kind: "franchise", franchiseId: id };
  }
  return unavailable;
}

/**
 * The row actions each mode offers, transcribed from the requirements rather
 * than from `rowActionsForDestination`:
 *
 * - Clinic_Mode: exactly two — a Clinic_Visibility toggle and a Stock_In
 *   action (Req 5.7) — and none of Add/Edit/Delete/Franchises (Req 5.8)
 * - Franchise_Mode: exactly one — a franchise visibility toggle (Req 19.2) —
 *   and no Stock_In, Edit, Delete, or Franchises action (Req 19.3)
 * - All_Clinics_Mode: the catalogue actions plus the Global_Visibility toggle,
 *   with no stock entry or Stock_In action (Req 5.3, 5.4)
 */
function referenceRowActions(
  destination: Destination,
): readonly ShopProductRowAction[] {
  switch (destination.kind) {
    case "clinic":
      return ["clinic-visibility", "stock-in"];
    case "franchise":
      return ["franchise-visibility"];
    default:
      return ["global-visibility", "edit", "delete", "franchises"];
  }
}

/** Actions that belong to the master catalogue, never to a per-destination view. */
const CATALOGUE_ACTIONS: readonly ShopProductRowAction[] = [
  "edit",
  "delete",
  "franchises",
];

// ─── Property ────────────────────────────────────────────────────────────────

describe("Property 19: Destination resolution always yields a renderable mode", () => {
  it("resolves every raw value and destination set to exactly one renderable mode", () => {
    fc.assert(
      fc.property(arbDestinationParam, arbKnownDestinations, (raw, known) => {
        const resolved = resolveDestination(raw, known);

        // Totality: resolution never throws and never yields a fourth state.
        expect(RENDERABLE_KINDS).toContain(resolved.kind);

        // Every mode is fully resolved — no partial state can reach a renderer.
        if (resolved.kind === "clinic") {
          expect(typeof resolved.clinicId).toBe("string");
          expect(resolved.clinicId.length).toBeGreaterThan(0);
          // Clinic_Mode is only ever entered for a Core Clinic that exists, so
          // a franchise-owned clinic id or an unknown uuid can never get here.
          expect(known.clinicIds).toContain(resolved.clinicId);
        } else if (resolved.kind === "franchise") {
          expect(typeof resolved.franchiseId).toBe("string");
          expect(resolved.franchiseId.length).toBeGreaterThan(0);
          expect(known.franchiseIds).toContain(resolved.franchiseId);
        } else {
          expect(resolved.notice === null || typeof resolved.notice === "string")
            .toBe(true);
        }

        // The resolution itself matches the requirements-derived reference.
        expect(resolved).toEqual(referenceResolve(raw, known));

        // Resolution is deterministic — same inputs, same mode.
        expect(resolveDestination(raw, known)).toEqual(resolved);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("carries a notice on every fallback and no notice on a genuine All Clinics request", () => {
    fc.assert(
      fc.property(arbDestinationParam, arbKnownDestinations, (raw, known) => {
        const resolved = resolveDestination(raw, known);
        if (resolved.kind !== "all-clinics") return;

        const value = (raw ?? "").trim();
        const requestedAllClinics =
          known.loadFailed !== true &&
          (value === "" || value.toLowerCase() === ALL_CLINICS_DESTINATION_VALUE);

        if (requestedAllClinics) {
          // The default, not a fallback (Req 5.2).
          expect(resolved.notice).toBeNull();
          return;
        }

        // A fallback always explains itself (Req 5.11, 5.12).
        expect(resolved.notice).not.toBeNull();
        expect(resolved.notice).toEqual(
          known.loadFailed === true
            ? DESTINATION_LIST_LOAD_FAILED_NOTICE
            : DESTINATION_UNAVAILABLE_NOTICE,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("offers exactly the row actions the resolved mode allows", () => {
    fc.assert(
      fc.property(arbDestinationParam, arbKnownDestinations, (raw, known) => {
        const resolved = resolveDestination(raw, known);
        const actions = rowActionsForDestination(resolved);

        // Exactly the mode's action set, with no duplicates.
        expect([...actions]).toEqual([...referenceRowActions(resolved)]);
        expect(new Set(actions).size).toBe(actions.length);

        if (resolved.kind === "clinic") {
          // Exactly two actions (Req 5.7) and none of the catalogue ones (5.8).
          expect(actions).toHaveLength(2);
          expect(actions).toContain("clinic-visibility");
          expect(actions).toContain("stock-in");
          for (const action of CATALOGUE_ACTIONS) {
            expect(actions).not.toContain(action);
          }
        } else if (resolved.kind === "franchise") {
          // Exactly one action (Req 19.2); no stock-in or catalogue actions (19.3).
          expect(actions).toEqual(["franchise-visibility"]);
          expect(actions).not.toContain("stock-in");
          for (const action of CATALOGUE_ACTIONS) {
            expect(actions).not.toContain(action);
          }
        } else {
          // All_Clinics_Mode never offers stock entry (Req 5.4).
          expect(actions).not.toContain("stock-in");
          expect(actions).toContain("global-visibility");
        }

        // A visibility toggle is always present, and never two of them: the
        // toggle a row shows is the one that belongs to the rendered mode.
        const visibilityActions = actions.filter((action) =>
          action.endsWith("visibility"),
        );
        expect(visibilityActions).toHaveLength(1);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("round-trips a resolved destination through the search-param format", () => {
    fc.assert(
      fc.property(arbDestinationParam, arbKnownDestinations, (raw, known) => {
        const resolved = resolveDestination(raw, known);
        const param = formatDestinationParam(resolved);
        const reresolved = resolveDestination(param, known);

        // Re-resolving the formatted value yields the same mode, so navigating
        // to the selector's own href cannot change what is rendered.
        expect(reresolved.kind).toBe(resolved.kind);
        if (resolved.kind === "clinic" && reresolved.kind === "clinic") {
          expect(reresolved.clinicId).toBe(resolved.clinicId);
        }
        if (resolved.kind === "franchise" && reresolved.kind === "franchise") {
          expect(reresolved.franchiseId).toBe(resolved.franchiseId);
        }
        if (resolved.kind === "all-clinics") {
          // All Clinics is written as the bare `all` value, which is a genuine
          // request rather than a fallback — the notice does not survive, and
          // a failed option-list load still reports itself (Req 5.12).
          expect(param).toBe(ALL_CLINICS_DESTINATION_VALUE);
        }

        // Formatting is stable under a second pass.
        expect(formatDestinationParam(reresolved)).toBe(param);
        expect(rowActionsForDestination(reresolved)).toEqual(
          rowActionsForDestination(resolved),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
