// src/lib/auth/__tests__/franchise-route-gate.test.ts
//
// franchise-scoped-access Task 4.
//
// Two things are pinned here:
//
//  1. THE FIX — four Franchise_Portal route families used to canonicalise onto
//     admin paths that no classifier recognised, so `classifyAdminPath` returned
//     `null`, the paths were treated as NEUTRAL, and every access level could
//     reach them regardless of granted groups.
//
//  2. THE CORE-BUSINESS GUARANTEE — `toCanonicalPath(p, "/admin")` must remain
//     the identity function for every input. The admin portal's route gate is
//     built entirely on that, so this is the assertion that keeps the alias map
//     from leaking into Core Business behaviour.

import { describe, it, expect } from "vitest";
import {
  toCanonicalPath,
  isPortalPathAllowed,
  classifyOperationsGroup,
  validateFranchiseOperationsAccessInput,
  isFranchiseOperationsGroup,
  FRANCHISE_OPERATIONS_GROUPS,
  OPERATIONS_GROUPS,
  type AccessConfiguration,
  type OperationsAccess,
} from "@/lib/auth/adminAccessCore";

// ─── Core Business must not move ─────────────────────────────────────────────

describe("toCanonicalPath — /admin identity (Core Business guarantee)", () => {
  const ADMIN_PATHS = [
    "/admin",
    "/admin/dashboard",
    "/admin/customers",
    "/admin/customers/123",
    "/admin/customers/123/report-card",
    "/admin/kitchen-shop",
    "/admin/inventory",
    "/admin/operations",
    "/admin/franchises",
    "/admin/subscriptions",
    "/admin/riders",
    "/admin/profile",
    // Paths that COLLIDE with the franchise alias segments: proof the alias map
    // is scoped to the franchise base and cannot rewrite an admin path.
    "/admin/shop-products",
    "/admin/orders",
    "/admin/disputes",
    "/admin/reports",
    // Degenerate / unrelated inputs.
    "/",
    "/login",
    "/franchise/customers",
  ];

  it.each(ADMIN_PATHS)("leaves %s untouched on the /admin base", (path) => {
    expect(toCanonicalPath(path, "/admin")).toBe(path);
  });

  it("defaults to the /admin base, so an omitted base is also the identity", () => {
    for (const path of ADMIN_PATHS) {
      expect(toCanonicalPath(path)).toBe(path);
    }
  });
});

// ─── The alias map ───────────────────────────────────────────────────────────

describe("toCanonicalPath — franchise aliases", () => {
  it.each([
    ["/franchise/shop-products", "/admin/kitchen-shop"],
    ["/franchise/orders", "/admin/operations"],
    ["/franchise/disputes", "/admin/operations"],
    ["/franchise/reports", "/admin/operations"],
  ])("maps %s to %s", (franchisePath, expected) => {
    expect(toCanonicalPath(franchisePath, "/franchise")).toBe(expected);
  });

  it.each([
    ["/franchise/shop-products/assisted-order", "/admin/kitchen-shop/assisted-order"],
    ["/franchise/orders/123", "/admin/operations/123"],
    ["/franchise/reports/revenue/2026", "/admin/operations/revenue/2026"],
  ])("preserves the nested remainder: %s -> %s", (franchisePath, expected) => {
    expect(toCanonicalPath(franchisePath, "/franchise")).toBe(expected);
  });

  it("does not alias a path that merely shares a prefix substring", () => {
    // `/franchise/ordersXYZ` is a different route family: segment-boundary
    // matching must not treat it as `/franchise/orders`.
    expect(toCanonicalPath("/franchise/ordersXYZ", "/franchise")).toBe(
      "/admin/ordersXYZ",
    );
    expect(toCanonicalPath("/franchise/reports-archive", "/franchise")).toBe(
      "/admin/reports-archive",
    );
  });

  it("still applies the generic rewrite to non-aliased franchise paths", () => {
    expect(toCanonicalPath("/franchise", "/franchise")).toBe("/admin");
    expect(toCanonicalPath("/franchise/customers", "/franchise")).toBe(
      "/admin/customers",
    );
    expect(toCanonicalPath("/franchise/customers/9", "/franchise")).toBe(
      "/admin/customers/9",
    );
    expect(toCanonicalPath("/franchise/inventory", "/franchise")).toBe(
      "/admin/inventory",
    );
  });

  it("routes each alias to a path the group classifier recognises", () => {
    // This is the property that actually closes the hole: before the alias map
    // these canonical paths classified to `null` (neutral).
    expect(classifyOperationsGroup(toCanonicalPath("/franchise/shop-products", "/franchise")))
      .toBe("shop_products");
    expect(classifyOperationsGroup(toCanonicalPath("/franchise/orders", "/franchise")))
      .toBe("operations");
    expect(classifyOperationsGroup(toCanonicalPath("/franchise/disputes", "/franchise")))
      .toBe("operations");
    expect(classifyOperationsGroup(toCanonicalPath("/franchise/reports", "/franchise")))
      .toBe("operations");
  });
});

// ─── The gate, end to end ────────────────────────────────────────────────────

const operationsConfig = (groups: OperationsAccess): AccessConfiguration => ({
  level: "operations",
  groups,
});

describe("isPortalPathAllowed — franchise route gate", () => {
  const customersOnly = operationsConfig({ customers: "view" });

  it.each([
    "/franchise/shop-products",
    "/franchise/shop-products/assisted-order",
    "/franchise/orders",
    "/franchise/disputes",
    "/franchise/reports",
  ])("denies %s to a franchise user granted only the customers group", (path) => {
    expect(isPortalPathAllowed(customersOnly, path, "/franchise")).toBe(false);
  });

  it("still allows the granted group", () => {
    expect(isPortalPathAllowed(customersOnly, "/franchise/customers", "/franchise")).toBe(true);
    expect(
      isPortalPathAllowed(customersOnly, "/franchise/customers/1", "/franchise"),
    ).toBe(true);
  });

  it("allows shop-products once the shop_products group is granted", () => {
    const cfg = operationsConfig({ shop_products: "manage" });
    expect(isPortalPathAllowed(cfg, "/franchise/shop-products", "/franchise")).toBe(true);
    // …and orders/disputes/reports remain denied, since those are `operations`.
    expect(isPortalPathAllowed(cfg, "/franchise/orders", "/franchise")).toBe(false);
  });

  it("allows orders / disputes / reports once the operations group is granted", () => {
    const cfg = operationsConfig({ operations: "view" });
    for (const path of [
      "/franchise/orders",
      "/franchise/disputes",
      "/franchise/reports",
    ]) {
      expect(isPortalPathAllowed(cfg, path, "/franchise")).toBe(true);
    }
    expect(isPortalPathAllowed(cfg, "/franchise/shop-products", "/franchise")).toBe(false);
  });

  it("the Franchise_Owner (full access) reaches every franchise route", () => {
    const owner: AccessConfiguration = {
      level: "inventory_operations",
      groups: {},
    };
    for (const path of [
      "/franchise/customers",
      "/franchise/shop-products",
      "/franchise/orders",
      "/franchise/disputes",
      "/franchise/reports",
      "/franchise/inventory",
      "/franchise/dashboard",
    ]) {
      expect(isPortalPathAllowed(owner, path, "/franchise")).toBe(true);
    }
  });

  it("a franchise Dietitian is confined to the allow-list, aliases included", () => {
    const dietitian: AccessConfiguration = { level: "dietitian", groups: {} };
    expect(isPortalPathAllowed(dietitian, "/franchise/customers", "/franchise")).toBe(true);
    expect(isPortalPathAllowed(dietitian, "/franchise/log-customer", "/franchise")).toBe(true);
    expect(isPortalPathAllowed(dietitian, "/franchise/profile", "/franchise")).toBe(true);
    for (const path of [
      "/franchise/shop-products",
      "/franchise/orders",
      "/franchise/disputes",
      "/franchise/reports",
      "/franchise/dashboard",
    ]) {
      expect(isPortalPathAllowed(dietitian, path, "/franchise")).toBe(false);
    }
  });

  it("the admin portal's own gate is unchanged by the alias map", () => {
    const cfg = operationsConfig({ shop_products: "manage" });
    // /admin/kitchen-shop is the shop_products surface on the admin side.
    expect(isPortalPathAllowed(cfg, "/admin/kitchen-shop", "/admin")).toBe(true);
    // /admin/orders etc. are NOT admin routes and stay neutral, exactly as
    // before — the aliases must not have invented admin classifications.
    expect(isPortalPathAllowed(cfg, "/admin/orders", "/admin")).toBe(true);
    expect(isPortalPathAllowed(cfg, "/admin/reports", "/admin")).toBe(true);
    // A real admin operations page remains gated by its own group.
    expect(isPortalPathAllowed(cfg, "/admin/customers", "/admin")).toBe(false);
  });
});

// ─── Franchise group vocabulary ──────────────────────────────────────────────

describe("FRANCHISE_OPERATIONS_GROUPS", () => {
  it("is the admin set minus `franchises`", () => {
    expect([...FRANCHISE_OPERATIONS_GROUPS].sort()).toEqual(
      [...OPERATIONS_GROUPS].filter((g) => g !== "franchises").sort(),
    );
  });

  it("excludes `franchises`, which is a Core network-management surface", () => {
    expect(isFranchiseOperationsGroup("franchises")).toBe(false);
    expect(isFranchiseOperationsGroup("customers")).toBe(true);
    expect(isFranchiseOperationsGroup("nonsense")).toBe(false);
  });
});

describe("validateFranchiseOperationsAccessInput", () => {
  it("accepts a valid franchise selection", () => {
    const result = validateFranchiseOperationsAccessInput({
      customers: "manage",
      riders: "view",
    });
    expect(result).toEqual({
      ok: true,
      value: { customers: "manage", riders: "view" },
    });
  });

  it("rejects the `franchises` group with a specific message", () => {
    const result = validateFranchiseOperationsAccessInput({
      customers: "manage",
      franchises: "manage",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not available to a franchise user");
    }
  });

  it("still rejects an empty selection", () => {
    expect(validateFranchiseOperationsAccessInput({}).ok).toBe(false);
  });

  it("still rejects an unknown group and an invalid permission", () => {
    expect(validateFranchiseOperationsAccessInput({ nope: "manage" }).ok).toBe(false);
    expect(
      validateFranchiseOperationsAccessInput({ customers: "sometimes" }).ok,
    ).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(validateFranchiseOperationsAccessInput(null).ok).toBe(false);
    expect(validateFranchiseOperationsAccessInput([]).ok).toBe(false);
    expect(validateFranchiseOperationsAccessInput("customers").ok).toBe(false);
  });
});
