// @vitest-environment jsdom

// src/app/customer/(main)/subscription/__tests__/subscription-page.test.tsx
//
// Light display tests for the customer account (subscription) view (Task 11.3).
//
//   Req 11.1 — an onboarded customer sees the subscription attached during
//              onboarding (plan name, start date, status).
//   Req 11.2 — WHEN no subscription is attached, a no-subscription empty state
//              is shown and the customer stays on the account view.
//
// The page is an async Server Component that reads from Supabase; we mock the
// server client with a minimal chainable query builder keyed by table name.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

type TableData = Record<string, unknown>;

let tableData: Record<string, TableData | TableData[] | null> = {};
let authUser: { id: string } | null = { id: "auth-1" };

/** A tiny chainable query builder: select/eq return `this`; maybeSingle/order
 *  resolve to the data registered for the table. */
function makeBuilder(table: string) {
  const result = { data: tableData[table] ?? null, error: null };
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: authUser } }) },
    from: (table: string) => makeBuilder(table),
  }),
}));

const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (p: string) => redirect(p) }));

import StorefrontPage from "@/app/customer/(main)/subscription/page";

beforeEach(() => {
  vi.clearAllMocks();
  authUser = { id: "auth-1" };
  tableData = {
    users: { id: "user-1" },
    customer_profiles: { id: "profile-1", dietary_preference: "Veg" },
    subscription_plans: [],
  };
});

describe("Account view — subscription display (Req 11.1)", () => {
  it("shows the onboarding subscription plan name, start date and status", async () => {
    tableData.subscriptions = [
      {
        id: "sub-1",
        status: "ACTIVE",
        starts_on: "2024-03-05",
        effective_end_on: "2024-04-04",
        subscription_code: "SUB-001",
        subscription_plans: { name: "Monthly Meal Plan", duration_days: 30 },
      },
    ];

    render(await StorefrontPage());

    expect(screen.getByText("Your Subscription")).toBeInTheDocument();
    expect(screen.getByText("Monthly Meal Plan")).toBeInTheDocument();
    // Status badge (Req 11.1).
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    // Start date, formatted by the page (Req 11.1).
    expect(screen.getByText(/Mar 5th, 2024/i)).toBeInTheDocument();
  });
});

describe("Account view — no-subscription empty state (Req 11.2)", () => {
  it("shows the no-subscription message when none is attached", async () => {
    tableData.subscriptions = [];

    render(await StorefrontPage());

    expect(screen.getByText(/no subscription found/i)).toBeInTheDocument();
    expect(screen.queryByText("Your Subscription")).not.toBeInTheDocument();
  });
});
