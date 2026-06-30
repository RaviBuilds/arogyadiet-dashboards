// src/lib/franchise-inventory/active-destination-filter.test.ts
// Unit tests for the active-destination filter (Task 7.1)
//
// Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 13.1

import { describe, it, expect } from "vitest";
import {
  filterActiveDestinations,
  type FranchiseForDestination,
} from "./active-destination-filter";

describe("filterActiveDestinations", () => {
  it("returns franchises with status 'active'", () => {
    const franchises: FranchiseForDestination[] = [
      { id: "1", name: "Franchise A", status: "active" },
      { id: "2", name: "Franchise B", status: "active" },
    ];

    const result = filterActiveDestinations(franchises);

    expect(result).toEqual([
      { id: "1", name: "Franchise A" },
      { id: "2", name: "Franchise B" },
    ]);
  });

  it("excludes franchises with status 'onboarding'", () => {
    const franchises: FranchiseForDestination[] = [
      { id: "1", name: "Active", status: "active" },
      { id: "2", name: "Onboarding", status: "onboarding" },
    ];

    const result = filterActiveDestinations(franchises);

    expect(result).toEqual([{ id: "1", name: "Active" }]);
  });

  it("excludes franchises with status 'suspended'", () => {
    const franchises: FranchiseForDestination[] = [
      { id: "1", name: "Active", status: "active" },
      { id: "2", name: "Suspended", status: "suspended" },
    ];

    const result = filterActiveDestinations(franchises);

    expect(result).toEqual([{ id: "1", name: "Active" }]);
  });

  it("excludes franchises with any non-active status", () => {
    const franchises: FranchiseForDestination[] = [
      { id: "1", name: "Active", status: "active" },
      { id: "2", name: "Inactive", status: "inactive" },
      { id: "3", name: "Custom", status: "some_random_status" },
      { id: "4", name: "Empty", status: "" },
    ];

    const result = filterActiveDestinations(franchises);

    expect(result).toEqual([{ id: "1", name: "Active" }]);
  });

  it("returns an empty array when no franchises are active", () => {
    const franchises: FranchiseForDestination[] = [
      { id: "1", name: "Onboarding", status: "onboarding" },
      { id: "2", name: "Suspended", status: "suspended" },
    ];

    const result = filterActiveDestinations(franchises);

    expect(result).toEqual([]);
  });

  it("returns an empty array when given an empty input", () => {
    const result = filterActiveDestinations([]);

    expect(result).toEqual([]);
  });

  it("does not match 'Active' (case-sensitive — exact lowercase match)", () => {
    const franchises: FranchiseForDestination[] = [
      { id: "1", name: "Upper", status: "Active" },
      { id: "2", name: "Mixed", status: "ACTIVE" },
      { id: "3", name: "Correct", status: "active" },
    ];

    const result = filterActiveDestinations(franchises);

    expect(result).toEqual([{ id: "3", name: "Correct" }]);
  });

  it("returns only id and name, excluding status from output", () => {
    const franchises: FranchiseForDestination[] = [
      { id: "1", name: "Active One", status: "active" },
    ];

    const result = filterActiveDestinations(franchises);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: "1", name: "Active One" });
    expect(result[0]).not.toHaveProperty("status");
  });
});
