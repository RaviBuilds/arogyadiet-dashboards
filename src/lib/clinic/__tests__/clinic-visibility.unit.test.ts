// Feature: core-clinic-architecture, Task 16.10
//
// Example-based unit tests for the pure helpers in src/lib/clinic/visibility.ts
// that back the rider-table "Clinic" column and the clinic filter control.
// These complement the property tests (Properties 34/35) with concrete, readable
// example cases drawn directly from the acceptance criteria.
//
// Validates: Requirements 16.1, 16.2, 16.4

import { describe, it, expect } from "vitest";
import {
  clinicDisplayName,
  filterRowsByClinic,
  ALL_CLINICS,
} from "../visibility";

// A realistic small set of rider rows spanning two clinics plus one unlinked
// rider, mirroring what the Rider List / Rider Activity tables load.
type RiderRow = { id: string; name: string; clinic_id: string | null };

const RIDER_ROWS: RiderRow[] = [
  { id: "rider-1", name: "Asha", clinic_id: "clinic-1" },
  { id: "rider-2", name: "Bhavna", clinic_id: "clinic-2" },
  { id: "rider-3", name: "Chetan", clinic_id: "clinic-1" },
  { id: "rider-4", name: "Devi", clinic_id: null }, // unlinked rider
];

describe("clinicDisplayName — Clinic column cell (Req 16.1, 16.2)", () => {
  it("shows the linked clinic's name in a rider row's Clinic cell", () => {
    // Rider List & Rider Activity both render the linked clinic's name.
    expect(clinicDisplayName("Madhapur Clinic")).toBe("Madhapur Clinic");
  });

  it("shows the 'Unassigned' placeholder when a rider has no linked clinic", () => {
    expect(clinicDisplayName(null)).toBe("Unassigned");
    expect(clinicDisplayName(undefined)).toBe("Unassigned");
  });

  it("treats a blank/whitespace clinic name as unlinked and uses the placeholder", () => {
    expect(clinicDisplayName("")).toBe("Unassigned");
    expect(clinicDisplayName("   ")).toBe("Unassigned");
  });
});

describe("filterRowsByClinic — Clinic filter control (Req 16.4)", () => {
  it("'All Clinics' returns every row across both clinics and the unlinked rider", () => {
    const result = filterRowsByClinic(RIDER_ROWS, ALL_CLINICS);
    expect(result).toEqual(RIDER_ROWS);
    expect(result.map((r) => r.id)).toEqual([
      "rider-1",
      "rider-2",
      "rider-3",
      "rider-4",
    ]);
  });

  it("selecting clinic-1 returns exactly the clinic-1 rider rows", () => {
    const result = filterRowsByClinic(RIDER_ROWS, "clinic-1");
    expect(result.map((r) => r.id)).toEqual(["rider-1", "rider-3"]);
    expect(result.every((r) => r.clinic_id === "clinic-1")).toBe(true);
  });

  it("selecting clinic-2 returns exactly the single clinic-2 rider row", () => {
    const result = filterRowsByClinic(RIDER_ROWS, "clinic-2");
    expect(result.map((r) => r.id)).toEqual(["rider-2"]);
  });

  it("selecting a clinic with no rows returns an empty list", () => {
    const result = filterRowsByClinic(RIDER_ROWS, "clinic-with-no-riders");
    expect(result).toEqual([]);
  });
});
