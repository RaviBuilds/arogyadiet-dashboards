// src/test/inventory/entry-return-controls.test.ts
//
// Structural/source-code verification tests for the Inventory BI entry ("Access
// Warehouse") and return ("Back to Inventory BI") controls.
//
// Requirements: 2.1, 2.2, 2.5

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

const MASTER_INVENTORY_DIR = path.resolve(
  __dirname,
  "../../app/master/(main)/inventory",
);

function readMasterFile(relativePath: string): string {
  const filePath = path.join(MASTER_INVENTORY_DIR, relativePath);
  return fs.readFileSync(filePath, "utf-8");
}

describe("Entry/Return Controls — InventoryIntelligenceShell", () => {
  let source: string;

  beforeAll(() => {
    source = readMasterFile("InventoryIntelligenceShell.tsx");
  });

  it('contains "Access Warehouse" text', () => {
    expect(source).toContain("Access Warehouse");
  });

  it('links "Access Warehouse" to /inventory/warehouse', () => {
    // The Link component should have href="/inventory/warehouse"
    expect(source).toMatch(/href\s*=\s*["']\/inventory\/warehouse["']/);
  });

  it('"Access Warehouse" is rendered only on the Warehouse tab (not on Shop Products)', () => {
    // The component early-returns for tab === "shop" before any "Access Warehouse"
    // rendering. Verify: when tab is "shop", the returned JSX does NOT contain
    // "Access Warehouse". We check that:
    // 1. There is a conditional early return for the shop tab
    // 2. "Access Warehouse" only appears AFTER that early return (in the warehouse branch)

    // The shop tab branch returns early with just tabBar + ShopProductsView
    const shopReturnMatch = source.match(
      /if\s*\(\s*tab\s*===\s*["']shop["']\s*\)\s*\{?\s*return\s*\(/,
    );
    expect(shopReturnMatch).not.toBeNull();

    // Get the position of the shop early return
    const shopReturnIndex = source.indexOf(shopReturnMatch![0]);

    // The "Access Warehouse" text should NOT appear before the shop early return
    // (it should only appear in the warehouse branch that follows)
    const accessWarehouseBeforeShopReturn = source
      .slice(0, shopReturnIndex)
      .includes("Access Warehouse");
    expect(accessWarehouseBeforeShopReturn).toBe(false);

    // Confirm "Access Warehouse" only appears after the shop return
    const accessWarehouseAfterShopReturn = source
      .slice(shopReturnIndex)
      .includes("Access Warehouse");
    expect(accessWarehouseAfterShopReturn).toBe(true);
  });
});

describe("Entry/Return Controls — warehouse/layout.tsx", () => {
  let source: string;

  beforeAll(() => {
    source = readMasterFile("warehouse/layout.tsx");
  });

  it('contains "Back to Inventory BI" text', () => {
    expect(source).toContain("Back to Inventory BI");
  });

  it('"Back to Inventory BI" links to /inventory', () => {
    // The Link should have href="/inventory"
    expect(source).toMatch(/href\s*=\s*["']\/inventory["']/);
  });

  it("uses next/link for client-side navigation", () => {
    expect(source).toMatch(/import\s+.*Link.*\s+from\s+["']next\/link["']/);
  });
});
