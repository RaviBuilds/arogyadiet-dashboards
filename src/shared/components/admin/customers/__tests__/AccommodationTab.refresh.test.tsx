// @vitest-environment jsdom

// src/shared/components/admin/customers/__tests__/AccommodationTab.refresh.test.tsx
//
// Example-based refresh-wiring tests for `AccommodationTab` (Task 11.8,
// accommodation-payment-lifecycle spec).
//
//   Req 5.9  — the ledger is refetched after a SUCCESSFUL *and* a FAILED
//              Record Payment submission (RecordStayPaymentForm's `finally`
//              block always calls `onSettled`, which bumps `refreshToken`).
//   Req 6.6  — totals refresh after any mutation, without a page reload.
//   Req 11.4 — the ledger is refetched after a Stay_Extension is applied.
//
// All three flows are also checked against `next/navigation`'s mocked
// `push`/`refresh` to confirm these are in-place refreshes, not page
// navigations.
//
// This file is deliberately example-based (not property-based) per the
// task's Notes section.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const getAllStaysAction = vi.fn();
const extendStayAction = vi.fn();
const markStayCheckedOutAction = vi.fn();
const earlyCheckoutStayAction = vi.fn();
const createNewStayAction = vi.fn();

vi.mock("@/actions/stayActions", () => ({
  getAllStaysAction: (...a: unknown[]) => getAllStaysAction(...a),
  extendStayAction: (...a: unknown[]) => extendStayAction(...a),
  markStayCheckedOutAction: (...a: unknown[]) => markStayCheckedOutAction(...a),
  earlyCheckoutStayAction: (...a: unknown[]) => earlyCheckoutStayAction(...a),
  createNewStayAction: (...a: unknown[]) => createNewStayAction(...a),
}));

const getStayPaymentLedgerAction = vi.fn();
const recordStayPaymentAction = vi.fn();
const recordStayRefundAction = vi.fn();

vi.mock("@/actions/stayPaymentActions", () => ({
  getStayPaymentLedgerAction: (...a: unknown[]) => getStayPaymentLedgerAction(...a),
  recordStayPaymentAction: (...a: unknown[]) => recordStayPaymentAction(...a),
  recordStayRefundAction: (...a: unknown[]) => recordStayRefundAction(...a),
}));

const generateFinalStayInvoiceAction = vi.fn();

vi.mock("@/actions/stayInvoiceActions", () => ({
  generateFinalStayInvoiceAction: (...a: unknown[]) =>
    generateFinalStayInvoiceAction(...a),
}));

vi.mock("@/actions/healthLogActions", () => ({
  submitAdminHealthLogAction: vi.fn(),
  getCustomerHealthLogsAction: vi
    .fn()
    .mockResolvedValue({ success: true, data: [] }),
  getAdminHealthLogsAction: vi
    .fn()
    .mockResolvedValue({ success: true, data: [] }),
}));

const routerPush = vi.fn();
const routerRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: routerRefresh }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// next/link renders a plain anchor so the receipt link is inspectable.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

import { AccommodationTab } from "@/shared/components/admin/customers/AccommodationTab";
import type { StayEntry, StayLedgerView } from "@/types/accommodation";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STAY_ID = "stay-1";
const CUSTOMER_ID = "cust-1";

function makeActiveStay(overrides: Partial<StayEntry> = {}): StayEntry {
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
    checkedOutAt: null,
    finalInvoicePaymentId: null,
    finalInvoiceGeneratedAt: null,
    finalInvoiceError: null,
    ...overrides,
  };
}

function makeLedger(stay: StayEntry): StayLedgerView {
  return {
    stay,
    transactions: [
      {
        id: "tx-1",
        stayEntryId: stay.id,
        customerProfileId: stay.customerProfileId,
        transactionType: "ADVANCE",
        amount: 6000,
        transactionDate: "2025-06-01",
        comment: "Advance at onboarding",
        remark: null,
        createdBy: null,
        createdAt: "2025-06-01T09:00:00.000Z",
      },
    ],
    balance: {
      totalStayAmount: 10000,
      totalPaid: 6000,
      remainingBalance: 4000,
      isFullyPaid: false,
      refundDue: 0,
    },
    hasFinalInvoice: false,
    visibility: {
      showRecordPayment: true,
      showFullyPaidMessage: false,
      showMarkCheckedOut: true,
      markCheckedOutEnabled: false,
      showGenerateFinalInvoice: false,
      showEarlyCheckout: true,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const stay = makeActiveStay();
  getAllStaysAction.mockResolvedValue({ success: true, data: [stay] });
  getStayPaymentLedgerAction.mockResolvedValue({
    success: true,
    data: makeLedger(stay),
  });
});

async function renderTabAndWaitForLoad() {
  render(<AccommodationTab customerProfileId={CUSTOMER_ID} />);

  await waitFor(() =>
    expect(getAllStaysAction).toHaveBeenCalledTimes(1)
  );
  await waitFor(() =>
    expect(getStayPaymentLedgerAction).toHaveBeenCalledTimes(1)
  );
  // The Record Payment form only renders once the ledger has loaded.
  await screen.findByRole("button", { name: /^record payment$/i });
}

describe("AccommodationTab — ledger refetch after Record Payment (Req 5.9, 6.6)", () => {
  it("refetches the ledger after a SUCCESSFUL payment, with no navigation", async () => {
    const user = userEvent.setup();
    recordStayPaymentAction.mockResolvedValue({
      success: true,
      data: {
        totalStayAmount: 10000,
        totalPaid: 7000,
        remainingBalance: 3000,
        isFullyPaid: false,
        refundDue: 0,
      },
    });

    await renderTabAndWaitForLoad();

    await user.type(screen.getByLabelText(/amount/i), "1000");
    await user.type(screen.getByLabelText(/comment/i), "Cash received");
    await user.click(screen.getByRole("button", { name: /^record payment$/i }));

    await waitFor(() => expect(recordStayPaymentAction).toHaveBeenCalledTimes(1));

    // Ledger refetched a second time (finally-block bump) after success.
    await waitFor(() =>
      expect(getStayPaymentLedgerAction).toHaveBeenCalledTimes(2)
    );

    expect(routerPush).not.toHaveBeenCalled();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("refetches the ledger after a FAILED payment, with no navigation", async () => {
    const user = userEvent.setup();
    recordStayPaymentAction.mockResolvedValue({
      error: "Amount exceeds the remaining balance.",
      fieldErrors: { amount: "Amount exceeds the remaining balance of ₹4000." },
    });

    await renderTabAndWaitForLoad();

    await user.type(screen.getByLabelText(/amount/i), "500");
    await user.type(screen.getByLabelText(/comment/i), "Cash received");
    await user.click(screen.getByRole("button", { name: /^record payment$/i }));

    await waitFor(() => expect(recordStayPaymentAction).toHaveBeenCalledTimes(1));

    // Ledger is STILL refetched even though the write failed (Req 5.9).
    await waitFor(() =>
      expect(getStayPaymentLedgerAction).toHaveBeenCalledTimes(2)
    );

    expect(routerPush).not.toHaveBeenCalled();
    expect(routerRefresh).not.toHaveBeenCalled();
  });
});

describe("AccommodationTab — ledger refetch after a Stay_Extension (Req 11.4)", () => {
  it("refetches the ledger and the stay list after a successful extension, with no navigation", async () => {
    const user = userEvent.setup();
    extendStayAction.mockResolvedValue({
      success: true,
      data: {
        newEndDate: "2025-06-15",
        balance: {
          totalStayAmount: 12000,
          totalPaid: 6000,
          remainingBalance: 6000,
          isFullyPaid: false,
          refundDue: 0,
        },
      },
    });

    await renderTabAndWaitForLoad();

    await user.click(screen.getByRole("button", { name: /extend stay/i }));

    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText(/additional nights/i),
      "5"
    );
    await user.type(
      within(dialog).getByLabelText(/payment amount/i),
      "2000"
    );
    await user.click(
      within(dialog).getByRole("button", { name: /extend stay/i })
    );

    await waitFor(() => expect(extendStayAction).toHaveBeenCalledTimes(1));

    // Extension bumps refreshToken (ledger refetch) AND re-fetches all stays.
    await waitFor(() =>
      expect(getStayPaymentLedgerAction).toHaveBeenCalledTimes(2)
    );
    await waitFor(() => expect(getAllStaysAction).toHaveBeenCalledTimes(2));

    expect(routerPush).not.toHaveBeenCalled();
    expect(routerRefresh).not.toHaveBeenCalled();
  });
});

describe("AccommodationTab — receipt link present per payment history row (Req 10.3)", () => {
  it("renders a receipt link for the ledger's transaction", async () => {
    await renderTabAndWaitForLoad();

    const receiptLink = await screen.findByRole("link", { name: /receipt/i });
    expect(receiptLink).toHaveAttribute(
      "href",
      `/admin/customers/${CUSTOMER_ID}/billing/stay-receipt/tx-1`
    );
  });
});
