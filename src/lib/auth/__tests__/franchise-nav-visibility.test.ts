// src/lib/auth/__tests__/franchise-nav-visibility.test.ts
//
// franchise-scoped-access Task 9.
//
// Before this, every Franchise_Portal nav item rendered for every non-Dietitian
// level, so a user granted only `customers` still saw six links that all bounced
// them straight back to their landing route.
//
// The property that matters is AGREEMENT: the nav must hide exactly the
// destinations the route gate would refuse. A drift in either direction is a bug
// — hiding a reachable page, or offering one that bounces. So rather than
// asserting a hand-written expected list, most of this file checks
// `isFranchiseNavItemVisible(href, config)` against
// `isPortalPathAllowed(config, "/franchise" + href, "/franchise")`, which is the
// real gate used by `middleware.ts` and `franchise/(main)/layout.tsx`.

import { describe, it, expect } from "vitest";

import { isFranchiseNavItemVisible } from "@/app/franchise/(main)/FranchiseNavbar";
import {
  isPortalPathAllowed,
  type AccessConfiguration,
  type OperationsAccess,
} from "@/lib/auth/adminAccessCore";

/** Every destination the franchise navbar can offer. */
const NAV_HREFS = [
  "/dashboard",
  "/customers",
  "/dietitian-activity",
  "/subscriptions",
  "/riders",
  "/operations",
  "/inventory",
  "/shop-products",
  "/profile",
] as const;

const ops = (groups: OperationsAccess): AccessConfiguration => ({
  level: "operations",
  groups,
});

const CONFIGS: ReadonlyArray<{ label: string; config: AccessConfiguration }> = [
  { label: "owner / full access", config: { level: "inventory_operations", groups: {} } },
  { label: "inventory only", config: { level: "inventory", groups: {} } },
  { label: "operations: customers manage", config: ops({ customers: "manage" }) },
  { label: "operations: customers view", config: ops({ customers: "view" }) },
  { label: "operations: riders only", config: ops({ riders: "manage" }) },
  { label: "operations: shop_products only", config: ops({ shop_products: "manage" }) },
  { label: "operations: operations only", config: ops({ operations: "view" }) },
  {
    label: "operations: several groups",
    config: ops({ customers: "manage", subscriptions: "view", riders: "manage" }),
  },
];

describe("isFranchiseNavItemVisible never offers a link the route gate refuses", () => {
  // The load-bearing invariant. Visible ⊆ Allowed: the nav may be STRICTER than
  // the route gate (a page can carry its own group guard — see
  // /dietitian-activity) but must never be more permissive, or it advertises a
  // destination that immediately bounces.
  for (const { label, config } of CONFIGS) {
    it(`visible items are a subset of allowed paths — ${label}`, () => {
      for (const href of NAV_HREFS) {
        const navVisible = isFranchiseNavItemVisible(href, config);
        const routeAllowed = isPortalPathAllowed(
          config,
          `/franchise${href}`,
          "/franchise",
        );
        if (navVisible) {
          expect(
            routeAllowed,
            `${href} is offered in the nav but the route gate refuses it`,
          ).toBe(true);
        }
      }
    });
  }

  it("is stricter only where a page carries its own guard", () => {
    // Today that is exactly one destination. If this list grows, the nav needs a
    // matching entry in NAV_ITEM_EXTRA_GROUP.
    const config = ops({ riders: "manage" });
    const stricterThanGate = NAV_HREFS.filter(
      (href) =>
        !isFranchiseNavItemVisible(href, config) &&
        isPortalPathAllowed(config, `/franchise${href}`, "/franchise"),
    );
    expect(stricterThanGate).toEqual(["/dietitian-activity"]);
  });
});

describe("isFranchiseNavItemVisible — specific expectations", () => {
  it("shows a customers-only user exactly their reachable destinations", () => {
    const config = ops({ customers: "view" });
    const visible = NAV_HREFS.filter((h) => isFranchiseNavItemVisible(h, config));

    // /dashboard is operations-area but group-neutral, so an operations-level
    // user reaches it; /profile is neutral for everyone.
    expect([...visible].sort()).toEqual(
      ["/customers", "/dashboard", "/dietitian-activity", "/profile"].sort(),
    );
  });

  it("hides subscriptions, riders, operations, shop-products and inventory from that user", () => {
    const config = ops({ customers: "view" });
    for (const href of [
      "/subscriptions",
      "/riders",
      "/operations",
      "/shop-products",
      "/inventory",
    ]) {
      expect(isFranchiseNavItemVisible(href, config)).toBe(false);
    }
  });

  it("shows everything to the Franchise_Owner", () => {
    const owner: AccessConfiguration = {
      level: "inventory_operations",
      groups: {},
    };
    for (const href of NAV_HREFS) {
      expect(isFranchiseNavItemVisible(href, owner)).toBe(true);
    }
  });

  it("treats /inventory as a capability area, not an Operations_Group", () => {
    // An operations-level user with every group still has no inventory area.
    const allGroups = ops({
      customers: "manage",
      subscriptions: "manage",
      riders: "manage",
      operations: "manage",
      shop_products: "manage",
    });
    expect(isFranchiseNavItemVisible("/inventory", allGroups)).toBe(false);

    // …while an inventory-only user has inventory but no operations groups.
    const inventoryOnly: AccessConfiguration = { level: "inventory", groups: {} };
    expect(isFranchiseNavItemVisible("/inventory", inventoryOnly)).toBe(true);
    expect(isFranchiseNavItemVisible("/customers", inventoryOnly)).toBe(false);
    // /admin/dashboard is classified as the OPERATIONS area, so an
    // inventory-only user is bounced from it — the nav must not offer it. An
    // earlier hand-rolled version of this helper got exactly this case wrong.
    expect(isFranchiseNavItemVisible("/dashboard", inventoryOnly)).toBe(false);
  });

  it("gates Dietitian Activity on the customers group", () => {
    expect(
      isFranchiseNavItemVisible("/dietitian-activity", ops({ customers: "view" })),
    ).toBe(true);
    expect(
      isFranchiseNavItemVisible("/dietitian-activity", ops({ riders: "manage" })),
    ).toBe(false);
  });

  it("keeps /profile reachable at every level", () => {
    for (const { config } of CONFIGS) {
      expect(isFranchiseNavItemVisible("/profile", config)).toBe(true);
    }
  });
});
