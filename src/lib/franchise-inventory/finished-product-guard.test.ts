import { describe, it, expect } from "vitest";
import {
  guardFinishedProduct,
  type ProductForGuard,
} from "./finished-product-guard";

describe("guardFinishedProduct", () => {
  it("allows a FINISHED_GOOD product", () => {
    const product: ProductForGuard = {
      id: "prod-1",
      name: "Protein Bar",
      type: "FINISHED_GOOD",
    };

    const result = guardFinishedProduct(product);
    expect(result).toEqual({ allowed: true });
  });

  it("rejects a RAW_MATERIAL product with error details", () => {
    const product: ProductForGuard = {
      id: "prod-2",
      name: "Oats",
      type: "RAW_MATERIAL",
    };

    const result = guardFinishedProduct(product);
    expect(result.allowed).toBe(false);

    if (!result.allowed) {
      expect(result.productId).toBe("prod-2");
      expect(result.productName).toBe("Oats");
      expect(result.productType).toBe("RAW_MATERIAL");
      expect(result.error).toContain("Oats");
      expect(result.error).toContain("prod-2");
      expect(result.error).toContain("RAW_MATERIAL");
      expect(result.error).toContain("FINISHED_GOOD");
    }
  });

  it("rejects a WORK_IN_PROGRESS product", () => {
    const product: ProductForGuard = {
      id: "prod-3",
      name: "Half-Baked Cookie",
      type: "WORK_IN_PROGRESS",
    };

    const result = guardFinishedProduct(product);
    expect(result.allowed).toBe(false);

    if (!result.allowed) {
      expect(result.productId).toBe("prod-3");
      expect(result.productName).toBe("Half-Baked Cookie");
      expect(result.productType).toBe("WORK_IN_PROGRESS");
    }
  });

  it("rejects an empty-type product", () => {
    const product: ProductForGuard = {
      id: "prod-4",
      name: "Unlabeled",
      type: "",
    };

    const result = guardFinishedProduct(product);
    expect(result.allowed).toBe(false);

    if (!result.allowed) {
      expect(result.productType).toBe("");
    }
  });

  it("is case-sensitive — 'finished_good' (lowercase) is rejected", () => {
    const product: ProductForGuard = {
      id: "prod-5",
      name: "Case Test",
      type: "finished_good",
    };

    const result = guardFinishedProduct(product);
    expect(result.allowed).toBe(false);
  });
});
