import { describe, it, expect } from "vitest";
import { filterByScope, type ScopedRow } from "./scope-predicate";

describe("filterByScope", () => {
  const rows: ScopedRow[] = [
    { franchise_id: "f-1", product: "A", quantity: 10 },
    { franchise_id: "f-2", product: "B", quantity: 5 },
    { franchise_id: "f-1", product: "C", quantity: 3 },
    { franchise_id: "f-3", product: "D", quantity: 7 },
  ];

  it("returns only rows matching the caller's franchise_id", () => {
    const result = filterByScope(rows, "f-1");
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.franchise_id === "f-1")).toBe(true);
  });

  it("returns an empty array when no rows match", () => {
    const result = filterByScope(rows, "f-unknown");
    expect(result).toEqual([]);
  });

  it("returns all rows when all belong to the caller", () => {
    const singleFranchiseRows: ScopedRow[] = [
      { franchise_id: "f-x", a: 1 },
      { franchise_id: "f-x", b: 2 },
    ];
    const result = filterByScope(singleFranchiseRows, "f-x");
    expect(result).toHaveLength(2);
  });

  it("handles an empty input array", () => {
    const result = filterByScope([], "f-1");
    expect(result).toEqual([]);
  });

  it("preserves the original row shape and order", () => {
    interface LedgerRow extends ScopedRow {
      id: number;
      direction: string;
    }

    const ledgerRows: LedgerRow[] = [
      { franchise_id: "f-1", id: 1, direction: "IN" },
      { franchise_id: "f-2", id: 2, direction: "OUT" },
      { franchise_id: "f-1", id: 3, direction: "OUT" },
    ];

    const result = filterByScope(ledgerRows, "f-1");
    expect(result).toEqual([
      { franchise_id: "f-1", id: 1, direction: "IN" },
      { franchise_id: "f-1", id: 3, direction: "OUT" },
    ]);
  });

  it("does not mutate the original array", () => {
    const original = [...rows];
    filterByScope(rows, "f-1");
    expect(rows).toEqual(original);
  });
});
