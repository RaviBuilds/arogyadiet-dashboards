// src/test/inventory/admin-pages-no-product-management.test.ts
//
// Structural/source-code verification test: Admin inventory pages do NOT pass
// productManagement={true} to shared components. This ensures that the Admin
// portal renders without register/edit/delete product controls.
//
// Requirements: 1.1, 1.2, 1.3

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ADMIN_INVENTORY_DIR = path.resolve(
  __dirname,
  "../../app/admin/inventory",
);

/**
 * Read a source file relative to the admin inventory directory.
 */
function readAdminFile(relativePath: string): string {
  const filePath = path.join(ADMIN_INVENTORY_DIR, relativePath);
  return fs.readFileSync(filePath, "utf-8");
}

describe("Admin Inventory Pages — no product management", () => {
  describe("page.tsx (Master Catalog)", () => {
    let source: string;

    beforeAll(() => {
      source = readAdminFile("page.tsx");
    });

    it("does not pass productManagement={true} as a JSX prop", () => {
      expect(source).not.toMatch(/productManagement\s*=\s*\{?\s*true\s*\}?/);
    });

    it("does not set productManagement: true in any object", () => {
      expect(source).not.toMatch(/productManagement\s*:\s*true/);
    });

    it("renders InventoryDashboard (shared component still used)", () => {
      expect(source).toContain("InventoryDashboard");
    });

    it("renders InventoryMetrics (non-product controls remain)", () => {
      expect(source).toContain("InventoryMetrics");
    });
  });

  describe("layout.tsx", () => {
    let source: string;

    beforeAll(() => {
      source = readAdminFile("layout.tsx");
    });

    it("does not pass productManagement={true} as a JSX prop", () => {
      expect(source).not.toMatch(/productManagement\s*=\s*\{?\s*true\s*\}?/);
    });

    it("does not set productManagement: true in any object", () => {
      expect(source).not.toMatch(/productManagement\s*:\s*true/);
    });

    it("renders InventoryHeader (non-product navigation remains)", () => {
      expect(source).toContain("InventoryHeader");
    });

    it("renders OperationsCart (non-product operations remain)", () => {
      expect(source).toContain("OperationsCart");
    });
  });

  describe("manufacturing/page.tsx", () => {
    let source: string;

    beforeAll(() => {
      source = readAdminFile("manufacturing/page.tsx");
    });

    it("does not pass productManagement={true}", () => {
      expect(source).not.toMatch(/productManagement\s*=\s*\{?\s*true\s*\}?/);
    });

    it("does not set productManagement: true", () => {
      expect(source).not.toMatch(/productManagement\s*:\s*true/);
    });

    it("renders ManufacturingHubClient (non-product operations remain)", () => {
      expect(source).toContain("ManufacturingHubClient");
    });
  });

  describe("mappings/page.tsx", () => {
    let source: string;

    beforeAll(() => {
      source = readAdminFile("mappings/page.tsx");
    });

    it("does not pass productManagement={true}", () => {
      expect(source).not.toMatch(/productManagement\s*=\s*\{?\s*true\s*\}?/);
    });

    it("does not set productManagement: true", () => {
      expect(source).not.toMatch(/productManagement\s*:\s*true/);
    });

    it("renders ProductMappingClient (non-product operations remain)", () => {
      expect(source).toContain("ProductMappingClient");
    });
  });

  describe("ledger/page.tsx", () => {
    let source: string;

    beforeAll(() => {
      source = readAdminFile("ledger/page.tsx");
    });

    it("does not pass productManagement={true}", () => {
      expect(source).not.toMatch(/productManagement\s*=\s*\{?\s*true\s*\}?/);
    });

    it("does not set productManagement: true", () => {
      expect(source).not.toMatch(/productManagement\s*:\s*true/);
    });

    it("renders LedgerWorkspace (audit ledger remains accessible)", () => {
      expect(source).toContain("LedgerWorkspace");
    });
  });
});
