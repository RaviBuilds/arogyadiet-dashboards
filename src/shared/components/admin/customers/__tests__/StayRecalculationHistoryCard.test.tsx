// @vitest-environment jsdom

// src/shared/components/admin/customers/__tests__/StayRecalculationHistoryCard.test.tsx
//
// Example-based unit tests for `StayRecalculationHistoryCard` (Task 23.7,
// accommodation-payment-lifecycle spec).
//
//   Req 13.3 — dedicated history list, distinct from Extension History
//   Req 13.4 — empty state when no recalculations recorded
//   Req 13.6 — extensions never appear in recalculation history
//   Req 13.7 — recalculations never appear in extension history
//
// The card is a pure presentational component: it receives a
// `recalculations: StayRecalculation[]` prop, calls
// `buildRecalculationHistoryRows` internally, and renders the result.
// These tests confirm rendering, ordering, and prop isolation.

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { StayRecalculationHistoryCard } from "@/shared/components/admin/customers/StayRecalculationHistoryCard";
import type { StayRecalculation } from "@/types/accommodation";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRecalculation(
  overrides: Partial<StayRecalculation> = {}
): StayRecalculation {
  return {
    id: "recalc-1",
    stayEntryId: "stay-1",
    customerProfileId: "cust-1",
    nightsBefore: 10,
    nightsAfter: 7,
    totalAmountBefore: 50000,
    totalAmountAfter: 35000,
    endDateBefore: "2025-06-10",
    endDateAfter: "2025-06-07",
    recalculatedOn: "2025-06-05",
    createdAt: "2025-06-05T10:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StayRecalculationHistoryCard — empty state (Req 13.4)", () => {
  it('renders "No recalculations recorded for this stay." when recalculations is empty', () => {
    render(<StayRecalculationHistoryCard recalculations={[]} />);

    expect(
      screen.getByText("No recalculations recorded for this stay.")
    ).toBeInTheDocument();
  });

  it("does not render any row elements when recalculations is empty", () => {
    const { container } = render(
      <StayRecalculationHistoryCard recalculations={[]} />
    );

    // Row elements use border class — none should exist
    const rows = container.querySelectorAll(".rounded-lg.border");
    expect(rows).toHaveLength(0);
  });
});

describe("StayRecalculationHistoryCard — renders entries (Req 13.3, 13.5)", () => {
  it("renders the correct date, nights before→after, and amounts for a single entry", () => {
    const recalc = makeRecalculation({
      id: "recalc-single",
      nightsBefore: 14,
      nightsAfter: 10,
      totalAmountBefore: 70000,
      totalAmountAfter: 50000,
      recalculatedOn: "2025-07-10",
    });

    render(<StayRecalculationHistoryCard recalculations={[recalc]} />);

    // Date should be visible
    expect(screen.getByText("2025-07-10")).toBeInTheDocument();

    // Nights change: "14 → 10 nights"
    expect(screen.getByText("14 → 10 nights")).toBeInTheDocument();

    // Amount: ₹70,000 → ₹50,000 (en-IN locale formatting)
    expect(screen.getByText(/₹70,000/)).toBeInTheDocument();
    expect(screen.getByText(/₹50,000/)).toBeInTheDocument();
  });

  it("renders multiple entries with correct data for each row", () => {
    const recalculations: StayRecalculation[] = [
      makeRecalculation({
        id: "recalc-a",
        nightsBefore: 10,
        nightsAfter: 8,
        totalAmountBefore: 50000,
        totalAmountAfter: 40000,
        recalculatedOn: "2025-06-03",
        createdAt: "2025-06-03T09:00:00.000Z",
      }),
      makeRecalculation({
        id: "recalc-b",
        nightsBefore: 8,
        nightsAfter: 6,
        totalAmountBefore: 40000,
        totalAmountAfter: 30000,
        recalculatedOn: "2025-06-06",
        createdAt: "2025-06-06T11:00:00.000Z",
      }),
    ];

    render(<StayRecalculationHistoryCard recalculations={recalculations} />);

    // Both dates present
    expect(screen.getByText("2025-06-03")).toBeInTheDocument();
    expect(screen.getByText("2025-06-06")).toBeInTheDocument();

    // Both night transitions present
    expect(screen.getByText("10 → 8 nights")).toBeInTheDocument();
    expect(screen.getByText("8 → 6 nights")).toBeInTheDocument();

    // No empty state shown
    expect(
      screen.queryByText("No recalculations recorded for this stay.")
    ).not.toBeInTheDocument();
  });

  it("renders an em dash for totalAmountBefore when it is null", () => {
    const recalc = makeRecalculation({
      id: "recalc-null",
      totalAmountBefore: null,
      totalAmountAfter: 25000,
    });

    render(<StayRecalculationHistoryCard recalculations={[recalc]} />);

    // The em dash should appear for the "before" amount
    expect(screen.getByText(/—/)).toBeInTheDocument();
    // The "after" amount should still display correctly
    expect(screen.getByText(/₹25,000/)).toBeInTheDocument();
  });
});

describe("StayRecalculationHistoryCard — ordering is oldest-first (Req 13.5)", () => {
  it("renders rows in ascending date order regardless of input array order", () => {
    // Provide entries in REVERSE chronological order — the card should sort
    // them oldest-first internally via buildRecalculationHistoryRows.
    const recalculations: StayRecalculation[] = [
      makeRecalculation({
        id: "recalc-newest",
        nightsBefore: 6,
        nightsAfter: 5,
        totalAmountBefore: 30000,
        totalAmountAfter: 25000,
        recalculatedOn: "2025-06-10",
        createdAt: "2025-06-10T14:00:00.000Z",
      }),
      makeRecalculation({
        id: "recalc-middle",
        nightsBefore: 8,
        nightsAfter: 6,
        totalAmountBefore: 40000,
        totalAmountAfter: 30000,
        recalculatedOn: "2025-06-07",
        createdAt: "2025-06-07T12:00:00.000Z",
      }),
      makeRecalculation({
        id: "recalc-oldest",
        nightsBefore: 10,
        nightsAfter: 8,
        totalAmountBefore: 50000,
        totalAmountAfter: 40000,
        recalculatedOn: "2025-06-03",
        createdAt: "2025-06-03T09:00:00.000Z",
      }),
    ];

    const { container } = render(
      <StayRecalculationHistoryCard recalculations={recalculations} />
    );

    // Grab all rendered rows in DOM order
    const rows = container.querySelectorAll(".rounded-lg.border");
    expect(rows).toHaveLength(3);

    // First row should be the oldest (2025-06-03)
    expect(within(rows[0] as HTMLElement).getByText("2025-06-03")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText("10 → 8 nights")).toBeInTheDocument();

    // Second row should be the middle (2025-06-07)
    expect(within(rows[1] as HTMLElement).getByText("2025-06-07")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("8 → 6 nights")).toBeInTheDocument();

    // Third row should be the newest (2025-06-10)
    expect(within(rows[2] as HTMLElement).getByText("2025-06-10")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("6 → 5 nights")).toBeInTheDocument();
  });

  it("uses createdAt as tiebreaker for entries on the same date", () => {
    const recalculations: StayRecalculation[] = [
      makeRecalculation({
        id: "recalc-later",
        nightsBefore: 7,
        nightsAfter: 5,
        totalAmountBefore: 35000,
        totalAmountAfter: 25000,
        recalculatedOn: "2025-06-05",
        createdAt: "2025-06-05T15:00:00.000Z", // later timestamp
      }),
      makeRecalculation({
        id: "recalc-earlier",
        nightsBefore: 10,
        nightsAfter: 7,
        totalAmountBefore: 50000,
        totalAmountAfter: 35000,
        recalculatedOn: "2025-06-05",
        createdAt: "2025-06-05T09:00:00.000Z", // earlier timestamp
      }),
    ];

    const { container } = render(
      <StayRecalculationHistoryCard recalculations={recalculations} />
    );

    const rows = container.querySelectorAll(".rounded-lg.border");
    expect(rows).toHaveLength(2);

    // First row: earlier createdAt (nightsBefore=10)
    expect(within(rows[0] as HTMLElement).getByText("10 → 7 nights")).toBeInTheDocument();

    // Second row: later createdAt (nightsBefore=7)
    expect(within(rows[1] as HTMLElement).getByText("7 → 5 nights")).toBeInTheDocument();
  });
});

describe("StayRecalculationHistoryCard — independence (Req 13.6, 13.7)", () => {
  it("renders correctly in isolation from only its recalculations prop", () => {
    // This test confirms the card only reads from its `recalculations` prop.
    // The structural guarantee (not reading extensions) is verified by the
    // property test 15.9; here we just confirm the component works in isolation.
    const recalculations: StayRecalculation[] = [
      makeRecalculation({
        id: "recalc-iso-1",
        nightsBefore: 12,
        nightsAfter: 9,
        totalAmountBefore: 60000,
        totalAmountAfter: 45000,
        recalculatedOn: "2025-07-01",
        createdAt: "2025-07-01T08:00:00.000Z",
      }),
    ];

    // The component receives ONLY recalculations — no extensions, no ledger,
    // no balance. It should render without error.
    render(<StayRecalculationHistoryCard recalculations={recalculations} />);

    expect(screen.getByText("Recalculation History")).toBeInTheDocument();
    expect(screen.getByText("2025-07-01")).toBeInTheDocument();
    expect(screen.getByText("12 → 9 nights")).toBeInTheDocument();
    expect(screen.getByText(/₹60,000/)).toBeInTheDocument();
    expect(screen.getByText(/₹45,000/)).toBeInTheDocument();
  });

  it("renders the card title regardless of whether entries are present", () => {
    render(<StayRecalculationHistoryCard recalculations={[]} />);
    expect(screen.getByText("Recalculation History")).toBeInTheDocument();
  });
});
