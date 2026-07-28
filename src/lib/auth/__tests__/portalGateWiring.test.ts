// src/lib/auth/__tests__/portalGateWiring.test.ts
//
// Unit tests for the portal-gate WIRING introduced by dietitian-management task
// 3.5: the middleware applies `isPortalPathAllowed` with the portal base of the
// requesting subdomain, and both portal navbars are trimmed to the three
// prefixes a Dietitian may reach.
//
// These are example tests over the concrete route sets the two portals actually
// serve (the universal properties of the gate itself are covered separately).
// No Supabase connection and no React rendering are involved.

import { describe, it, expect } from "vitest";
import {
  ADMIN_ACCESS_LEVELS,
  isPortalPathAllowed,
  isAdminPathAllowed,
  landingRouteFor,
  type AccessConfiguration,
  type AdminAccessLevel,
} from "../adminAccessCore";

/** The Dietitian configuration as `resolveAccessConfiguration` yields it. */
const DIETITIAN: AccessConfiguration = { level: "dietitian", groups: {} };

/** The Franchise_Owner override the franchise layout/middleware applies (Req 21.6). */
const OWNER: AccessConfiguration = { level: "inventory_operations", groups: {} };

/** Every route the franchise portal's `(main)` group serves, plus the new ones. */
const FRANCHISE_ROUTES = [
  "/franchise/dashboard",
  "/franchise/customers",
  "/franchise/customers/8f1b8a52-1d3a-4c0e-9f2a-6c0d1e2f3a4b",
  "/franchise/customers/8f1b8a52-1d3a-4c0e-9f2a-6c0d1e2f3a4b/report-card",
  "/franchise/subscriptions",
  "/franchise/riders",
  "/franchise/operations",
  "/franchise/inventory",
  "/franchise/shop-products",
  "/franchise/orders",
  "/franchise/disputes",
  "/franchise/reports",
  "/franchise/profile",
  "/franchise/log-customer",
  "/franchise/dietitian-activity",
] as const;

/** The three nav items both navbars render for a Dietitian (portal-relative). */
const DIETITIAN_NAV_HREFS = ["/customers", "/log-customer", "/profile"] as const;

describe("middleware wiring — admin base", () => {
  it("is byte-identical to the previous isAdminPathAllowed call for every level", () => {
    const paths = [
      "/admin/dashboard",
      "/admin/customers",
      "/admin/customers/1/report-card",
      "/admin/subscriptions",
      "/admin/riders",
      "/admin/operations",
      "/admin/kitchen-shop",
      "/admin/franchises",
      "/admin/inventory",
      "/admin/profile",
      "/admin/log-customer",
    ];
    for (const level of ADMIN_ACCESS_LEVELS) {
      const config: AccessConfiguration = { level, groups: {} };
      for (const path of paths) {
        expect(isPortalPathAllowed(config, path, "/admin")).toBe(
          isAdminPathAllowed(config, path),
        );
      }
    }
  });

  it("restricts a Dietitian to customers / log-customer / profile", () => {
    expect(isPortalPathAllowed(DIETITIAN, "/admin/customers", "/admin")).toBe(true);
    expect(
      isPortalPathAllowed(DIETITIAN, "/admin/customers/1/report-card", "/admin"),
    ).toBe(true);
    expect(isPortalPathAllowed(DIETITIAN, "/admin/log-customer", "/admin")).toBe(true);
    expect(isPortalPathAllowed(DIETITIAN, "/admin/profile", "/admin")).toBe(true);

    expect(isPortalPathAllowed(DIETITIAN, "/admin/dashboard", "/admin")).toBe(false);
    expect(isPortalPathAllowed(DIETITIAN, "/admin/inventory", "/admin")).toBe(false);
    expect(isPortalPathAllowed(DIETITIAN, "/admin/subscriptions", "/admin")).toBe(false);
    expect(isPortalPathAllowed(DIETITIAN, "/admin/riders", "/admin")).toBe(false);
    expect(isPortalPathAllowed(DIETITIAN, "/admin/operations", "/admin")).toBe(false);
    expect(isPortalPathAllowed(DIETITIAN, "/admin/kitchen-shop", "/admin")).toBe(false);
    expect(isPortalPathAllowed(DIETITIAN, "/admin/franchises", "/admin")).toBe(false);
  });
});

describe("middleware wiring — franchise base", () => {
  it("lets the Franchise_Owner override reach every franchise route", () => {
    for (const route of FRANCHISE_ROUTES) {
      expect(isPortalPathAllowed(OWNER, route, "/franchise")).toBe(true);
    }
  });

  it("restricts a Franchise Dietitian to the three allow-listed routes", () => {
    const allowed = FRANCHISE_ROUTES.filter((route) =>
      isPortalPathAllowed(DIETITIAN, route, "/franchise"),
    );
    expect(allowed).toEqual([
      "/franchise/customers",
      "/franchise/customers/8f1b8a52-1d3a-4c0e-9f2a-6c0d1e2f3a4b",
      "/franchise/customers/8f1b8a52-1d3a-4c0e-9f2a-6c0d1e2f3a4b/report-card",
      "/franchise/profile",
      "/franchise/log-customer",
    ]);
  });

  it("keeps an inventory-only franchise user on the inventory route", () => {
    const config: AccessConfiguration = { level: "inventory", groups: {} };
    expect(isPortalPathAllowed(config, "/franchise/inventory", "/franchise")).toBe(true);
    expect(isPortalPathAllowed(config, "/franchise/dashboard", "/franchise")).toBe(false);
  });
});

describe("navbar trimming", () => {
  it("renders only reachable items for a Dietitian in both portals", () => {
    for (const href of DIETITIAN_NAV_HREFS) {
      expect(isPortalPathAllowed(DIETITIAN, `/admin${href}`, "/admin")).toBe(true);
      expect(isPortalPathAllowed(DIETITIAN, `/franchise${href}`, "/franchise")).toBe(
        true,
      );
    }
  });

  it("points the Dietitian brand link at a reachable landing route", () => {
    const home = landingRouteFor("dietitian");
    expect(home).toBe("/customers");
    expect(isPortalPathAllowed(DIETITIAN, `/admin${home}`, "/admin")).toBe(true);
    expect(isPortalPathAllowed(DIETITIAN, `/franchise${home}`, "/franchise")).toBe(true);
  });

  it("never redirects any level to a route that level cannot reach (no loop)", () => {
    for (const level of ADMIN_ACCESS_LEVELS as readonly AdminAccessLevel[]) {
      const config: AccessConfiguration = { level, groups: {} };
      const home = landingRouteFor(level);
      expect(isPortalPathAllowed(config, `/admin${home}`, "/admin")).toBe(true);
      expect(isPortalPathAllowed(config, `/franchise${home}`, "/franchise")).toBe(true);
    }
  });
});
