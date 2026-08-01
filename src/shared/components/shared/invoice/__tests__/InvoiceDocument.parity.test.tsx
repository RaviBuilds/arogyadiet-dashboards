// @vitest-environment jsdom

// src/shared/components/shared/invoice/__tests__/InvoiceDocument.parity.test.tsx
//
// Task 8.7 — Invoice layout parity snapshot test.
//
// `InvoiceDocument` is the single, category-agnostic printable invoice
// renderer used for MEAL/KIT/ADDON invoices today and, per this feature, for
// the ACCOMMODATION_FINAL_INVOICE branch of `generateInvoiceData` as well.
// Task 8.1 already guarantees both branches produce the same `InvoiceData`
// shape at the type level. This test proves the reuse holds at the *render*
// level too: rendering `InvoiceDocument` with an accommodation final-invoice
// `InvoiceData` and with a Meal-subscription `InvoiceData` produces byte
// identical DOM structure and CSS classes everywhere except the text content
// that legitimately differs between categories (line item description,
// subscription code, amounts).
//
// This is a structural/DOM snapshot-style test, not a property-based test.
// The codebase has no existing `toMatchSnapshot()` convention (checked via
// grep before writing this), so parity is asserted explicitly via DOM
// structure comparison instead of introducing Vitest's snapshot files.
//
// Validates: Requirement 8.4 — "The Final_Consolidated_Invoice SHALL use the
// same layout and formatting conventions as existing Meal and KIT customer
// invoices."

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { InvoiceDocument } from "@/shared/components/shared/invoice/InvoiceDocument";
import type { InvoiceData } from "@/lib/invoices";

// ---------------------------------------------------------------------------
// Fixtures — ordinary, fully-populated InvoiceData values differing only in
// category-specific content (line item description/subtitle, subscription
// code, customer identity, amounts). Every other field is populated the same
// way (paymentMethod "Manual" with a reference + notes, a full address,
// isPending false, discountAmount 0) so no *conditional* DOM branch differs
// between the two — only the text nodes inside otherwise-identical elements
// differ.
// ---------------------------------------------------------------------------

const mealInvoiceData: InvoiceData = {
  paymentId: "pay_meal_001",
  invoiceNumber: "INV-MEAL-0001",
  date: "2024-01-15",
  status: "PAID",
  paymentMethod: "Manual",
  paymentReference: "TXN-MEAL-REF-001",
  paymentNotes: "Collected via UPI at the kitchen counter",
  customerName: "Asha Rao",
  customerEmail: "asha.rao@example.com",
  customerMobile: "9876543210",
  address: {
    street_1: "12 Park Lane",
    street_2: "Flat 4B",
    landmark: "Near Mall",
    city: "Hyderabad",
    state: "Telangana",
    pincode: "500084",
  },
  subscriptionCode: "SUB-MEAL-0001",
  lineItems: [
    {
      description: "ArogyaDiet 30 Days Standard Plan",
      subtitle: "01 Jan 2024 to 30 Jan 2024",
      amount: 8000,
    },
  ],
  pricing: {
    baseAmount: 8000,
    taxAmount: 1440,
    taxPercent: 18,
    discountAmount: 0,
    finalPrice: 8000,
    totalAmount: 9440,
  },
  isPending: false,
};

const accommodationFinalInvoiceData: InvoiceData = {
  paymentId: "pay_accom_001",
  invoiceNumber: "INV-ACCOM-0001",
  date: "2024-02-20",
  status: "PAID",
  paymentMethod: "Manual",
  paymentReference: "TXN-ACCOM-REF-001",
  paymentNotes: "Paid in cash at front desk on checkout",
  customerName: "Vikram Shah",
  customerEmail: "vikram.shah@example.com",
  customerMobile: "9123456780",
  address: {
    street_1: "45 MG Road",
    street_2: "Near Metro Station",
    landmark: "Opposite City Park",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560001",
  },
  subscriptionCode: "SUB-ACC-0001",
  lineItems: [
    {
      description: "Accommodation Stay — AC Villa (Single)",
      subtitle: "5 night(s): 2024-02-15 to 2024-02-20",
      amount: 20000,
    },
  ],
  pricing: {
    baseAmount: 20000,
    taxAmount: 3600,
    taxPercent: 18,
    discountAmount: 0,
    finalPrice: 20000,
    totalAmount: 23600,
  },
  isPending: false,
};

/**
 * Recursively reduces an Element to its tag name and `class` attribute,
 * discarding all text content. Two renders whose normalized trees are deeply
 * equal have identical layout/formatting — only their text content differs.
 */
function normalizeStructure(node: Element): unknown {
  return {
    tag: node.tagName,
    className: node.getAttribute("class") ?? "",
    children: Array.from(node.children).map((child) => normalizeStructure(child)),
  };
}

describe("InvoiceDocument — accommodation/Meal layout parity (Req 8.4)", () => {
  it("renders the same DOM structure and CSS classes for an accommodation final invoice as for a Meal invoice", () => {
    const { container: mealContainer } = render(
      <InvoiceDocument invoiceData={mealInvoiceData} autoPrint={false} />,
    );
    const { container: accommodationContainer } = render(
      <InvoiceDocument
        invoiceData={accommodationFinalInvoiceData}
        autoPrint={false}
      />,
    );

    const mealRoot = mealContainer.firstElementChild;
    const accommodationRoot = accommodationContainer.firstElementChild;
    expect(mealRoot).not.toBeNull();
    expect(accommodationRoot).not.toBeNull();

    const mealStructure = normalizeStructure(mealRoot as Element);
    const accommodationStructure = normalizeStructure(accommodationRoot as Element);

    // The core parity assertion: stripping text content leaves byte-identical
    // markup — same tags, same nesting, same CSS classes, at every position.
    expect(accommodationStructure).toEqual(mealStructure);
  });

  it("renders exactly one line-item row for both a Meal invoice and an accommodation final invoice", () => {
    const { container: mealContainer } = render(
      <InvoiceDocument invoiceData={mealInvoiceData} autoPrint={false} />,
    );
    const { container: accommodationContainer } = render(
      <InvoiceDocument
        invoiceData={accommodationFinalInvoiceData}
        autoPrint={false}
      />,
    );

    expect(mealContainer.querySelectorAll("table tbody tr")).toHaveLength(1);
    expect(accommodationContainer.querySelectorAll("table tbody tr")).toHaveLength(1);
  });

  it("shows the same labeled sections and pricing row labels for both categories", () => {
    const { container: mealContainer } = render(
      <InvoiceDocument invoiceData={mealInvoiceData} autoPrint={false} />,
    );
    const { container: accommodationContainer } = render(
      <InvoiceDocument
        invoiceData={accommodationFinalInvoiceData}
        autoPrint={false}
      />,
    );

    for (const container of [mealContainer, accommodationContainer]) {
      const text = container.textContent ?? "";

      // Billed To section header.
      expect(text).toContain("Billed To");

      // Neither fixture's line item description contains "Add-on", so both
      // must show the non-Add-on "Subscription Details" label rather than
      // the ADDON branch's special-cased "Order Details" text.
      expect(text).toContain("Subscription Details");
      expect(text).not.toContain("Order Details");

      // Pricing row labels — identical regardless of category.
      expect(text).toContain("Base Price");
      expect(text).toContain("GST (18%)");
      // isPending is false for both fixtures, so the label is "Total Paid"
      // rather than "Amount Due".
      expect(text).toContain("Total Paid");

      // Shared footer text.
      expect(text).toContain(
        "Thank you for prioritizing your health with ArogyaDiet!",
      );
    }
  });
});
