// src/services/ShopReceiptService.ts
//
// Assembles and renders the Shop Sale Receipt PDF for one shop order
// (`addon_orders`). Follows `KitReportService`: gather the data with the
// service-role client, then `renderToBuffer` under a timeout, returning a
// Buffer. Authorization belongs to the Route Handler that calls this — this
// module never reads a session or `next/headers`.

import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import React from "react";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  ShopReceiptDocument,
  type ShopReceiptData,
  type ShopReceiptLine,
} from "@/services/ShopReceiptTemplate";

/** Raised for an expected failure the route maps to a status code. */
export class ShopReceiptError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "ShopReceiptError";
    this.status = status;
  }
}

/** Hard ceiling on PDF rendering, mirroring the report services. */
const RENDER_TIMEOUT_MS = 30_000;

/**
 * Short, human-facing receipt reference derived from the order UUID. Matches
 * the `#635E8F` short code the All Shop Orders table already displays, so the
 * receipt and the ledger row are cross-referenceable by eye.
 *
 * NOT a GST invoice number: it is derived, not sequential, and carries no
 * per-issuer series. See the template header.
 */
export function receiptNumberFor(orderId: string): string {
  return orderId.replace(/-/g, "").slice(0, 6).toUpperCase();
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Build the receipt PDF for `orderId`.
 *
 * @throws ShopReceiptError 404 when the order does not exist.
 */
export async function generateShopReceipt(orderId: string): Promise<Buffer> {
  const data = await assembleReceiptData(orderId);
  return renderPdf(data);
}

/** Reads the order, its items, buyer, clinic and payment into template data. */
export async function assembleReceiptData(
  orderId: string,
): Promise<ShopReceiptData> {
  const supabase = createAdminClient();

  const { data: order, error } = await supabase
    .from("addon_orders")
    .select(
      `
      id,
      created_at,
      customer_profile_id,
      total_amount,
      status,
      fulfillment_status,
      walkin_name,
      walkin_mobile,
      walkin_address,
      clinic_id,
      payment_id,
      placed_by_user_id
    `,
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    throw new ShopReceiptError(
      `Failed to load the order: ${error.message}`,
      500,
    );
  }
  if (!order) {
    throw new ShopReceiptError("Order not found.", 404);
  }

  // Line items, joined to the product for name + SKU.
  const { data: itemRows, error: itemsError } = await supabase
    .from("addon_order_items")
    .select("quantity, unit_price, products ( name, sku )")
    .eq("addon_order_id", orderId);

  if (itemsError) {
    throw new ShopReceiptError(
      `Failed to load the order items: ${itemsError.message}`,
      500,
    );
  }

  const lines: ShopReceiptLine[] = (itemRows ?? []).map((row) => {
    const joined = row.products as
      | { name?: string; sku?: string | null }
      | { name?: string; sku?: string | null }[]
      | null;
    const product = Array.isArray(joined) ? joined[0] : joined;
    const quantity = toNumber(row.quantity);
    const unitPrice = toNumber(row.unit_price);

    return {
      productName: product?.name ?? "Shop product",
      sku: product?.sku ?? null,
      quantity,
      unitPrice,
      lineTotal: quantity * unitPrice,
    };
  });

  // Money. `payments` carries the authoritative tax/discount/delivery split
  // when a payment row exists; otherwise fall back to the order total and
  // derive the subtotal from the lines so the receipt still balances.
  let taxAmount = 0;
  let taxPercent: number | null = null;
  let discountAmount = 0;
  let deliveryCharge = 0;
  let paymentMethod: string | null = null;
  let paymentStatus: string | null = null;
  let baseAmount: number | null = null;

  if (order.payment_id) {
    const { data: payment } = await supabase
      .from("payments")
      .select(
        "base_amount, tax_percent, tax_amount, discount_amount, delivery_charge, payment_method, status",
      )
      .eq("id", order.payment_id)
      .maybeSingle();

    if (payment) {
      baseAmount =
        payment.base_amount === null ? null : toNumber(payment.base_amount);
      taxAmount = toNumber(payment.tax_amount);
      taxPercent =
        payment.tax_percent === null ? null : toNumber(payment.tax_percent);
      discountAmount = toNumber(payment.discount_amount);
      deliveryCharge = toNumber(payment.delivery_charge);
      paymentMethod = payment.payment_method ?? null;
      paymentStatus = payment.status ?? null;
    }
  }

  const lineSum = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const total = toNumber(order.total_amount, lineSum);
  // Prefer the payment's recorded base; fall back to the line sum.
  const subtotal = baseAmount ?? lineSum;

  // Buyer: a walk-in carries its details on the order itself; a subscriber is
  // resolved through customer_profiles -> users.
  let buyerName = order.walkin_name ?? "Customer";
  let buyerMobile = order.walkin_mobile ?? null;
  const buyerAddress = order.walkin_address ?? null;
  const isWalkIn = Boolean(order.walkin_name);

  if (!isWalkIn && order.customer_profile_id) {
    const { data: profile } = await supabase
      .from("customer_profiles")
      .select("users ( full_name, mobile )")
      .eq("id", order.customer_profile_id)
      .maybeSingle();

    const joinedUser = profile?.users as
      | { full_name?: string; mobile?: string | null }
      | { full_name?: string; mobile?: string | null }[]
      | null;
    const user = Array.isArray(joinedUser) ? joinedUser[0] : joinedUser;

    if (user?.full_name) buyerName = user.full_name;
    if (user?.mobile) buyerMobile = user.mobile;
  }

  // Issuing clinic (the Order_Clinic_Stamp).
  let clinicName: string | null = null;
  if (order.clinic_id) {
    const { data: clinic } = await supabase
      .from("clinics")
      .select("name")
      .eq("id", order.clinic_id)
      .maybeSingle();
    clinicName = clinic?.name ?? null;
  }

  // Staff member who recorded the sale, when it was admin-placed.
  let soldBy: string | null = null;
  if (order.placed_by_user_id) {
    const { data: staff } = await supabase
      .from("users")
      .select("full_name")
      .eq("id", order.placed_by_user_id)
      .maybeSingle();
    soldBy = staff?.full_name ?? null;
  }

  return {
    receiptNumber: receiptNumberFor(order.id),
    orderId: order.id,
    issuedAt: order.created_at,
    clinicName,
    buyerName,
    buyerMobile,
    buyerAddress,
    isWalkIn,
    lines,
    subtotal,
    taxAmount,
    taxPercent,
    discountAmount,
    deliveryCharge,
    total,
    paymentMethod,
    paymentStatus: paymentStatus ?? order.status ?? null,
    fulfillmentStatus: order.fulfillment_status ?? null,
    soldBy,
  };
}

async function renderPdf(data: ShopReceiptData): Promise<Buffer> {
  const element = React.createElement(ShopReceiptDocument, {
    data,
  }) as React.ReactElement<DocumentProps>;

  const buffer = await Promise.race([
    renderToBuffer(element),
    new Promise<never>((_resolve, reject) =>
      setTimeout(
        () => reject(new ShopReceiptError("Receipt generation timed out.", 504)),
        RENDER_TIMEOUT_MS,
      ),
    ),
  ]);

  return Buffer.from(buffer);
}
