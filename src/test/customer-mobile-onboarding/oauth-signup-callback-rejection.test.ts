// Integration test — OAuth/signup callback rejection + customer signup route
// redirect (customer-mobile-onboarding, Task 11.2).
//
// SCOPE: self-service account creation is disabled in the mobile-first,
// admin-initiated model. This verifies the two neutralized entry points:
//   - GET /api/auth/callback (the former Google OAuth/signup callback) rejects
//     the request WITHOUT exchanging a code or establishing a session, and
//     redirects to the mobile login screen (Req 1.5).
//   - The customer signup route redirects to /login without creating an account
//     (Req 1.4 — included as the paired self-service-removal example).
//
// The external boundary (Supabase) is intentionally NOT wired: the callback
// route no longer imports or calls Supabase at all — asserting the response is a
// bare redirect proves no session is created. No real Supabase/Google call is
// made.
//
// Validates: Requirements 1.5, 1.4

import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The signup page calls redirect() from next/navigation, which in a real
// request throws a control-flow signal. Capture the target instead.
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

import { GET as authCallbackGET } from "@/app/api/auth/callback/route";
import SignupPage from "@/app/customer/(auth)/signup/page";

describe("Customer OAuth/signup callback rejection (Req 1.5)", () => {
  it("redirects a direct GET /api/auth/callback (with an OAuth code) to /login without a session", async () => {
    // Simulate a direct hit that bypasses the UI, carrying an OAuth `code`.
    const request = new NextRequest(
      "https://customer.arogyadiet.com/api/auth/callback?code=fake-oauth-code",
      { headers: { host: "customer.arogyadiet.com" } },
    );

    const response = await authCallbackGET(request);

    // A redirect (3xx) to the mobile login screen on the same host.
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    const location = response.headers.get("location") ?? "";
    expect(location).toBe("https://customer.arogyadiet.com/login");

    // No session/auth cookies were set — the endpoint never authenticated.
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("preserves localhost scheme when redirecting (no accidental https upgrade)", async () => {
    const request = new NextRequest(
      "http://customer.localhost:3000/api/auth/callback?code=abc",
      { headers: { host: "customer.localhost:3000" } },
    );

    const response = await authCallbackGET(request);

    expect(response.headers.get("location")).toBe(
      "http://customer.localhost:3000/login",
    );
  });
});

describe("Customer self-service signup route redirect (Req 1.4)", () => {
  it("redirects the customer signup route to /login without creating an account", () => {
    expect(() => SignupPage()).toThrow("NEXT_REDIRECT:/login");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });
});
