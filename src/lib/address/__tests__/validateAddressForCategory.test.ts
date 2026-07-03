// src/lib/address/__tests__/validateAddressForCategory.test.ts
//
// Unit tests for category-aware address validation.
// Validates: Requirements 3.1, 3.2, 3.3, 3.4

import { describe, it, expect } from "vitest";
import { validateAddressForCategory } from "../validatePincode";

describe("validateAddressForCategory", () => {
  const serviceablePincodes = ["500001", "500002", "500003"];

  describe("KIT category", () => {
    it("accepts valid 6-digit PIN codes without serviceability check (Req 3.1, 3.2)", () => {
      const result = validateAddressForCategory(
        { pincode: "123456" },
        "KIT"
      );

      expect(result.valid).toBe(true);
      expect("serviceable" in result).toBe(false); // KIT result should not have serviceable field
    });

    it("accepts PINs outside service area (Req 3.4)", () => {
      const result = validateAddressForCategory(
        { pincode: "999999" },
        "KIT"
      );

      expect(result.valid).toBe(true);
    });

    it("rejects invalid PIN format", () => {
      const result = validateAddressForCategory(
        { pincode: "12345" }, // Only 5 digits
        "KIT"
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain("6 digits");
    });

    it("rejects non-numeric PINs", () => {
      const result = validateAddressForCategory(
        { pincode: "ABC123" },
        "KIT"
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain("6 digits");
    });
  });

  describe("MEAL category", () => {
    it("enforces serviceability check (Req 3.3)", () => {
      const result = validateAddressForCategory(
        { pincode: "500001" },
        "MEAL",
        serviceablePincodes
      );

      expect(result.valid).toBe(true);
      expect("serviceable" in result).toBe(true);
      expect((result as any).serviceable).toBe(true);
    });

    it("rejects non-serviceable PINs", () => {
      const result = validateAddressForCategory(
        { pincode: "600001" },
        "MEAL",
        serviceablePincodes
      );

      expect(result.valid).toBe(true);
      expect("serviceable" in result).toBe(true);
      expect((result as any).serviceable).toBe(false);
      expect(result.error).toContain("don't deliver");
    });

    it("accepts 5-series PINs as serviceable", () => {
      const result = validateAddressForCategory(
        { pincode: "500099" },
        "MEAL",
        serviceablePincodes
      );

      expect(result.valid).toBe(true);
      expect((result as any).serviceable).toBe(true);
    });

    it("rejects invalid PIN format", () => {
      const result = validateAddressForCategory(
        { pincode: "12345" },
        "MEAL",
        serviceablePincodes
      );

      expect(result.valid).toBe(false);
      expect((result as any).serviceable).toBe(false);
      expect(result.error).toContain("6 digits");
    });
  });

  describe("ACCOMMODATION category", () => {
    it("enforces serviceability like MEAL category", () => {
      const result = validateAddressForCategory(
        { pincode: "500001" },
        "ACCOMMODATION",
        serviceablePincodes
      );

      expect(result.valid).toBe(true);
      expect("serviceable" in result).toBe(true);
      expect((result as any).serviceable).toBe(true);
    });

    it("rejects non-serviceable PINs", () => {
      const result = validateAddressForCategory(
        { pincode: "600001" },
        "ACCOMMODATION",
        serviceablePincodes
      );

      expect(result.valid).toBe(true);
      expect((result as any).serviceable).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("handles PIN codes with whitespace", () => {
      const result = validateAddressForCategory(
        { pincode: " 123456 " },
        "KIT"
      );

      expect(result.valid).toBe(true);
    });

    it("handles empty service area for MEAL category", () => {
      const result = validateAddressForCategory(
        { pincode: "500001" },
        "MEAL",
        []
      );

      // Should fail serviceability with empty service area (unless it's 5-series)
      expect(result.valid).toBe(true);
      expect((result as any).serviceable).toBe(true); // 5-series PIN
    });
  });
});
