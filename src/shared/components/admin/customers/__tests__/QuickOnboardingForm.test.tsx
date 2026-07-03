// @vitest-environment jsdom

// src/shared/components/admin/customers/__tests__/QuickOnboardingForm.test.tsx
//
// Component tests for the admin Quick_Onboarding_Form wizard (Task 11.3).
//
//   Req 10.2      — an optional email field with an adjacent "test email"
//                   checkbox is present.
//   Req 7.1–7.4   — at/after the 5 PM IST cutoff a warning is shown and the
//                   "Onboard Customer" action is gated behind an acknowledgment
//                   checkbox: disabled until acknowledged, re-disabled when the
//                   acknowledgment is cleared.
//
// The AddressCaptureMap (Google Maps) and the onboarding action are mocked, and
// the IST clock is forced past the cutoff so the acknowledgment gate is active.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// --- Force "after 5 PM IST" so the cutoff gate is active (Req 7.1). ---------
vi.mock("@/lib/dates/ist", () => ({
  istHourOf: () => 18, // 6 PM IST → at/after the 17:00 cutoff
}));
vi.mock("@/lib/onboarding/cutoff", () => ({
  ONBOARDING_CUTOFF_HOUR_IST: 17,
  earliestStartDate: () => "2024-03-07",
}));

// --- Mock the map-based Address_Capture to report a valid, resolved address. -
vi.mock("@/shared/components/address/AddressCaptureMap", async () => {
  const React = await import("react");
  const emptyAddressCaptureValue = {
    tag: "Home",
    searchText: "",
    flatNumber: "",
    floorNumber: "",
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

// Radix Select is unreliable to drive in jsdom (it relies on pointer/layout
// APIs jsdom only partially implements). Replace the Shadcn Select wrapper with
// a deterministic native <select> so wizard navigation is stable; the behavior
// under test (test-email control + cutoff gate) is unaffected by this swap.
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

const onboardCustomerAction = vi.fn();
vi.mock("@/actions/admin-actions/onboardingActions", () => ({
  onboardCustomerAction: (...a: unknown[]) => onboardCustomerAction(...a),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { QuickOnboardingForm } from "@/shared/components/admin/customers/QuickOnboardingForm";

// A valid RFC-compliant UUID (version 4, variant 8). The onboarding schema
// validates planId with `z.string().uuid()`, which (in zod v4) rejects
// non-RFC values such as an all-ones string — so the plan id must be a
// well-formed UUID for the wizard to advance past the Category/Plan step.
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
    base_price: 28080.00,
    tax_rate: 0.05,
    is_active: true,
    created_at: new Date("2024-01-01"),
  },
];

/** Advance the wizard from Details → Payment & Review. */
async function goToReviewStep(user: ReturnType<typeof userEvent.setup>) {
  // Step 1 — Details
  await user.type(screen.getByLabelText(/full name/i), "Rahul Sharma");
  await user.type(screen.getByLabelText(/mobile number/i), "9876543210");
  // Gender is the only Select on this step (native <select> via mock).
  await user.selectOptions(screen.getByRole("combobox"), "Male");
  await user.click(screen.getByRole("radio", { name: "Veg" }));
  // Enter temp PIN
  await user.type(screen.getByLabelText(/temporary pin/i), "123456");
  await user.click(screen.getByRole("button", { name: /next/i }));

  // Step 2 — Category & Plan (MEAL is the default category)
  // Now there are potentially multiple comboboxes, get the plan select
  const comboboxes = screen.getAllByRole("combobox");
  // For MEAL category (default), the first combobox is the plan selector
  await user.selectOptions(comboboxes[0], PLAN_ID);
  // Select initial meal preference
  await user.click(screen.getByRole("radio", { name: "Veg" }));
  await user.click(screen.getByRole("button", { name: /next/i }));

  // Step 3 — Address (mock already reported a valid address)
  expect(await screen.findByTestId("address-capture-mock")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /next/i }));

  // Step 4 — Payment & Review
  await screen.findByRole("button", { name: /onboard customer/i });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("QuickOnboardingForm — test-email control (Req 10.2)", () => {
  it("shows an optional email field with an adjacent test-email checkbox", async () => {
    const user = userEvent.setup();
    render(
      <QuickOnboardingForm plans={PLANS} kitProducts={KIT_PRODUCTS} serviceAreaPincodes={["500081"]} />,
    );

    await goToReviewStep(user);

    expect(screen.getByRole("textbox", { name: /email/i })).toBeInTheDocument();
    // The Test_Email checkbox next to the email field (Req 10.2).
    expect(
      screen.getByText(/placeholder \/ test email/i),
    ).toBeInTheDocument();
    // At least the test-email checkbox is present (the cutoff-ack checkbox is
    // also present because the clock is forced past the cutoff).
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThanOrEqual(1);
  });
});

describe("QuickOnboardingForm — 5 PM cutoff acknowledgment gate (Req 7.1–7.4)", () => {
  it("warns past the cutoff and gates Onboard behind the acknowledgment", async () => {
    const user = userEvent.setup();
    render(
      <QuickOnboardingForm plans={PLANS} kitProducts={KIT_PRODUCTS} serviceAreaPincodes={["500081"]} />,
    );

    await goToReviewStep(user);

    // Req 7.1: a cutoff warning is displayed.
    expect(
      screen.getByText(/cutoff acknowledgment required/i),
    ).toBeInTheDocument();

    const onboard = screen.getByRole("button", { name: /onboard customer/i });

    // Mark payment collected (PAID) via the switch.
    await user.click(screen.getByRole("switch", { name: /mark payment collected/i }));

    // Req 7.2: still disabled while the acknowledgment is unchecked.
    expect(onboard).toBeDisabled();

    // Req 7.3: acknowledging enables the action.
    const ack = screen.getByRole("checkbox", { name: /acknowledge cutoff/i });
    await user.click(ack);
    expect(onboard).toBeEnabled();

    // Req 7.4: clearing the acknowledgment disables it again.
    await user.click(ack);
    expect(onboard).toBeDisabled();
  });
});

describe("QuickOnboardingForm — KIT product payment review (Req 4.1)", () => {
  it("displays KIT product name, base price, tax amount (5%), and total price", async () => {
    const user = userEvent.setup();
    render(
      <QuickOnboardingForm plans={PLANS} kitProducts={KIT_PRODUCTS} serviceAreaPincodes={["500081"]} />,
    );

    // Step 1 — Details
    await user.type(screen.getByLabelText(/full name/i), "Rahul Sharma");
    await user.type(screen.getByLabelText(/mobile number/i), "9876543210");
    await user.selectOptions(screen.getByRole("combobox"), "Male");
    await user.click(screen.getByRole("radio", { name: "Veg" }));
    // Enter temp PIN
    await user.type(screen.getByLabelText(/temporary pin/i), "123456");
    await user.click(screen.getByRole("button", { name: /next/i }));

    // Step 2 — Category & Plan (select KIT category)
    await user.click(screen.getByRole("radio", { name: "Meal" }));
    await user.click(screen.getByRole("radio", { name: "Kit" }));
    
    // Wait for KIT fields to appear, then select KIT product
    const kitSelects = screen.getAllByRole("combobox");
    // The KIT product dropdown should now be visible
    await user.selectOptions(kitSelects[0], KIT_PRODUCT_ID);
    
    // Enter kit duration
    await user.type(screen.getByLabelText(/kit duration \(days\)/i), "30");
    
    // Select initial meal preference
    await user.click(screen.getByRole("radio", { name: "Veg" }));
    
    await user.click(screen.getByRole("button", { name: /next/i }));

    // Step 3 — Address (mock already reported a valid address)
    expect(await screen.findByTestId("address-capture-mock")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next/i }));

    // Step 4 — Payment & Review
    await screen.findByRole("button", { name: /onboard customer/i });

    // Verify KIT-specific information is displayed
    expect(screen.getByText("KIT Product")).toBeInTheDocument();
    expect(screen.getByText("Weightloss Platinum")).toBeInTheDocument();
    
    // Verify base price is displayed
    expect(screen.getByText("Base Price")).toBeInTheDocument();
    expect(screen.getByText("₹28,080.00")).toBeInTheDocument();
    
    // Verify tax amount (5%) is displayed
    expect(screen.getByText("Tax (5%)")).toBeInTheDocument();
    expect(screen.getByText("₹1,404.00")).toBeInTheDocument();
    
    // Verify total price is displayed
    expect(screen.getByText("Total Price")).toBeInTheDocument();
    expect(screen.getByText("₹29,484.00")).toBeInTheDocument();
    
    // Verify duration is displayed
    expect(screen.getByText("Duration")).toBeInTheDocument();
    expect(screen.getByText("30 days")).toBeInTheDocument();
    
    // Verify MEAL plan information is NOT displayed
    expect(screen.queryByText("Monthly Meal Plan")).not.toBeInTheDocument();
  });
});
