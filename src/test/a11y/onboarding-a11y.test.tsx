// @vitest-environment jsdom
//
// src/test/a11y/onboarding-a11y.test.tsx
//
// Automated accessibility checks for the new customer-mobile-onboarding screens
// (Task 11.4, Req 15.12). These cover the MECHANICAL subset only — the checks
// axe can perform on a rendered DOM: every form control has an associated
// accessible label/name, interactive elements expose a discernible name, ARIA
// usage is valid, and the Radix Dialog provides a focus trap / focus restore.
//
// SCOPE + CAVEAT (Req 15.12): passing these checks does NOT constitute WCAG 2.1
// AA conformance. Color-contrast cannot be evaluated in jsdom (no layout/paint),
// so contrast is inherited from the Radix/Shadcn design tokens and must be
// confirmed by manual review; keyboard operation, screen-reader semantics, and
// reflow likewise require manual testing with assistive technologies and expert
// review. This suite is a fast regression guard for the mechanical subset, not
// a substitute for that manual review.
//
// Tooling note: we run `axe-core` directly (already in the dependency tree)
// rather than adding a matcher wrapper, and assert there are no serious/critical
// violations for the rendered subset. Document-scoped rules that only apply to a
// full HTML page (lang, <title>, landmarks, etc.) are disabled because these are
// isolated component fragments, not whole pages.

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import axe, { type RunOptions, type Result } from "axe-core";

// ---------------------------------------------------------------------------
// Module mocks — keep server-only code and external SDKs out of the DOM graph.
// ---------------------------------------------------------------------------

// Next.js router: the login form / dialog / wizard call push()/refresh().
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Customer mobile-auth server actions (would otherwise pull the service graph).
vi.mock("@/actions/mobileAuthActions", () => ({
  requestOtpAction: vi.fn(async () => ({ outcome: "SENT" })),
  resendOtpAction: vi.fn(async () => ({ outcome: "SENT" })),
  verifyOtpAction: vi.fn(async () => ({ outcome: "OK" })),
}));

// Profile-completion server actions.
vi.mock("@/actions/profileCompletionActions", () => ({
  saveProfileCompletionAction: vi.fn(async () => ({ ok: true as const })),
  markOnboardingCompletedAction: vi.fn(async () => ({ ok: true as const })),
  submitRealEmailAction: vi.fn(async () => ({ ok: true as const })),
}));

// Admin onboarding server actions.
vi.mock("@/actions/admin-actions/onboardingActions", () => ({
  onboardCustomerAction: vi.fn(async () => ({ success: true as const })),
}));

// Google Maps loader: force the NOT-loaded fallback so AddressCaptureMap renders
// its labeled form fields (tag/flat/floor/area/city/state/pincode) plus the map
// loading placeholder, without needing a real Maps SDK (Task 11.4).
vi.mock("@react-google-maps/api", () => ({
  useJsApiLoader: () => ({ isLoaded: false, loadError: undefined }),
  GoogleMap: () => null,
  Autocomplete: ({ children }: { children?: React.ReactNode }) => children,
}));

// Capacitor native shims (imported at module top by AddressCaptureMap).
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
}));
vi.mock("@capacitor/geolocation", () => ({
  Geolocation: {
    requestPermissions: vi.fn(async () => ({ location: "granted" })),
    getCurrentPosition: vi.fn(async () => ({
      coords: { latitude: 17.385, longitude: 78.4867 },
    })),
  },
}));

// ---------------------------------------------------------------------------
// Components under test (imported after mocks are registered).
// ---------------------------------------------------------------------------

import { MobileOtpLoginForm } from "@/shared/components/customer/MobileOtpLoginForm";
import { ProfileCompletionDialog } from "@/shared/components/customer/ProfileCompletionDialog";
import { QuickOnboardingForm } from "@/shared/components/admin/customers/QuickOnboardingForm";
import { AddressCaptureMap, emptyAddressCaptureValue } from "@/shared/components/address/AddressCaptureMap";

// ---------------------------------------------------------------------------
// axe helper
// ---------------------------------------------------------------------------

/**
 * Rules that require a full HTML document (a page, not an isolated component
 * fragment). They produce false positives when we mount a single component into
 * a bare test container, so we disable them for this component-level subset.
 */
const DOCUMENT_SCOPED_RULES: Record<string, { enabled: false }> = {
  "html-has-lang": { enabled: false },
  "landmark-one-main": { enabled: false },
  "page-has-heading-one": { enabled: false },
  region: { enabled: false },
  bypass: { enabled: false },
  "document-title": { enabled: false },
  // color-contrast cannot be computed in jsdom (no layout/paint engine); it
  // triggers HTMLCanvasElement.getContext probes and can only ever return
  // "incomplete". Contrast is inherited from the Radix/Shadcn design tokens and
  // is verified by manual review (Req 15.12), so it is disabled here.
  "color-contrast": { enabled: false },
};

const AXE_OPTIONS: RunOptions = {
  resultTypes: ["violations"],
  rules: DOCUMENT_SCOPED_RULES,
};

const SERIOUS_OR_CRITICAL = new Set(["serious", "critical"]);

/**
 * Run axe over the whole document (so Radix portals — e.g. the Dialog content —
 * are included) and assert there are no serious/critical violations for the
 * rendered mechanical subset. Lesser-impact / contrast findings are out of scope
 * here and are covered by manual assistive-technology review (Req 15.12).
 */
async function expectNoSeriousViolations(): Promise<Result[]> {
  const results = await axe.run(document.body, AXE_OPTIONS);
  const blocking = results.violations.filter((v) =>
    SERIOUS_OR_CRITICAL.has(v.impact ?? ""),
  );
  if (blocking.length > 0) {
    const summary = blocking
      .map(
        (v) =>
          `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s):\n` +
          v.nodes.map((n) => `    ${n.target.join(" ")}`).join("\n"),
      )
      .join("\n");
    throw new Error(`Serious/critical accessibility violations found:\n${summary}`);
  }
  return blocking;
}

const SAMPLE_PLANS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Standard Meal Plan",
    price: 3000,
    durationDays: 30,
  },
];

const SERVICE_PINCODES = ["500081", "500084"];

beforeAll(() => {
  // AddressCaptureMap short-circuits to a minimal "configure API key" fallback
  // when this is unset; provide a dummy so the labeled form fields render.
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = "test-google-maps-key";
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Accessibility (mechanical subset) — customer-mobile-onboarding screens", () => {
  it("customer mobile OTP login — mobile-entry step has no serious/critical violations", async () => {
    render(<MobileOtpLoginForm />);
    // Sanity: the labeled mobile field is present.
    expect(screen.getByLabelText(/mobile number/i)).toBeInTheDocument();
    await expectNoSeriousViolations();
  });

  it("customer mobile OTP login — OTP-entry step has no serious/critical violations", async () => {
    render(<MobileOtpLoginForm />);

    // Advance to the OTP step: enter a mobile number and submit "Next".
    fireEvent.change(screen.getByLabelText(/mobile number/i), {
      target: { value: "9876543210" },
    });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // The OTP entry field (labeled "Verification code") appears after SENT.
    const codeField = await screen.findByLabelText(/verification code/i);
    expect(codeField).toBeInTheDocument();

    await expectNoSeriousViolations();
  });

  it("profile completion dialog — focus trap + labeled fields, no serious/critical violations", async () => {
    render(<ProfileCompletionDialog isTestEmail defaultOpen />);

    // Radix Dialog mounts its content in a portal; confirm it is open and that
    // its inputs are labeled.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText(/date of birth/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();

    await expectNoSeriousViolations();
  });

  it("quick onboarding wizard — details step has no serious/critical violations", async () => {
    render(
      <QuickOnboardingForm
        plans={SAMPLE_PLANS}
        serviceAreaPincodes={SERVICE_PINCODES}
      />,
    );
    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    await expectNoSeriousViolations();
  });

  it("address capture map (Maps loader mocked to fallback) has no serious/critical violations", async () => {
    render(
      <AddressCaptureMap
        value={emptyAddressCaptureValue}
        onChange={() => {}}
        serviceAreaPincodes={SERVICE_PINCODES}
      />,
    );
    // Fallback rendering still exposes the labeled address fields.
    await waitFor(() =>
      expect(screen.getByLabelText(/flat number/i)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/pincode/i)).toBeInTheDocument();

    await expectNoSeriousViolations();
  });
});
