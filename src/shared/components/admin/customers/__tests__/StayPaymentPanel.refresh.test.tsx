// @vitest-environment jsdom

// src/shared/components/admin/customers/__tests__/StayPaymentPanel.refresh.test.tsx
//
// Example-based refresh-wiring tests for `StayPaymentPanel` (Task 11.8,
// accommodation-payment-lifecycle spec).
//
//   Req 6.6  — the panel refetches `getStayPaymentLedgerAction` whenever the
//              parent bumps `refreshToken` (the channel every mutation uses
//              in its `finally` block, success or failure).
//   Req 10.3 — every payment history row exposes a receipt link pointing at
//              `row.receiptLinkTarget`.
//
// This file is deliberately example-based (not property-based) per the
// task's Notes section.

import { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getStayPaymentLedgerAction = vi.fn();

vi.mock("@/actions/stayPaymentActions", () => ({
  getStayPaymentLedgerAction: (...args: unknown[]) =>
    getStayPaymentLedgerAction(...args),
}));

// next/link renders a plain anchor in tests (mirrors the sibling
// OnboardingCustomersSection.test.tsx convention), but this one forwards
// `href` since the receipt-link assertion depends on it.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

import { StayPaymentPanel } from "@/shared/components/admin/customers/StayPaymentPanel";
import type { StayEntry, StayLedgerView } from "@/types/accommodation";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STAY_ID = "stay-1";
const CUSTOMER_ID = "cust-1";

function makeStay(overrides: Partial<StayEntry> = {}): StayEntry {
  return {
    id: STAY_ID,
    customerProfileId: CUSTOMER_ID,
    startDate: "2025-06-01",
    totalNights: 10,
    stayType: "AC Villa",
    occupancyType: "Single",
    status: "ACTIVE",
    paymentAmount: 10000,
    baseAmount: 8474.58,
    taxAmount: 1525.42,
    taxPercentage: 18,
    paymentHostProfileId: null,
    mealPreference: "VEG",
    endDate: "2025-06-10",
    createdAt: "2025-06-01T00:00:00.000Z",
    updatedAt: "2025-06-01T00:00:00.000Z",
    isBackdated: false,
    earlyCheckoutApplied: false,
    actualNightsStayed: null,
    originalTotalNights: null,
    originalTotalAmount: null,
    recalculationApplied: false,
    checkedOutAt: null,
    finalInvoicePaymentId: null,
    finalInvoiceGeneratedAt: null,
    finalInvoiceError: null,
    ...overrides,
  };
}

function makeLedger(overrides: Partial<StayLedgerView> = {}): StayLedgerView {
  return {
    stay: makeStay(),
    transactions: [
      {
        id: "tx-1",
        stayEntryId: STAY_ID,
        customerProfileId: CUSTOMER_ID,
        transactionType: "ADVANCE",
        amount: 4000,
        transactionDate: "2025-06-01",
        comment: "Advance at onboarding",
        remark: null,
        createdBy: null,
        createdAt: "2025-06-01T09:00:00.000Z",
      },
      {
        id: "tx-2",
        stayEntryId: STAY_ID,
        customerProfileId: CUSTOMER_ID,
        transactionType: "PARTIAL_BALANCE_PAYMENT",
        amount: 1000,
        transactionDate: "2025-06-05",
        comment: "Cash at front desk",
        remark: "Collected by front desk",
        createdBy: null,
        createdAt: "2025-06-05T09:00:00.000Z",
      },
    ],
    extensions: [],
    recalculations: [],
    balance: {
      totalStayAmount: 10000,
      totalPaid: 5000,
      remainingBalance: 5000,
      isFullyPaid: false,
      refundDue: 0,
    },
    hasFinalInvoice: false,
    visibility: {
      showRecordPayment: true,
      showFullyPaidMessage: false,
      showMarkCheckedOut: true,
      markCheckedOutEnabled: false,
      markCheckedOutBlockedReason: "BALANCE_OUTSTANDING",
      showGenerateFinalInvoice: false,
      showRecalculateStay: true,
      showMarkAsRefunded: false,
    },
    ...overrides,
  };
}

/** Lets the test bump `refreshToken` the same way AccommodationTab does. */
function RefreshTokenHarness({ initialToken = 0 }: { initialToken?: number }) {
  const [token, setToken] = useState(initialToken);
  return (
    <div>
      <button onClick={() => setToken((t) => t + 1)}>Bump refresh token</button>
      <StayPaymentPanel stayId={STAY_ID} refreshToken={token} />
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getStayPaymentLedgerAction.mockResolvedValue({
    success: true,
    data: makeLedger(),
  });
});

describe("StayPaymentPanel — ledger refetch on refreshToken bump (Req 6.6)", () => {
  it("fetches the ledger on mount and refetches when refreshToken changes", async () => {
    const user = userEvent.setup();
    render(<RefreshTokenHarness />);

    await waitFor(() =>
      expect(getStayPaymentLedgerAction).toHaveBeenCalledTimes(1)
    );
    expect(getStayPaymentLedgerAction).toHaveBeenCalledWith(STAY_ID);

    await user.click(screen.getByRole("button", { name: /bump refresh token/i }));

    await waitFor(() =>
      expect(getStayPaymentLedgerAction).toHaveBeenCalledTimes(2)
    );
  });

  it("refetches again on a second refreshToken bump, independent of the balanceOverride path", async () => {
    const user = userEvent.setup();
    render(<RefreshTokenHarness />);

    await waitFor(() =>
      expect(getStayPaymentLedgerAction).toHaveBeenCalledTimes(1)
    );

    const bumpButton = screen.getByRole("button", { name: /bump refresh token/i });
    await user.click(bumpButton);
    await waitFor(() =>
      expect(getStayPaymentLedgerAction).toHaveBeenCalledTimes(2)
    );

    await user.click(bumpButton);
    await waitFor(() =>
      expect(getStayPaymentLedgerAction).toHaveBeenCalledTimes(3)
    );
  });
});

describe("StayPaymentPanel — receipt link per history row (Req 10.3)", () => {
  it("renders a receipt link for every payment history row, pointing at the row's receiptLinkTarget", async () => {
    render(<StayPaymentPanel stayId={STAY_ID} />);

    // Two transactions in the fixture ledger → two receipt links.
    const receiptLinks = await screen.findAllByRole("link", { name: /receipt/i });
    expect(receiptLinks).toHaveLength(2);

    const hrefs = receiptLinks.map((link) => link.getAttribute("href"));
    expect(hrefs).toContain(
      `/admin/customers/${CUSTOMER_ID}/billing/stay-receipt/tx-1`
    );
    expect(hrefs).toContain(
      `/admin/customers/${CUSTOMER_ID}/billing/stay-receipt/tx-2`
    );
  });

  it("renders no history rows or receipt links when the ledger is empty", async () => {
    getStayPaymentLedgerAction.mockResolvedValue({
      success: true,
      data: makeLedger({ transactions: [] }),
    });

    render(<StayPaymentPanel stayId={STAY_ID} />);

    expect(
      await screen.findByText(/no payment transactions recorded yet/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /receipt/i })).not.toBeInTheDocument();
  });
});
