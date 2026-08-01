// @vitest-environment jsdom
//
// src/test/a11y/clinic-scoped-shop-inventory-a11y.test.tsx
//
// Automated accessibility checks for the new clinic-scoped-shop-inventory
// interactive components (Task 13.1, Requirements 5.1, 7.1, 7.5, 9.6, 13.2,
// 13.4). These cover the MECHANICAL subset only — the checks axe can perform
// on a rendered DOM: every form control has an associated accessible
// label/name, interactive elements expose a discernible name, ARIA usage is
// valid, and the Radix Dialog/Select/Sheet primitives provide a focus trap /
// focus restore where applicable.
//
// SCOPE + CAVEAT: passing these checks does NOT constitute WCAG 2.1 AA
// conformance. Color-contrast cannot be evaluated in jsdom (no layout/paint),
// so contrast is inherited from the Radix/Shadcn design tokens and must be
// confirmed by manual review; keyboard operation, screen-reader semantics, and
// reflow likewise require manual testing with assistive technologies and
// expert review. This suite is a fast regression guard for the mechanical
// subset, not a substitute for that manual review.
//
// Tooling note: this mirrors src/test/a11y/onboarding-a11y.test.tsx exactly —
// we run `axe-core` directly (already in the dependency tree) rather than
// adding a matcher wrapper, and assert there are no serious/critical
// violations for the rendered subset. Document-scoped rules that only apply
// to a full HTML page (lang, <title>, landmarks, etc.) are disabled because
// these are isolated component fragments, not whole pages.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe, { type RunOptions, type Result } from "axe-core";

// ---------------------------------------------------------------------------
// Module mocks — keep server-only code and external SDKs out of the DOM graph.
// ---------------------------------------------------------------------------

// Next.js router/pathname/search-params: Destination Selector and the
// stock-in cart call these.
const mockReplace = vi.fn();
const mockRefresh = vi.fn();
const mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mockReplace,
    refresh: mockRefresh,
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/warehouse/shop-products",
  useSearchParams: () => mockSearchParams,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Clinic shop inventory server actions — mocked per-test via `vi.mocked`.
vi.mock("@/actions/admin-actions/clinicShopInventoryActions", () => ({
  getDestinationOptionsAction: vi.fn(),
  clinicStockInAction: vi.fn(),
}));

// Master-portal dietitian/clinic-listing server actions used by
// UserManagement (Clinic Access dropdown + Dietitians section share the same
// clinic fetch).
vi.mock("@/actions/master-actions/dietitianActions", () => ({
  listDietitians: vi.fn(async () => ({ success: true, data: [] })),
  listClinicsForDietitianAssignment: vi.fn(),
  createDietitian: vi.fn(),
  updateDietitian: vi.fn(),
  toggleDietitianActive: vi.fn(),
}));

vi.mock("@/actions/master-actions/adminActions", () => ({
  createAdminUser: vi.fn(),
  updateAdminUser: vi.fn(),
  deleteAdminUser: vi.fn(),
  toggleAdminActive: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Components under test (imported after mocks are registered).
// ---------------------------------------------------------------------------

import { ShopProductsDestinationSelector } from "@/shared/components/admin/product-inventory/ShopProductsDestinationSelector";
import { ShopStockInDialog } from "@/shared/components/admin/product-inventory/ShopStockInDialog";
import { ShopStockInCart } from "@/shared/components/admin/product-inventory/ShopStockInCart";
import { ClinicLedgerView } from "@/shared/components/admin/product-inventory/ClinicLedgerView";
import UserManagement from "@/shared/components/master/UserManagement";
import { useInventoryStore } from "@/shared/stores/useInventoryStore";
import { getDestinationOptionsAction } from "@/actions/admin-actions/clinicShopInventoryActions";
import { listClinicsForDietitianAssignment } from "@/actions/master-actions/dietitianActions";
import type { ClinicLedgerEntry } from "@/types/clinicShop";

// ---------------------------------------------------------------------------
// axe helper (mirrors src/test/a11y/onboarding-a11y.test.tsx exactly)
// ---------------------------------------------------------------------------

const DOCUMENT_SCOPED_RULES: Record<string, { enabled: false }> = {
  "html-has-lang": { enabled: false },
  "landmark-one-main": { enabled: false },
  "page-has-heading-one": { enabled: false },
  region: { enabled: false },
  bypass: { enabled: false },
  "document-title": { enabled: false },
  "color-contrast": { enabled: false },
};

const AXE_OPTIONS: RunOptions = {
  resultTypes: ["violations"],
  rules: DOCUMENT_SCOPED_RULES,
};

const SERIOUS_OR_CRITICAL = new Set(["serious", "critical"]);

async function expectNoSeriousViolations(
  target: Document | Element = document.body,
): Promise<Result[]> {
  const results = await axe.run(target, AXE_OPTIONS);
  const blocking = results.violations.filter((v) =>
    SERIOUS_OR_CRITICAL.has(v.impact ?? ""),
  );
  if (blocking.length > 0) {
    const summary = blocking
      .map(
        (v) =>
          `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s):\n` +
          v.nodes
            .map((n) => `    ${n.target.join(" ")}\n    HTML: ${n.html}`)
            .join("\n"),
      )
      .join("\n");
    throw new Error(`Serious/critical accessibility violations found:\n${summary}`);
  }
  return blocking;
}

beforeEach(() => {
  vi.clearAllMocks();
  useInventoryStore.getState().clearShopStockInCart();
  mockSearchParams.forEach((_v, k) => mockSearchParams.delete(k));
});

// ---------------------------------------------------------------------------
// 1. Destination Selector (Task 7.4, Req 5.1)
// ---------------------------------------------------------------------------

describe("Accessibility (mechanical subset) — Destination Selector", () => {
  it("loaded state (clinics + franchises) has no serious/critical violations", async () => {
    vi.mocked(getDestinationOptionsAction).mockResolvedValue({
      success: true,
      data: {
        clinics: [{ id: "clinic-1", name: "Jubilee Hills Clinic" }],
        franchises: [{ id: "franchise-1", name: "North Zone Franchise" }],
      },
    });

    render(<ShopProductsDestinationSelector />);

    // Wait for the loading state to resolve into the labeled trigger.
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: /shop products destination/i }),
      ).toBeInTheDocument(),
    );

    await expectNoSeriousViolations();
  });

  it("load-failure state has no serious/critical violations", async () => {
    vi.mocked(getDestinationOptionsAction).mockResolvedValue({
      success: false,
      error: "The destination list could not be loaded.",
    });

    render(<ShopProductsDestinationSelector />);

    await screen.findByText(/could not be loaded/i);

    await expectNoSeriousViolations();
  });
});

// ---------------------------------------------------------------------------
// 2. Stock In dialog (Task 7.7, Req 7.1, 7.5)
// ---------------------------------------------------------------------------

describe("Accessibility (mechanical subset) — Stock In dialog", () => {
  const LINKED_PRODUCT = {
    id: "product-1",
    name: "Ashwagandha Capsules",
    inventory_product_id: "inv-product-1",
  };

  it("open dialog (quantity input + actions rendered) has no serious/critical violations", async () => {
    const user = userEvent.setup();

    render(<ShopStockInDialog product={LINKED_PRODUCT} clinicId="clinic-1" />);

    await user.click(screen.getByRole("button", { name: /stock in/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText(/quantity/i)).toBeInTheDocument();

    await expectNoSeriousViolations();
  });

  it("open dialog with an invalid quantity entered (error message shown) has no serious/critical violations", async () => {
    const user = userEvent.setup();

    render(<ShopStockInDialog product={LINKED_PRODUCT} clinicId="clinic-1" />);

    await user.click(screen.getByRole("button", { name: /stock in/i }));
    await screen.findByRole("dialog");

    fireEvent.change(screen.getByLabelText(/quantity/i), {
      target: { value: "0" },
    });

    await screen.findByText(/quantity must be a whole number/i);

    await expectNoSeriousViolations();
  });
});

// ---------------------------------------------------------------------------
// 3. Stock-in cart (Task 7.7, Req 7.1)
// ---------------------------------------------------------------------------

describe("Accessibility (mechanical subset) — Stock-in cart", () => {
  it("empty-cart state has no serious/critical violations", async () => {
    const user = userEvent.setup();

    render(<ShopStockInCart />);

    await user.click(screen.getByRole("button", { name: /open stock-in cart/i }));

    await screen.findByText(/no stock-in lines pending/i);

    await expectNoSeriousViolations();
  });

  it("non-empty cart state (list + submit button) has no serious/critical violations", async () => {
    const user = userEvent.setup();

    useInventoryStore.getState().addShopStockInLine({
      clinicId: "clinic-1",
      productId: "product-1",
      name: "Ashwagandha Capsules",
      qty: 10,
    });

    render(<ShopStockInCart />);

    await user.click(screen.getByRole("button", { name: /open stock-in cart/i }));

    expect(await screen.findByText("Ashwagandha Capsules")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /submit stock in/i }),
    ).toBeInTheDocument();

    await expectNoSeriousViolations();
  });
});

// ---------------------------------------------------------------------------
// 4. Clinic ledger table (Task 10.2, Req 9.6)
// ---------------------------------------------------------------------------

describe("Accessibility (mechanical subset) — Clinic ledger table", () => {
  const SAMPLE_ENTRIES: ClinicLedgerEntry[] = [
    {
      id: "1",
      clinic_id: "clinic-1",
      product_id: "product-1",
      product_name: "Ashwagandha Capsules",
      direction: "IN",
      quantity: 25,
      movement_source: "WAREHOUSE_STOCK_IN",
      actor_user_id: "user-1",
      actor_name: "Admin One",
      addon_order_id: null,
      inventory_transaction_id: "txn-1",
      occurred_at: "2024-01-15T09:30:00.000Z",
    },
    {
      id: "2",
      clinic_id: "clinic-1",
      product_id: "product-1",
      product_name: "Ashwagandha Capsules",
      direction: "OUT",
      quantity: 3,
      movement_source: "WALKIN_SALE",
      actor_user_id: "user-2",
      actor_name: "Front Desk",
      addon_order_id: "order-1",
      inventory_transaction_id: null,
      occurred_at: "2024-01-16T11:00:00.000Z",
    },
  ];

  it("non-empty entries (table + section switcher) has no serious/critical violations", async () => {
    render(<ClinicLedgerView entries={SAMPLE_ENTRIES} />);

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();

    await expectNoSeriousViolations();
  });

  it("empty entries (no recorded stock movements state) has no serious/critical violations", async () => {
    render(<ClinicLedgerView entries={[]} />);

    expect(screen.getByText(/no recorded stock movements/i)).toBeInTheDocument();

    await expectNoSeriousViolations();
  });
});

// ---------------------------------------------------------------------------
// 5. Clinic Access checkbox with its dependent dropdown (Task 6.6,
//    Requirements 13.2, 13.4) — part of the Master Admin User_Management_Form
//    (src/shared/components/master/UserManagement.tsx).
// ---------------------------------------------------------------------------

describe("Accessibility (mechanical subset) — Clinic Access checkbox + dependent dropdown", () => {
  it("checked state (dependent Core Clinic dropdown rendered) has no serious/critical violations", async () => {
    const user = userEvent.setup();

    vi.mocked(listClinicsForDietitianAssignment).mockResolvedValue({
      success: true,
      data: [
        {
          id: "clinic-1",
          name: "Jubilee Hills Clinic",
          franchiseId: null,
          franchiseName: null,
        },
      ],
    });

    render(<UserManagement initialAdmins={[]} />);

    // Open the "Create New Admin" dialog.
    await user.click(screen.getByRole("button", { name: /add admin/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();

    // Switch Access Level to "Operations" so the Clinic Access checkbox is
    // presented (Req 13.3).
    await user.click(
      screen.getByRole("combobox", { name: /access level/i }),
    );
    await user.click(
      await screen.findByRole("option", { name: "Operations only" }),
    );

    // Check the "This user has clinic level access" checkbox — this reveals
    // the dependent Core Clinic dropdown (Req 13.2, 13.4).
    const clinicAccessCheckbox = await screen.findByRole("checkbox", {
      name: /this user has clinic level access/i,
    });
    await user.click(clinicAccessCheckbox);

    await waitFor(() =>
      expect(clinicAccessCheckbox).toHaveAttribute("aria-checked", "true"),
    );

    // The dependent Clinic dropdown is now rendered.
    const clinicDropdown = await screen.findByRole("combobox", {
      name: /clinic/i,
    });
    expect(clinicDropdown).toBeInTheDocument();

    // Scope the axe check to the Clinic Access checkbox + its dependent
    // dropdown (the interesting a11y surface named by this task), rather
    // than the whole User_Management_Form dialog — the wider dialog also
    // renders the pre-existing (out-of-scope for this task) per-group
    // OperationsGroupConfig permission selects once "Operations" is chosen,
    // which are not part of the Clinic Access checkbox / dropdown surface.
    const clinicAccessSection = clinicAccessCheckbox
      .closest("label")
      ?.closest("div");
    expect(clinicAccessSection).not.toBeNull();

    await expectNoSeriousViolations(clinicAccessSection as Element);
  });
});

