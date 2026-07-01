// @vitest-environment jsdom

// src/shared/components/customer/subscription/manage/__tests__/billing-client.test.tsx
//
// Light display tests for the customer Billing view (Task 11.3).
//
//   Req 11.3 — the onboarding invoice is displayed with its amount, issue date
//              and payment status.
//   Req 11.4 — WHEN no invoice exists, an empty state is shown instead of a
//              billing table.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { BillingClient } from "@/shared/components/customer/subscription/manage/billing-client";

describe("BillingClient — invoice display (Req 11.3)", () => {
  it("shows the onboarding invoice amount, date and PAID status", () => {
    render(
      <BillingClient
        activeSub={null}
        payments={[
          {
            id: "pay-1",
            amount: 2499,
            payment_method: "MANUAL",
            status: "PAID",
            created_at: "2024-03-01T10:00:00.000Z",
            paid_at: "2024-03-01T10:00:00.000Z",
            invoice_type: "SUBSCRIPTION",
          },
        ]}
      />,
    );

    // Amount (Req 11.3).
    expect(screen.getByText("₹2499.00")).toBeInTheDocument();
    // Issue date (Req 11.3).
    expect(screen.getByText(/01 Mar 2024/i)).toBeInTheDocument();
    // Payment status (Req 11.3).
    expect(screen.getByText(/^Paid$/i)).toBeInTheDocument();
  });
});

describe("BillingClient — empty state (Req 11.4)", () => {
  it("shows the no-invoice empty state when there are no payments", () => {
    render(<BillingClient activeSub={null} payments={[]} />);

    expect(screen.getByText(/no payment history found/i)).toBeInTheDocument();
    // No billing table is rendered in the empty state.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
