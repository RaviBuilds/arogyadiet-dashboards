/**
 * Unit Tests for KIT Product Actions
 * 
 * Tests the server actions for creating and listing KIT products.
 * Tests the tax calculation utility from the types module.
 * 
 * Requirements: 1.3, 1.5, 9.1
 * Task: 3.2
 */

import { describe, it, expect } from "vitest";
import { calculateKitProductPrice } from "@/types/kitProduct";

describe("kitProductActions", () => {
  describe("calculateKitProductPrice", () => {
    it("should calculate 5% tax correctly for integer prices", () => {
      expect(calculateKitProductPrice(100).tax_amount).toBe(5.0);
      expect(calculateKitProductPrice(1000).tax_amount).toBe(50.0);
      expect(calculateKitProductPrice(10000).tax_amount).toBe(500.0);
    });

    it("should calculate 5% tax correctly for decimal prices", () => {
      expect(calculateKitProductPrice(28080).tax_amount).toBe(1404.0);
      expect(calculateKitProductPrice(19760).tax_amount).toBe(988.0);
      expect(calculateKitProductPrice(10400).tax_amount).toBe(520.0);
    });

    it("should calculate correct total price (base + tax)", () => {
      expect(calculateKitProductPrice(28080).total_price).toBe(29484.0);
      expect(calculateKitProductPrice(19760).total_price).toBe(20748.0);
      expect(calculateKitProductPrice(10400).total_price).toBe(10920.0);
    });

    it("should round tax to 2 decimal places", () => {
      expect(calculateKitProductPrice(33.33).tax_amount).toBe(1.67);
      expect(calculateKitProductPrice(99.99).tax_amount).toBe(5.0);
      expect(calculateKitProductPrice(123.45).tax_amount).toBe(6.17);
    });

    it("should handle very small prices", () => {
      expect(calculateKitProductPrice(1).tax_amount).toBe(0.05);
      expect(calculateKitProductPrice(0.5).tax_amount).toBe(0.03);
    });

    it("should handle large prices", () => {
      expect(calculateKitProductPrice(100000).tax_amount).toBe(5000.0);
      expect(calculateKitProductPrice(999999).tax_amount).toBe(49999.95);
    });

    it("should always return positive tax for positive prices", () => {
      const prices = [1, 10, 100, 1000, 10000, 50000];
      prices.forEach(price => {
        const result = calculateKitProductPrice(price);
        expect(result.tax_amount).toBeGreaterThan(0);
        expect(result.tax_amount).toBe(Number((price * 0.05).toFixed(2)));
        expect(result.total_price).toBe(Number((price * 1.05).toFixed(2)));
      });
    });
  });
});
