// Smoke test: the Sale Receipt template renders to a non-empty PDF buffer.
//
// Mirrors src/test/dietitian/smoke.test.ts ("a Report_Card PDF renders to a
// non-empty buffer"): it exercises the real @react-pdf/renderer pipeline with
// representative data, so a malformed style or an invalid element in
// ShopReceiptTemplate fails here rather than at download time. Data assembly
// (which needs a database) is deliberately not covered.

import { describe, expect, it } from "vitest";

import type { ShopReceiptData } from "@/services/ShopReceiptTemplate";

const WALK_IN_RECEIPT: ShopReceiptData = {
  receiptNumber: "635E8F",
  orderId: "36b57a0a-91e6-48b4-b7c0-109e86635e8f",
  issuedAt: "2026-08-08T10:44:56.745Z",
  clinicName: "Madhapur Clinic",
  buyerName: "Ravindra",
  buyerMobile: "8019443344",
  buyerAddress: "Rajamma Nilayam, Prashant Nagar",
  isWalkIn: true,
  lines: [
    {
      productName: "Test Product",
      sku: "ADT4512",
      quantity: 2,
      unitPrice: 350,
      lineTotal: 700,
    },
  ],
  subtotal: 593.22,
  taxAmount: 106.78,
  taxPercent: 18,
  discountAmount: 0,
  deliveryCharge: 0,
  total: 700,
  paymentMethod: "CASH",
  paymentStatus: "PAID",
  fulfillmentStatus: "CLINIC_PICKUP",
  soldBy: "Front-Desk Test",
};

describe("Smoke: Shop Sale Receipt PDF", () => {
  it("renders a walk-in receipt to a non-empty PDF buffer", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const React = await import("react");
    const { ShopReceiptDocument } = await import(
      "@/services/ShopReceiptTemplate"
    );

    const element = React.createElement(ShopReceiptDocument, {
      data: WALK_IN_RECEIPT,
    });
    const buffer = await renderToBuffer(element as never);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
    // A well-formed PDF always starts with the %PDF- magic bytes.
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30_000);

  it("renders with optional fields absent (no clinic, no mobile, no discount)", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const React = await import("react");
    const { ShopReceiptDocument } = await import(
      "@/services/ShopReceiptTemplate"
    );

    const minimal: ShopReceiptData = {
      ...WALK_IN_RECEIPT,
      clinicName: null,
      buyerMobile: null,
      buyerAddress: null,
      isWalkIn: false,
      taxAmount: 0,
      taxPercent: null,
      paymentMethod: null,
      paymentStatus: "PENDING",
      fulfillmentStatus: null,
      soldBy: null,
      lines: [
        {
          productName: "Ayur Punarjeeva Forte",
          sku: null,
          quantity: 1,
          unitPrice: 700,
          lineTotal: 700,
        },
      ],
    };

    const element = React.createElement(ShopReceiptDocument, { data: minimal });
    const buffer = await renderToBuffer(element as never);

    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30_000);
});
