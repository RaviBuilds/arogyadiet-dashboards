// @vitest-environment jsdom
//
// src/test/dietitian/log-customer-cta.property.test.tsx
// Feature: dietitian-management, Property 29
//
// Property 29 (design.md): "For any Access_Level, the admin Customers
// workspace renders the Log Customer call to action and omits the Shop
// Orders and Onboarding calls to action iff the Access_Level is `dietitian`,
// and the franchise Customers workspace renders Log Customer and omits Quick
// Onboard and Create Customer iff the Access_Level is `dietitian`."
//
// Validates: Requirements 15.1, 15.2, 23.3
//
// `CustomerDashboard` (admin) and `FranchiseCustomerDashboard` (franchise)
// both receive a boolean `isDietitian` prop — the real page components derive
// it from the resolved Access_Level via `guardCustomersWorkspace()` /
// `resolveIsFranchiseDietitian()`, both of which bottom out in
// `isDietitianLevel` (src/lib/auth/adminAccessCore.ts). This test drives that
// exact boolean from every Access_Level via the real `isDietitianLevel`, so
// the "iff dietitian" condition in the property is checked against the same
// predicate the app uses, not a hand-rolled equality check. Every Server
// Action the two dashboards import is mocked at the I/O boundary (mirroring
// the pattern of dietitian-customer-list.property.test.ts and
// user-management-partition.property.test.tsx) so this test exercises only
// the CTA-swap rendering logic added for this feature.
//
// vitest + fast-check, >=100 runs.

import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as fc from "fast-check";

import { accessLevelArb } from "@/test/dietitian/arbitraries";
import { isDietitianLevel } from "@/lib/auth/adminAccessCore";

// ─── Mocks shared by both dashboards ───────────────────────────────────────

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Admin dashboard's Server Actions (revalidate/update/deactivate) — never
// invoked by this test, which only renders the CTA row.
vi.mock("@/actions/admin-actions/customerActions", () => ({
  revalidateCustomersPage: vi.fn(),
  updateCustomerBasicInfo: vi.fn(),
  deactivateCustomerAccount: vi.fn(),
}));

// Franchise dashboard's Server Actions, plus the create-customer modal's own
// action imports (the modal is imported unconditionally at module scope even
// though it only renders when !isDietitian).
vi.mock("@/actions/franchise-actions/franchiseCustomerManagementActions", () => ({
  franchiseDeactivateCustomerAccount: vi.fn(),
  revalidateFranchiseCustomersPage: vi.fn(),
  franchiseUpdateCustomerBasicInfo: vi.fn(),
  franchiseUpdateCustomerDietaryProfile: vi.fn(),
}));
vi.mock("@/actions/franchise-actions/franchiseCustomerActions", () => ({
  franchiseCreateCustomerAction: vi.fn(),
}));
vi.mock("@/actions/pincodeActions", () => ({
  getServiceAreaPincodesAction: vi.fn(async () => []),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/customers",
  useSearchParams: () => new URLSearchParams(),
}));

// ─── System under test (imported after the mocks are registered) ──────────

import CustomerDashboard from "@/shared/components/admin/customers/CustomerDashboard";
import FranchiseCustomerDashboard from "@/app/franchise/(main)/customers/FranchiseCustomerDashboard";

// Rendering two full customer-dashboard trees per run is comparatively slow
// in jsdom; the input space (4 Access_Levels) is small and exhaustible, but
// the task calls for >=100 runs, so the property function stays cheap per
// call and the suite is given a generous timeout.
const NUM_RUNS = 100;

describe("Property 29: The Log Customer call to action replaces the onboarding calls to action for Dietitians", () => {
  it("admin workspace: renders Log Customer and omits Shop Orders/Onboarding iff Access_Level is dietitian", () => {
    /**
     * **Validates: Requirements 15.1, 23.3** (admin half)
     */
    fc.assert(
      fc.property(accessLevelArb, (level) => {
        cleanup();
        const isDietitian = isDietitianLevel(level);

        render(<CustomerDashboard isDietitian={isDietitian} />);

        const logCustomerLink = screen.queryByRole("link", {
          name: /log customer/i,
        });
        const shopOrdersLink = screen.queryByRole("link", {
          name: /shop orders/i,
        });
        const onboardingLink = screen.queryByRole("link", {
          name: /^onboarding$/i,
        });

        if (isDietitian) {
          expect(logCustomerLink).toBeInTheDocument();
          expect(logCustomerLink).toHaveAttribute("href", "/log-customer");
          expect(shopOrdersLink).not.toBeInTheDocument();
          expect(onboardingLink).not.toBeInTheDocument();
        } else {
          expect(logCustomerLink).not.toBeInTheDocument();
          expect(shopOrdersLink).toBeInTheDocument();
          expect(shopOrdersLink).toHaveAttribute(
            "href",
            "/customers/assisted-order",
          );
          expect(onboardingLink).toBeInTheDocument();
          expect(onboardingLink).toHaveAttribute("href", "/customers/onboarding");
        }

        cleanup();
      }),
      { numRuns: NUM_RUNS },
    );
  }, 120000);

  it("franchise workspace: renders Log Customer and omits Quick Onboard/Create Customer iff Access_Level is dietitian", () => {
    /**
     * **Validates: Requirements 15.2, 23.3** (franchise half)
     */
    fc.assert(
      fc.property(accessLevelArb, (level) => {
        cleanup();
        const isDietitian = isDietitianLevel(level);

        render(
          <FranchiseCustomerDashboard
            customers={[]}
            franchiseId="franchise-1"
            isDietitian={isDietitian}
          />,
        );

        const logCustomerLink = screen.queryByRole("link", {
          name: /log customer/i,
        });
        const quickOnboardLink = screen.queryByRole("link", {
          name: /quick onboard/i,
        });
        const createCustomerButton = screen.queryByRole("button", {
          name: /create customer/i,
        });

        if (isDietitian) {
          expect(logCustomerLink).toBeInTheDocument();
          expect(logCustomerLink).toHaveAttribute("href", "/log-customer");
          expect(quickOnboardLink).not.toBeInTheDocument();
          expect(createCustomerButton).not.toBeInTheDocument();
        } else {
          expect(logCustomerLink).not.toBeInTheDocument();
          expect(quickOnboardLink).toBeInTheDocument();
          expect(quickOnboardLink).toHaveAttribute(
            "href",
            "/customers/quick-onboard",
          );
          expect(createCustomerButton).toBeInTheDocument();
        }

        cleanup();
      }),
      { numRuns: NUM_RUNS },
    );
  }, 120000);
});
