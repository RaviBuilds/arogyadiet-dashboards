// src/test/inventory/default-rendering.test.ts
//
// Unit tests for default (disabled) rendering — Requirements: 5.6
//
// Validates that when `productManagement` is not passed (defaults to `false`):
// - `RegisterProductSheet` is not rendered in the dashboard
// - The Edit/Delete dropdown on `ProductCard` is not rendered
// - Receive/Dispatch buttons ARE rendered
//
// Since @testing-library/react is not available and vitest runs in node
// environment, these tests structurally verify the component source code
// to confirm the conditional rendering branches on `productManagement`.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const COMPONENTS_DIR = resolve(
  __dirname,
  "../../shared/components/admin/inventory",
);

function readComponent(filename: string): string {
  return readFileSync(resolve(COMPONENTS_DIR, filename), "utf-8");
}

describe("Default rendering (productManagement omitted / false)", () => {
  describe("InventoryDashboard", () => {
    const source = readComponent("InventoryDashboard.tsx");

    it("declares productManagement prop with default value false", () => {
      // The destructured prop should default to false
      expect(source).toMatch(/productManagement\s*=\s*false/);
    });

    it("conditionally renders RegisterProductSheet only when productManagement is true", () => {
      // Every occurrence of RegisterProductSheet render should be gated
      // by a `productManagement &&` or similar conditional
      const registerSheetUsages = source.match(
        /<RegisterProductSheet[\s\S]*?\/>/g,
      );
      expect(registerSheetUsages).not.toBeNull();
      expect(registerSheetUsages!.length).toBeGreaterThan(0);

      // Each RegisterProductSheet usage must be preceded by a productManagement guard
      // Look for the pattern: {productManagement && ... <RegisterProductSheet
      const guardedBlocks = source.match(
        /productManagement\s*&&[\s\S]*?<RegisterProductSheet/g,
      );
      expect(guardedBlocks).not.toBeNull();
      expect(guardedBlocks!.length).toBe(registerSheetUsages!.length);
    });

    it("passes productManagement down to ProductCard", () => {
      // ProductCard should receive the productManagement prop
      expect(source).toMatch(
        /<ProductCard[\s\S]*?productManagement\s*=\s*\{productManagement\}/,
      );
    });
  });

  describe("ProductCard", () => {
    const source = readComponent("ProductCard.tsx");

    it("declares productManagement prop with default value false", () => {
      expect(source).toMatch(/productManagement\s*=\s*false/);
    });

    it("conditionally renders the Edit/Delete DropdownMenu only when productManagement is true", () => {
      // The DropdownMenu with MoreVertical trigger (edit/delete) should be
      // inside a `productManagement &&` guard
      expect(source).toMatch(
        /productManagement\s*&&[\s\S]*?<DropdownMenu/,
      );
    });

    it("conditionally renders EditProductModal only when productManagement is true", () => {
      expect(source).toMatch(
        /productManagement\s*&&[\s\S]*?<EditProductModal/,
      );
    });

    it("conditionally renders AlertDialog (delete confirmation) only when productManagement is true", () => {
      expect(source).toMatch(
        /productManagement\s*&&[\s\S]*?<AlertDialog/,
      );
    });

    it("always renders Receive button (not gated by productManagement)", () => {
      // The ReceiveStockModal should exist in the source
      const receiveMatch = source.match(/<ReceiveStockModal/g);
      expect(receiveMatch).not.toBeNull();
      expect(receiveMatch!.length).toBeGreaterThan(0);

      // The Receive/Dispatch section lives in a grid div that is NOT
      // inside a productManagement conditional. We verify by checking
      // that the immediate JSX block containing <ReceiveStockModal does
      // NOT start with `{productManagement &&`.
      // Split the source into lines and find the line with ReceiveStockModal,
      // then walk backward to confirm no productManagement guard wraps it.
      const lines = source.split("\n");
      const receiveLineIdx = lines.findIndex((l) =>
        l.includes("<ReceiveStockModal"),
      );
      expect(receiveLineIdx).toBeGreaterThan(-1);

      // Walk backward from the ReceiveStockModal line to the nearest
      // containing block boundary (the grid div). Ensure no
      // `productManagement &&` appears between the grid div and ReceiveStockModal.
      const blockAbove = lines
        .slice(Math.max(0, receiveLineIdx - 10), receiveLineIdx)
        .join("\n");
      // The grid div is the immediate container — it should NOT be gated
      expect(blockAbove).toMatch(/grid/);
      expect(blockAbove).not.toMatch(/productManagement\s*&&/);
    });

    it("always renders Dispatch button (not gated by productManagement)", () => {
      const dispatchMatch = source.match(/<DispatchStockModal/g);
      expect(dispatchMatch).not.toBeNull();
      expect(dispatchMatch!.length).toBeGreaterThan(0);

      // Same approach: find the DispatchStockModal line and verify
      // no productManagement guard in the immediate enclosing block
      const lines = source.split("\n");
      const dispatchLineIdx = lines.findIndex((l) =>
        l.includes("<DispatchStockModal"),
      );
      expect(dispatchLineIdx).toBeGreaterThan(-1);

      const blockAbove = lines
        .slice(Math.max(0, dispatchLineIdx - 10), dispatchLineIdx)
        .join("\n");
      expect(blockAbove).not.toMatch(/productManagement\s*&&/);
    });
  });

  describe("Component interfaces", () => {
    it("InventoryDashboard interface has optional productManagement prop", () => {
      const source = readComponent("InventoryDashboard.tsx");
      // The interface should declare productManagement as optional (with ?)
      expect(source).toMatch(/productManagement\?\s*:\s*boolean/);
    });

    it("ProductCard interface has optional productManagement prop", () => {
      const source = readComponent("ProductCard.tsx");
      expect(source).toMatch(/productManagement\?\s*:\s*boolean/);
    });
  });
});
