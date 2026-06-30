// src/lib/franchise-inventory/__tests__/fifo-depletion.test.ts
// Unit tests for the FIFO depletion function.
// Requirements validated: 10.2, 12.5

import { describe, it, expect } from "vitest";
import {
  computeFifoDepletion,
  type DepletableLot,
} from "../fifo-depletion";

describe("computeFifoDepletion", () => {
  const makeLot = (
    id: string,
    batchNumber: string,
    quantityRemaining: number,
    expiryDate: string,
    receivedAt: string,
  ): DepletableLot => ({
    id,
    batchNumber,
    quantityRemaining,
    expiryDate,
    receivedAt,
  });

  describe("successful depletion", () => {
    it("depletes a single lot partially", () => {
      const lots = [makeLot("lot-1", "B001", 10, "2025-03-01", "2025-01-01")];
      const result = computeFifoDepletion(lots, 4);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.totalDepleted).toBe(4);
      expect(result.plan).toHaveLength(1);
      expect(result.plan[0]).toEqual({
        lotId: "lot-1",
        batchNumber: "B001",
        quantityDepleted: 4,
        expiryDate: "2025-03-01",
        remainingAfter: 6,
      });
    });

    it("depletes a single lot fully", () => {
      const lots = [makeLot("lot-1", "B001", 5, "2025-03-01", "2025-01-01")];
      const result = computeFifoDepletion(lots, 5);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.totalDepleted).toBe(5);
      expect(result.plan).toHaveLength(1);
      expect(result.plan[0].quantityDepleted).toBe(5);
      expect(result.plan[0].remainingAfter).toBe(0);
    });

    it("depletes earliest-expiry lot first, spanning multiple lots", () => {
      const lots = [
        makeLot("lot-1", "B001", 3, "2025-02-01", "2025-01-01"),
        makeLot("lot-2", "B002", 5, "2025-03-01", "2025-01-05"),
        makeLot("lot-3", "B003", 4, "2025-04-01", "2025-01-10"),
      ];
      const result = computeFifoDepletion(lots, 7);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.totalDepleted).toBe(7);
      expect(result.plan).toHaveLength(2);

      // First lot fully consumed
      expect(result.plan[0]).toEqual({
        lotId: "lot-1",
        batchNumber: "B001",
        quantityDepleted: 3,
        expiryDate: "2025-02-01",
        remainingAfter: 0,
      });

      // Second lot partially consumed
      expect(result.plan[1]).toEqual({
        lotId: "lot-2",
        batchNumber: "B002",
        quantityDepleted: 4,
        expiryDate: "2025-03-01",
        remainingAfter: 1,
      });
    });

    it("depletes all lots when quantity equals total available", () => {
      const lots = [
        makeLot("lot-1", "B001", 3, "2025-02-01", "2025-01-01"),
        makeLot("lot-2", "B002", 5, "2025-03-01", "2025-01-05"),
      ];
      const result = computeFifoDepletion(lots, 8);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.totalDepleted).toBe(8);
      expect(result.plan).toHaveLength(2);
      expect(result.plan[0].remainingAfter).toBe(0);
      expect(result.plan[1].remainingAfter).toBe(0);
    });

    it("handles same-expiry lots ordered by received_at (tie-break)", () => {
      const lots = [
        makeLot("lot-early", "B001", 2, "2025-03-01", "2025-01-01"),
        makeLot("lot-later", "B002", 4, "2025-03-01", "2025-01-05"),
      ];
      // Lots have same expiry, so caller sorted by receivedAt ASC.
      // lot-early should be depleted first.
      const result = computeFifoDepletion(lots, 3);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.plan).toHaveLength(2);
      expect(result.plan[0].lotId).toBe("lot-early");
      expect(result.plan[0].quantityDepleted).toBe(2);
      expect(result.plan[0].remainingAfter).toBe(0);
      expect(result.plan[1].lotId).toBe("lot-later");
      expect(result.plan[1].quantityDepleted).toBe(1);
      expect(result.plan[1].remainingAfter).toBe(3);
    });

    it("returns an empty plan when quantity is zero", () => {
      const lots = [makeLot("lot-1", "B001", 10, "2025-03-01", "2025-01-01")];
      const result = computeFifoDepletion(lots, 0);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.totalDepleted).toBe(0);
      expect(result.plan).toHaveLength(0);
    });
  });

  describe("insufficient stock (error result)", () => {
    it("returns error when requested exceeds available", () => {
      const lots = [
        makeLot("lot-1", "B001", 3, "2025-02-01", "2025-01-01"),
        makeLot("lot-2", "B002", 2, "2025-03-01", "2025-01-05"),
      ];
      const result = computeFifoDepletion(lots, 10);

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.requested).toBe(10);
      expect(result.available).toBe(5);
      expect(result.error).toContain("Insufficient stock");
    });

    it("returns error when lots array is empty", () => {
      const result = computeFifoDepletion([], 1);

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.requested).toBe(1);
      expect(result.available).toBe(0);
    });

    it("returns error when quantity exceeds a single lot", () => {
      const lots = [makeLot("lot-1", "B001", 5, "2025-03-01", "2025-01-01")];
      const result = computeFifoDepletion(lots, 6);

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.requested).toBe(6);
      expect(result.available).toBe(5);
    });
  });

  describe("edge cases", () => {
    it("skips lots with zero remaining quantity", () => {
      const lots = [
        makeLot("lot-empty", "B000", 0, "2025-01-01", "2025-01-01"),
        makeLot("lot-full", "B001", 5, "2025-02-01", "2025-01-02"),
      ];
      const result = computeFifoDepletion(lots, 3);

      expect(result.success).toBe(true);
      if (!result.success) return;

      // The empty lot contributes nothing; only lot-full is in the plan
      expect(result.plan).toHaveLength(1);
      expect(result.plan[0].lotId).toBe("lot-full");
      expect(result.plan[0].quantityDepleted).toBe(3);
    });

    it("handles depletion across many lots", () => {
      const lots = Array.from({ length: 5 }, (_, i) =>
        makeLot(`lot-${i}`, `B00${i}`, 2, `2025-0${i + 1}-01`, "2025-01-01"),
      );
      const result = computeFifoDepletion(lots, 9);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.totalDepleted).toBe(9);
      // First 4 lots fully consumed (4×2=8), fifth lot partially (1 of 2)
      expect(result.plan).toHaveLength(5);
      expect(result.plan[0].remainingAfter).toBe(0);
      expect(result.plan[1].remainingAfter).toBe(0);
      expect(result.plan[2].remainingAfter).toBe(0);
      expect(result.plan[3].remainingAfter).toBe(0);
      expect(result.plan[4].quantityDepleted).toBe(1);
      expect(result.plan[4].remainingAfter).toBe(1);
    });
  });
});
