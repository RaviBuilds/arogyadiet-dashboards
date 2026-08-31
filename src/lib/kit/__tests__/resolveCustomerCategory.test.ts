// src/lib/kit/__tests__/resolveCustomerCategory.test.ts
//
// Pins the Primary_Category rule that decides which Customer_360 portal renders.
//
// THE BUG THIS FIXES: the franchise Customer_360 page passed no
// `customerCategory`, so `Customer360Dashboard` fell into its `else` branch and
// served a franchise KIT customer the MEAL tab set (Subscription + Coupons) while
// KIT, Shipping and KIT History never appeared at all.
//
// The rule is transcribed from `admin/(main)/customers/[id]/page.tsx`, which keeps
// its own inline copy so Core_Business behaviour is untouched. These tests are the
// statement of what the rule is meant to be for BOTH portals.

import { describe, it, expect } from "vitest";
import {
  resolveCustomerCategory,
  resolveCurrentSubscription,
} from "../resolveCustomerCategory";

describe("resolveCustomerCategory", () => {
  it("returns null for a customer with no subscriptions at all", () => {
    // A brand-new customer gets the MEAL portal by default.
    expect(resolveCustomerCategory([])).toBeNull();
  });

  it("returns the category of the ACTIVE subscription", () => {
    expect(
      resolveCustomerCategory([
        { status: "EXPIRED", customer_category: "MEAL", starts_on: "2026-01-01" },
        { status: "ACTIVE", customer_category: "MEAL", starts_on: "2026-06-01" },
      ]),
    ).toBe("MEAL");
  });

  it("treats an ACTIVE KIT subscription as KIT", () => {
    expect(
      resolveCustomerCategory([
        { status: "ACTIVE", customer_category: "KIT", starts_on: "2026-06-01" },
      ]),
    ).toBe("KIT");
  });

  describe("the KIT rule", () => {
    it("keeps KIT for a LAPSED kit with no replacement yet", () => {
      // The operator needs the KIT tabs precisely here — that is where the
      // replacement is sent from. Reading the category off "the newest row" would
      // still say KIT here, but the next two cases are why the rule is phrased
      // the way it is.
      expect(
        resolveCustomerCategory([
          { status: "EXPIRED", customer_category: "KIT", starts_on: "2026-01-01" },
        ]),
      ).toBe("KIT");
    });

    it("keeps KIT for a brand-new PENDING kit that has no starts_on yet", () => {
      // THE CASE "newest by start date" GETS WRONG. A just-dispatched kit has no
      // `starts_on`, so it sorts last; without the KIT rule this customer would
      // be shown MEAL tabs for a kit that was dispatched moments ago.
      expect(
        resolveCustomerCategory([
          { status: "EXPIRED", customer_category: "MEAL", starts_on: "2026-01-01" },
          { status: "PENDING", customer_category: "KIT", starts_on: null },
        ]),
      ).toBe("KIT");
    });

    it("does NOT force KIT when the customer has moved to an ACTIVE MEAL plan", () => {
      // An active non-KIT subscription vetoes the rule: this customer has moved
      // on and belongs in the MEAL portal even though they once held a kit.
      expect(
        resolveCustomerCategory([
          { status: "EXPIRED", customer_category: "KIT", starts_on: "2026-01-01" },
          { status: "ACTIVE", customer_category: "MEAL", starts_on: "2026-06-01" },
        ]),
      ).toBe("MEAL");
    });

    it("still returns KIT when a NON-active MEAL subscription coexists", () => {
      // Only an ACTIVE non-KIT subscription vetoes. A cancelled or expired MEAL
      // plan alongside a kit must not flip the customer out of the KIT portal.
      expect(
        resolveCustomerCategory([
          { status: "CANCELLED", customer_category: "MEAL", starts_on: "2026-05-01" },
          { status: "PENDING", customer_category: "KIT", starts_on: null },
        ]),
      ).toBe("KIT");
    });

    it("returns KIT when both an active KIT and an expired MEAL exist", () => {
      expect(
        resolveCustomerCategory([
          { status: "ACTIVE", customer_category: "KIT", starts_on: "2026-06-01" },
          { status: "EXPIRED", customer_category: "MEAL", starts_on: "2026-01-01" },
        ]),
      ).toBe("KIT");
    });
  });

  describe("no KIT involved", () => {
    it("falls back to the newest subscription by start date", () => {
      expect(
        resolveCustomerCategory([
          { status: "EXPIRED", customer_category: "MEAL", starts_on: "2026-01-01" },
          { status: "EXPIRED", customer_category: "ACCOMMODATION", starts_on: "2026-07-01" },
        ]),
      ).toBe("ACCOMMODATION");
    });

    it("returns null when the newest subscription carries no category", () => {
      expect(
        resolveCustomerCategory([
          { status: "EXPIRED", customer_category: null, starts_on: "2026-01-01" },
        ]),
      ).toBeNull();
    });

    it("does not throw on rows missing every optional field", () => {
      expect(resolveCustomerCategory([{}])).toBeNull();
    });
  });

  it("does not mutate the caller's array", () => {
    // The rule sorts internally; the page reuses the same array afterwards.
    const subscriptions = [
      { status: "EXPIRED", customer_category: "MEAL", starts_on: "2026-01-01" },
      { status: "EXPIRED", customer_category: "MEAL", starts_on: "2026-07-01" },
    ];
    const snapshot = [...subscriptions];
    resolveCustomerCategory(subscriptions);
    expect(subscriptions).toEqual(snapshot);
  });
});

describe("resolveCurrentSubscription", () => {
  it("prefers the ACTIVE subscription over a newer non-active one", () => {
    const active = {
      status: "ACTIVE",
      customer_category: "MEAL",
      starts_on: "2026-01-01",
    };
    const newer = {
      status: "PENDING",
      customer_category: "MEAL",
      starts_on: "2026-09-01",
    };
    expect(resolveCurrentSubscription([newer, active])).toBe(active);
  });

  it("falls back to the newest by start date when none is active", () => {
    const newest = {
      status: "EXPIRED",
      customer_category: "MEAL",
      starts_on: "2026-07-01",
    };
    expect(
      resolveCurrentSubscription([
        { status: "EXPIRED", customer_category: "MEAL", starts_on: "2026-01-01" },
        newest,
      ]),
    ).toBe(newest);
  });

  it("sorts rows without a start date last", () => {
    const dated = {
      status: "EXPIRED",
      customer_category: "MEAL",
      starts_on: "2026-01-01",
    };
    expect(
      resolveCurrentSubscription([
        { status: "PENDING", customer_category: "KIT", starts_on: null },
        dated,
      ]),
    ).toBe(dated);
  });

  it("returns null for an empty list", () => {
    expect(resolveCurrentSubscription([])).toBeNull();
  });
});

// ─── Equivalence with the admin page's inline rule ───────────────────────────
//
// This module carries the franchise copy of a rule the ADMIN Customer_360 page
// implements inline. The admin page is deliberately left untouched (Core_Business
// behaviour must not change as part of franchise work), which means there are two
// implementations that MUST agree — otherwise the same customer would be
// classified differently depending on which portal opened them.
//
// The comparison below is transcribed from `admin/(main)/customers/[id]/page.tsx`
// by hand, NOT imported, so it is an independent statement of the rule rather
// than a tautology. Same technique as
// `src/test/dietitian/scope-soundness.property.test.ts`, which transcribes the
// SQL predicate to pin the TypeScript one against it.

/** Hand-transcribed from the admin page. Do not refactor to share code. */
function adminInlineRule(
  subscriptions: readonly {
    status?: string | null;
    customer_category?: string | null;
    starts_on?: string | null;
  }[],
): string | null {
  const activeSubscription =
    subscriptions.find((s) => s.status === "ACTIVE") ?? null;

  const currentSubscription =
    activeSubscription ??
    subscriptions.slice().sort((a, b) => {
      const aTime = a.starts_on ? new Date(a.starts_on).getTime() : 0;
      const bTime = b.starts_on ? new Date(b.starts_on).getTime() : 0;
      return bTime - aTime;
    })[0] ??
    null;

  const hasKitSubscription = subscriptions.some(
    (s) => s.customer_category === "KIT",
  );
  const hasActiveNonKitSubscription = subscriptions.some(
    (s) => s.status === "ACTIVE" && s.customer_category !== "KIT",
  );

  return hasKitSubscription && !hasActiveNonKitSubscription
    ? "KIT"
    : (currentSubscription?.customer_category ?? null);
}

describe("Equivalence: the franchise helper agrees with the admin inline rule", () => {
  const STATUSES = ["ACTIVE", "PENDING", "EXPIRED", "CANCELLED", "STOPPED"];
  const CATEGORIES = ["MEAL", "KIT", "ACCOMMODATION", null];
  const STARTS = ["2026-01-01", "2026-07-01", null];

  it("agrees for every single-subscription shape", () => {
    for (const status of STATUSES) {
      for (const customer_category of CATEGORIES) {
        for (const starts_on of STARTS) {
          const rows = [{ status, customer_category, starts_on }];
          expect(
            resolveCustomerCategory(rows),
            `single row ${status}/${customer_category}/${starts_on}`,
          ).toBe(adminInlineRule(rows));
        }
      }
    }
  });

  it("agrees for every two-subscription pairing", () => {
    // The interesting cases all involve two rows: an active plan vetoing a kit, a
    // PENDING kit with no start date alongside a dated row, and so on.
    const singles = STATUSES.flatMap((status) =>
      CATEGORIES.flatMap((customer_category) =>
        STARTS.map((starts_on) => ({ status, customer_category, starts_on })),
      ),
    );

    let compared = 0;
    for (const first of singles) {
      for (const second of singles) {
        const rows = [first, second];
        expect(resolveCustomerCategory(rows)).toBe(adminInlineRule(rows));
        compared += 1;
      }
    }

    // Guards the guard: if the enumeration above ever collapsed to nothing, this
    // test would pass while comparing zero cases.
    expect(compared).toBe(singles.length * singles.length);
    expect(compared).toBeGreaterThan(1000);
  });
});
