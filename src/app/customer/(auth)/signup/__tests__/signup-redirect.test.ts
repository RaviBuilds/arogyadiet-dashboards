// src/app/customer/(auth)/signup/__tests__/signup-redirect.test.ts
//
// Verifies the customer self-service signup route is neutralized (Task 11.3).
//
//   Req 1.4 — an HTTP request to any customer signup route redirects to the
//             mobile login screen WITHOUT creating any account record.
//
// The page is a Server Component whose entire body is `redirect("/login")`, so
// this is a plain node test: we mock next/navigation `redirect` and assert the
// page invokes it with "/login" and does nothing else (no account creation).

import { describe, expect, it, vi, beforeEach } from "vitest";

const redirect = vi.fn((path: string) => {
  // Real next/navigation redirect throws to halt rendering; emulate that so we
  // also prove the page performs no work after redirecting.
  throw new Error(`NEXT_REDIRECT:${path}`);
});

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirect(path),
}));

import SignupPage from "@/app/customer/(auth)/signup/page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Customer signup route (Req 1.4)", () => {
  it("redirects to the mobile login screen and creates nothing", () => {
    expect(() => SignupPage()).toThrow("NEXT_REDIRECT:/login");
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
