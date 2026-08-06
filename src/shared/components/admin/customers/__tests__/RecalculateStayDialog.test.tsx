// @vitest-environment jsdom

// src/shared/components/admin/customers/__tests__/RecalculateStayDialog.test.tsx
//
// Example-based unit tests for the RecalculateStayDialog component (Task 23.6,
// accommodation-payment-lifecycle spec).
//
//   Req 12.2 — Picker and amount are prefilled with the stay's current
//              Computed_End_Date and Total_Stay_Amount.
//   Req 12.3 — The derived "Total nights" line updates as the date changes;
//              no night-count input present; start date is selectable (1 night);
//              a 1-night stay still renders an enabled picker.
//   Req 12.7 — The primary button reads "Save Stay Details" and no checkout
//              affordance renders.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const saveStayDetailsAction = vi.fn();

vi.mock("@/actions/stayActions", () => ({
  saveStayDetailsAction: (...a: unknown[]) => saveStayDetailsAction(...a),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { RecalculateStayDialog } from "@/shared/components/admin/customers/RecalculateStayDialog";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const STAY_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const START_DATE = "2025-06-01";
const BOOKED_END_DATE = "2025-06-10"; // 10 nights (June 1–10 inclusive)
const TOTAL_STAY_AMOUNT = 50000;

const defaultProps = {
  stayId: STAY_ID,
  startDate: START_DATE,
  bookedEndDate: BOOKED_END_DATE,
  currentTotalStayAmount: TOTAL_STAY_AMOUNT,
  open: true,
  onOpenChange: vi.fn(),
  onSaved: vi.fn(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RecalculateStayDialog — Prefill (Req 12.2)", () => {
  it("prefills the amount input with currentTotalStayAmount", () => {
    render(<RecalculateStayDialog {...defaultProps} />);

    const amountInput = screen.getByRole("spinbutton");
    expect(amountInput).toHaveValue(TOTAL_STAY_AMOUNT);
  });

  it("prefills the picker with bookedEndDate selected (shows correct initial nights)", () => {
    render(<RecalculateStayDialog {...defaultProps} />);

    // The "Total nights" line derives from startDate→bookedEndDate:
    // June 1–10 inclusive = 10 nights
    expect(screen.getByText(/Total nights:/)).toHaveTextContent(
      "Total nights: 10"
    );
  });
});

describe("RecalculateStayDialog — Button text and no checkout affordance (Req 12.7)", () => {
  it("primary button reads 'Save Stay Details'", () => {
    render(<RecalculateStayDialog {...defaultProps} />);

    const saveButton = screen.getByRole("button", { name: /Save Stay Details/i });
    expect(saveButton).toBeInTheDocument();
  });

  it("does not render any text matching 'Confirm Early Checkout' or 'Check Out'", () => {
    render(<RecalculateStayDialog {...defaultProps} />);

    expect(screen.queryByText(/Confirm Early Checkout/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Check Out/i)).not.toBeInTheDocument();
  });

  it("does not render any checkout affordance text (checkout, checked out, FINISHED, invoice)", () => {
    render(<RecalculateStayDialog {...defaultProps} />);

    expect(screen.queryByText(/checkout/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/checked out/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/FINISHED/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/invoice/i)).not.toBeInTheDocument();
  });
});

describe("RecalculateStayDialog — Derived Total nights (Req 12.3)", () => {
  it("shows the correct initial 'Total nights: N' text", () => {
    render(<RecalculateStayDialog {...defaultProps} />);

    expect(screen.getByText(/Total nights:/)).toHaveTextContent(
      "Total nights: 10"
    );
  });

  it("updates the 'Total nights' text when a different date is selected", async () => {
    const user = userEvent.setup();
    render(<RecalculateStayDialog {...defaultProps} />);

    // The calendar shows June 2025. Click June 5 to change the end date.
    // June 1 to June 5 inclusive = 5 nights.
    // react-day-picker renders day buttons inside gridcells. The button text
    // is the day number. Find buttons that are not disabled and pick day 5.
    const allButtons = screen.getAllByRole("button");
    const day5Button = allButtons.find(
      (btn) => btn.textContent?.trim() === "5" && !btn.hasAttribute("disabled")
    );
    expect(day5Button).toBeDefined();
    await user.click(day5Button!);

    expect(screen.getByText(/Total nights:/)).toHaveTextContent(
      "Total nights: 5"
    );
  });

  it("does not render a night-count input (no 'Actual nights' or 'nights stayed' input)", () => {
    render(<RecalculateStayDialog {...defaultProps} />);

    expect(screen.queryByLabelText(/actual nights/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/nights stayed/i)).not.toBeInTheDocument();
  });
});

describe("RecalculateStayDialog — Start date is selectable (Req 12.3)", () => {
  it("clicking the start date yields 'Total nights: 1'", async () => {
    const user = userEvent.setup();
    render(<RecalculateStayDialog {...defaultProps} />);

    // Click June 1 (the start date) in the calendar.
    // react-day-picker renders day buttons with the day number as text.
    const allButtons = screen.getAllByRole("button");
    const day1Button = allButtons.find(
      (btn) => btn.textContent?.trim() === "1" && !btn.hasAttribute("disabled")
    );
    expect(day1Button).toBeDefined();
    await user.click(day1Button!);

    expect(screen.getByText(/Total nights:/)).toHaveTextContent(
      "Total nights: 1"
    );
  });
});

describe("RecalculateStayDialog — 1-night stay still renders an enabled picker (Req 12.3)", () => {
  it("renders an enabled calendar picker for a 1-night stay (startDate === bookedEndDate)", () => {
    const oneNightProps = {
      ...defaultProps,
      bookedEndDate: START_DATE, // same as startDate → 1-night stay
    };
    render(<RecalculateStayDialog {...oneNightProps} />);

    // The calendar should be present and visible
    const calendar = screen.getByRole("grid");
    expect(calendar).toBeInTheDocument();

    // Total nights shows 1
    expect(screen.getByText(/Total nights:/)).toHaveTextContent(
      "Total nights: 1"
    );

    // The date picker button for the single selectable day (June 1) should
    // not be disabled. Find the button with text "1" that is not disabled.
    const allButtons = screen.getAllByRole("button");
    const startDayButton = allButtons.find(
      (btn) => btn.textContent?.trim() === "1" && !btn.hasAttribute("disabled")
    );
    expect(startDayButton).toBeDefined();
  });
});
