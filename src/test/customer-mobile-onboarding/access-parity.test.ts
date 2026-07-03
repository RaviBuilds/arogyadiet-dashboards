// Integration test — access parity for onboarded customers (customer-mobile-
// onboarding, Task 11.2).
//
// SCOPE: an admin-onboarded customer (onboarding_status IN_PROGRESS) must be
// granted the SAME customer-portal access as a legacy/completed customer
// (COMPLETED). The middleware customer-portal gate (Task 11.1) grants access
// only when the authenticated session is role CUSTOMER with exactly one
// Customer_Record in IN_PROGRESS or COMPLETED; both statuses are in the allowed
// set, so onboarded and legacy customers receive identical grants (Req 11.5).
// Non-customer roles and ambiguous multi-record sessions are denied.
//
// The external boundary (Supabase SSR client) is mocked: `createServerClient`
// returns a fake exposing only `auth.getUser` and the single `users` query the
// middleware runs. No real Supabase call is made.
//
// Validates: Requirements 11.5 (+ 12.1/12.2/12.4 parity boundary)

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ─── Mock the Supabase SSR client boundary ──────────────────────────────────
let fakeUser: { id: string } | null = null;
let fakeUserProfile: unknown = null;

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: fakeUser } })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({ data: fakeUserProfile })),
        })),
      })),
    })),
  })),
}));

import { middleware } from "@/middleware";

/** Build a customer-portal request for the given path. */
function customerRequest(path = "/dashboard"): NextRequest {
  return new NextRequest(`https://customer.arogyadiet.com${path}`, {
    headers: { host: "customer.arogyadiet.com" },
  });
}

/** A response is a denial when it redirects to the /unauthorized page. */
function isDeniedToUnauthorized(res: Response): boolean {
  const location = res.headers.get("location") ?? "";
  return location.includes("/unauthorized");
}

function customerProfile(statuses: (string | null)[], role = "CUSTOMER") {
  return {
    admin_access_level: null,
    admin_operations_access: null,
    roles: { code: role },
    customer_profiles: statuses.map((s) => ({ onboarding_status: s })),
  };
}

beforeEach(() => {
  fakeUser = { id: "auth-user-1" };
  fakeUserProfile = null;
});

describe("Customer-portal access parity (Req 11.5)", () => {
  it("grants an onboarded customer (IN_PROGRESS) access to the customer portal", async () => {
    fakeUserProfile = customerProfile(["IN_PROGRESS"]);

    const res = await middleware(customerRequest());

    expect(isDeniedToUnauthorized(res)).toBe(false);
    // Granted requests are rewritten into the /customer portal path.
    expect(res.headers.get("x-middleware-rewrite") ?? "").toContain("/customer");
  });

  it("grants a legacy/completed customer (COMPLETED) the identical access", async () => {
    fakeUserProfile = customerProfile(["COMPLETED"]);

    const res = await middleware(customerRequest());

    expect(isDeniedToUnauthorized(res)).toBe(false);
    expect(res.headers.get("x-middleware-rewrite") ?? "").toContain("/customer");
  });

  it("denies a non-customer role on the customer portal", async () => {
    fakeUserProfile = customerProfile(["COMPLETED"], "RIDER");

    const res = await middleware(customerRequest());

    expect(isDeniedToUnauthorized(res)).toBe(true);
  });

  it("denies an ambiguous session (more than one allowed Customer_Record)", async () => {
    fakeUserProfile = customerProfile(["IN_PROGRESS", "COMPLETED"]);

    const res = await middleware(customerRequest());

    expect(isDeniedToUnauthorized(res)).toBe(true);
  });
});
