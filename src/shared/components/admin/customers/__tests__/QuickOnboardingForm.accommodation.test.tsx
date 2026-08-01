// @vitest-environment jsdom

// src/shared/components/admin/customers/__tests__/QuickOnboardingForm.accommodation.test.tsx
//
// Example-based render-condition tests for the ACCOMMODATION branch of the
// Quick_Onboard_Form wizard (Task 10.3, accommodation-payment-lifecycle spec).
//
//   Req 1.1  — Backdated_Stay_Toggle is present for ACCOMMODATION and absent
//              for MEAL/KIT.
//   Req 1.5  — the toggle/backdated fields apply only to ACCOMMODATION.
//   Req 2.2, 2.3, 2.4 — the completion alert appears/clears as total nights
//              change, without leaving the Category & Plan step.
//   Req 4.1  — the total/advance payment split replaces the single payment
//              field and disappears under shared payment.
//
// This file mocks `@/lib/dates/ist` COMPLETELY (istHourOf, istDateStringOf,
// getISTDateString, addDaysToISODate) because the component's ACCOMMODATION
// branch imports `istDateStringOf` and `addDaysToISODate` in addition to
// `istHourOf` — a partial mock (as used in the sibling
// QuickOnboardingForm.test.tsx file) leaves those undefined and crashes any
// render that touches the ACCOMMODATION category. This file is deliberately
// example-based (not property-based) per the task's Notes section.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// --- Fully mock the IST date module the ACCOMMODATION branch relies on. ----
// "Today" is fixed at 2025-06-15 for deterministic backdated-range math.
// Override only the "wall clock now" primitives so the ACCOMMODATION branch's
// date math is deterministic; keep every other export (parseISODateString,
// RIDER_DAY_ROLLOVER_HOUR_IST, etc.) intact via importOriginal so unrelated
// code paths (e.g. PastDayStatusPopup, the MEAL/KIT cutoff module) that the
// component imports unconditionally do not crash on a missing export.
vi.mock("@/lib/dates/ist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dates/ist")>();
  return {
    ...actual,
    istHourOf: () => 10, // before the 5 PM cutoff; irrelevant for ACCOMMODATION (no cutoff rule)
    istDateStringOf: () => "2025-06-15",
    getISTDateString: () => "2025-06-15",
    addDaysToISODate: (date: string, days: number) => {
      const d = new Date(date + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    },
  };
});

// --- Mock the map-based Address_Capture (unused by ACCOMMODATION, but the
// module is imported unconditionally by the component). ---------------------
vi.mock("@/shared/components/address/AddressCaptureMap", async () => {
  const React = await import("react");
  const emptyAddressCaptureValue = {
    tag: "Home",
    searchText: "",
    flatNumber: "",
    floorNumber: "",
    streetAddress: "",
    area: "",
    city: "",
    state: "",
    pincode: "",
    lat: null,
    lng: null,
  };
  function AddressCaptureMap(props: {
    onChange?: (v: unknown) => void;
    onValidityChange?: (v: unknown) => void;
  }) {
    React.useEffect(() => {
      props.onChange?.({
        tag: "Home",
        searchText: "Madhapur",
        flatNumber: "302",
        floorNumber: "3",
        area: "Madhapur",
        city: "Hyderabad",
        state: "Telangana",
        pincode: "500081",
        lat: 17.44,
        lng: 78.39,
      });
      props.onValidityChange?.({
        canSave: true,
        errors: [],
        isServiceable: true,
        isResolved: true,
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="address-capture-mock" />;
  }
  return { AddressCaptureMap, emptyAddressCaptureValue };
});

// Radix Select is unreliable to drive in jsdom. Swap in a deterministic
// native <select>, matching the sibling test file's approach.
vi.mock("@/shared/components/ui/select", async () => {
  const React = await import("react");
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (v: string) => void;
      children?: React.ReactNode;
    }) =>
      React.createElement(
        "select",
        {
          value: value ?? "",
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
            onValueChange?.(e.target.value),
        },
        children,
      ),
    SelectContent: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SelectItem: ({
      value,
      children,
    }: {
      value: string;
      children?: React.ReactNode;
    }) => React.createElement("option", { value }, children),
    SelectTrigger: () => null,
    SelectValue: () => null,
  };
});

vi.mock("@/actions/admin-actions/onboardingActions", () => ({
  onboardCustomerAction: vi.fn(),
  checkMobileUniqueAction: vi.fn().mockResolvedValue({ available: true }),
}));

vi.mock("@/actions/accommodationOnboardingActions", () => ({
  onboardAccommodationCustomerAction: vi.fn(),
}));

// Called on mount once ACCOMMODATION is selected (Req 9.1/9.2 of the
// accommodation-customer-flow spec) — resolve to an empty list so the effect
// settles without hanging or throwing.
vi.mock("@/actions/admin-actions/customerHealthLogActions", () => ({
  listActiveDietitiansForAdmin: vi
    .fn()
    .mockResolvedValue({ success: true, data: [] }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { QuickOnboardingForm } from "@/shared/components/admin/customers/QuickOnboardingForm";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const PLANS = [
  {
    id: PLAN_ID,
    name: "Monthly Meal Plan",
    price: 2499,
    durationDays: 30,
  },
];

const KIT_PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const KIT_PRODUCTS = [
  {
    id: KIT_PRODUCT_ID,
    name: "Weightloss Platinum",
    base_price: 28080.0,
    tax_rate: 0.05,
    is_active: true,
    created_at: new Date("2024-01-01"),
  },
];

/** Advance the wizard from Details (step 1) to Category & Plan (step 2). */
async function goToCategoryStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/full name/i), "Rahul Sharma");
  await user.type(screen.getByLabelText(/mobile number/i), "9876543210");
  await user.selectOptions(screen.getByRole("combobox"), "Male");
  await user.click(screen.getByRole("radio", { name: "Veg" }));
  await user.type(screen.getByLabelText(/temporary pin/i), "123456");
  await user.click(screen.getByRole("button", { name: /next/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("QuickOnboardingForm — Backdated_Stay_Toggle visibility (Req 1.1, 1.5)", () => {
  it("shows the backdated toggle only when ACCOMMODATION is selected", async () => {
    const user = userEvent.setup();
    render(
      <QuickOnboardingForm
        plans={PLANS}
        kitProducts={KIT_PRODUCTS}
        serviceAreaPincodes={["500081"]}
      />,
    );

    await goToCategoryStep(user);

    // Default category is MEAL — no backdated toggle.
    expect(screen.queryByText(/backdated stay entry/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Accommodation" }));
    expect(screen.getByText(/backdated stay entry/i)).toBeInTheDocument();
  });

  it("hides the backdated toggle for KIT", async () => {
    const user = userEvent.setup();
    render(
      <QuickOnboardingForm
        plans={PLANS}
        kitProducts={KIT_PRODUCTS}
        serviceAreaPincodes={["500081"]}
      />,
    );

    await goToCategoryStep(user);
    await user.click(screen.getByRole("radio", { name: "Kit" }));

    expect(screen.queryByText(/backdated stay entry/i)).not.toBeInTheDocument();
  });
});

describe("QuickOnboardingForm — payment split fields (Req 4.1)", () => {
  it("shows total stay amount and advance amount fields for ACCOMMODATION, not the single field", async () => {
    const user = userEvent.setup();
    render(
      <QuickOnboardingForm
        plans={PLANS}
        kitProducts={KIT_PRODUCTS}
        serviceAreaPincodes={["500081"]}
      />,
    );

    await goToCategoryStep(user);
    await user.click(screen.getByRole("radio", { name: "Accommodation" }));

    expect(
      screen.getByLabelText(/total stay amount/i),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/advance amount paid/i),
    ).toBeInTheDocument();
    // No generic single "payment amount" field exists alongside the split.
    expect(
      screen.queryByLabelText(/^payment amount/i),
    ).not.toBeInTheDocument();
  });

  it("hides both split fields for MEAL/KIT", async () => {
    const user = userEvent.setup();
    render(
      <QuickOnboardingForm
        plans={PLANS}
        kitProducts={KIT_PRODUCTS}
        serviceAreaPincodes={["500081"]}
      />,
    );

    await goToCategoryStep(user);
    // MEAL is the default category on this step.
    expect(screen.queryByLabelText(/total stay amount/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/advance amount paid/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Kit" }));
    expect(screen.queryByLabelText(/total stay amount/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/advance amount paid/i)).not.toBeInTheDocument();
  });
});

describe("QuickOnboardingForm — shared payment hides the split fields (Req 4.1)", () => {
  it("hides total/advance fields and shows payment host mobile when shared payment is checked, and restores them when unchecked", async () => {
    const user = userEvent.setup();
    render(
      <QuickOnboardingForm
        plans={PLANS}
        kitProducts={KIT_PRODUCTS}
        serviceAreaPincodes={["500081"]}
      />,
    );

    await goToCategoryStep(user);
    await user.click(screen.getByRole("radio", { name: "Accommodation" }));

    expect(screen.getByLabelText(/total stay amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/advance amount paid/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/payment host mobile/i)).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("checkbox", { name: /this is a shared payment/i }),
    );

    expect(screen.queryByLabelText(/total stay amount/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/advance amount paid/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/payment host mobile/i)).toBeInTheDocument();

    await user.click(
      screen.getByRole("checkbox", { name: /this is a shared payment/i }),
    );

    expect(screen.getByLabelText(/total stay amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/advance amount paid/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/payment host mobile/i)).not.toBeInTheDocument();
  });
});

describe("QuickOnboardingForm — backdated completion alert (Req 2.2, 2.3, 2.4)", () => {
  it("shows the alert for a past end date, clears it as nights change, and never leaves the Category & Plan step", async () => {
    const user = userEvent.setup();
    render(
      <QuickOnboardingForm
        plans={PLANS}
        kitProducts={KIT_PRODUCTS}
        serviceAreaPincodes={["500081"]}
      />,
    );

    await goToCategoryStep(user);
    await user.click(screen.getByRole("radio", { name: "Accommodation" }));

    // Enable the Backdated_Stay_Toggle so a past start date is selectable.
    await user.click(screen.getByText(/backdated stay entry/i));

    // "Today" is mocked as 2025-06-15. A start date 20 days ago with a
    // 1-night stay computes an end date well in the past.
    const startDateInput = screen.getByLabelText(/stay start date/i);
    await user.clear(startDateInput);
    await user.type(startDateInput, "2025-05-26");

    const totalNightsInput = screen.getByLabelText(/total nights/i);
    await user.clear(totalNightsInput);
    await user.type(totalNightsInput, "1");

    expect(
      await screen.findByText(/stay will be created as finished/i),
    ).toBeInTheDocument();

    // Req 2.4: the wizard has not advanced — still on Category & Plan (the
    // "Onboard Customer" button belonging to the Payment & Review step has
    // not appeared, and the backdated toggle text — unique to this step — is
    // still visible).
    expect(
      screen.queryByRole("button", { name: /onboard customer/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/backdated stay entry/i)).toBeInTheDocument();

    // Increase total nights enough to push the computed end date into the
    // future relative to the mocked "today" (2025-06-15).
    await user.clear(totalNightsInput);
    await user.type(totalNightsInput, "60");

    expect(
      screen.queryByText(/stay will be created as finished/i),
    ).not.toBeInTheDocument();

    // Still on Category & Plan — the alert clearing did not navigate away.
    expect(
      screen.queryByRole("button", { name: /onboard customer/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/backdated stay entry/i)).toBeInTheDocument();
  });
});
