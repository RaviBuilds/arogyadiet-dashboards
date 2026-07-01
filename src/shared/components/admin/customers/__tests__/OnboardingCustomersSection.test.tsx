// @vitest-environment jsdom

// src/shared/components/admin/customers/__tests__/OnboardingCustomersSection.test.tsx
//
// Component tests for the admin Customers dashboard onboarding sections
// (Task 11.3).
//
//   Req 15.10 — WHEN the "onboarded customer" or "onboarding completed customer"
//               section contains zero records, an empty state is shown (rather
//               than an empty table body).
//   Req 15.7  — WHILE the list action is in progress, a loading state is shown.
//   Req 6.9/6.10 — the IN_PROGRESS and COMPLETED buckets render their own title
//               and, once loaded, the customer rows returned by the list action.
//
// The admin-scoped list Server Actions are mocked so the client section renders
// in isolation without Supabase or auth.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";

const listOnboardedCustomersAction = vi.fn();
const listCompletedCustomersAction = vi.fn();

vi.mock("@/actions/admin-actions/onboardingActions", () => ({
  listOnboardedCustomersAction: (...a: unknown[]) =>
    listOnboardedCustomersAction(...a),
  listCompletedCustomersAction: (...a: unknown[]) =>
    listCompletedCustomersAction(...a),
}));

// next/link renders a plain anchor in tests.
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { OnboardingCustomersSection } from "@/shared/components/admin/customers/OnboardingCustomersSection";

beforeEach(() => {
  vi.clearAllMocks();
});

const customerRow = {
  profileId: "profile-1",
  customerCode: "CUST-001",
  fullName: "Rahul Sharma",
  mobile: "9876543210",
  email: "rahul@example.com",
  isTestEmail: false,
  onboardingStatus: "IN_PROGRESS",
  franchiseId: null,
  clinicId: null,
  createdAt: "2024-03-01T10:00:00.000Z",
};

describe("OnboardingCustomersSection — loading state (Req 15.7)", () => {
  it("shows a loading indicator while the list action is pending", () => {
    // A promise that never resolves keeps the section in its loading state.
    listOnboardedCustomersAction.mockReturnValue(new Promise(() => {}));

    render(<OnboardingCustomersSection status="IN_PROGRESS" />);

    expect(screen.getByText(/loading customers/i)).toBeInTheDocument();
  });
});

describe("OnboardingCustomersSection — empty states (Req 15.10)", () => {
  it("shows the onboarded empty state when there are zero IN_PROGRESS records", async () => {
    listOnboardedCustomersAction.mockResolvedValue({
      success: true,
      customers: [],
    });

    render(<OnboardingCustomersSection status="IN_PROGRESS" />);

    // Loading resolves to the empty state (Req 15.10).
    await waitForElementToBeRemoved(() =>
      screen.queryByText(/loading customers/i),
    );
    expect(screen.getByText(/no onboarded customers yet/i)).toBeInTheDocument();
    // The empty state replaces the table body — no customer rows are rendered.
    expect(screen.queryByRole("link", { name: /view/i })).not.toBeInTheDocument();
  });

  it("shows the completed empty state when there are zero COMPLETED records", async () => {
    listCompletedCustomersAction.mockResolvedValue({
      success: true,
      customers: [],
    });

    render(<OnboardingCustomersSection status="COMPLETED" />);

    await waitForElementToBeRemoved(() =>
      screen.queryByText(/loading customers/i),
    );
    expect(
      screen.getByText(/no completed onboardings yet/i),
    ).toBeInTheDocument();
  });
});

describe("OnboardingCustomersSection — populated list (Req 6.9)", () => {
  it("renders the onboarded customers returned by the list action", async () => {
    listOnboardedCustomersAction.mockResolvedValue({
      success: true,
      customers: [customerRow],
    });

    render(<OnboardingCustomersSection status="IN_PROGRESS" />);

    await waitForElementToBeRemoved(() =>
      screen.queryByText(/loading customers/i),
    );
    expect(screen.getByText("Rahul Sharma")).toBeInTheDocument();
    expect(screen.getByText("CUST-001")).toBeInTheDocument();
    // The empty state is not shown when rows are present.
    expect(
      screen.queryByText(/no onboarded customers yet/i),
    ).not.toBeInTheDocument();
  });
});
