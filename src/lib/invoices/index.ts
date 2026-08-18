/**
 * Invoice Generation Library
 * 
 * Provides unified invoice generation logic with category-based branching
 * for MEAL, KIT, and ADDON subscriptions.
 * 
 * Requirements: 10.1, 10.2, 10.3
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { addDaysToISODate } from "@/lib/dates/ist";
import {
  resolveInvoicePaymentState,
  type InvoicePaymentState,
} from "@/types/subscriptionPayment";
import { reconstructPreDiscountPricing } from "@/lib/onboarding/discount";

/**
 * Invoice line item representation
 */
export interface InvoiceLineItem {
  description: string;
  subtitle: string;
  amount: number;
}

/**
 * Invoice pricing breakdown
 */
export interface InvoicePricing {
  /** Taxable value BEFORE any discount — the invoice's "Base Price" row. */
  baseAmount: number;
  /** GST actually charged, on the taxable value AFTER any discount. */
  taxAmount: number;
  taxPercent: number;
  /**
   * The PRE-TAX portion of the discount — what "Discount Applied" shows, so that
   * `baseAmount - discountAmount = finalPrice` and GST below it is charged on the
   * reduced value.
   */
  discountAmount: number;
  /**
   * The TOTAL concession the admin granted and the customer was quoted, i.e.
   * `discountAmount + discountTaxRelief` (admin-manual-onboarding-discount).
   * 0 when no manual discount was applied, which is why the note that prints it
   * is gated on this rather than on `discountAmount`.
   */
  grossDiscount?: number;
  /** The GST portion of `grossDiscount`. */
  discountTaxRelief?: number;
  finalPrice: number;
  totalAmount: number;
  /**
   * Delivery charge folded into `totalAmount`. Shown as its own row so
   * base + GST + delivery + misc reconciles to the total. 0 when not charged.
   */
  deliveryCharge?: number;
  /**
   * Admin-entered miscellaneous charge folded into `totalAmount`. 0 when not
   * charged.
   */
  miscCharge?: number;
  /**
   * The admin-supplied NAME for `miscCharge` (e.g. "Additional product
   * charges"). This is what is rendered — never the word "Miscellaneous".
   */
  miscChargeLabel?: string | null;
  /**
   * Cash actually collected against this invoice so far
   * (meal-subscription-partial-payment). Equals `totalAmount` on a settled
   * invoice. 0 on legacy rows recorded before the columns existed, which is why
   * the partial-payment block is gated on this being > 0.
   */
  amountPaid?: number;
  /**
   * Still owed. 0 means settled — which is what makes this the FINAL invoice.
   * Derived label, never a stored `is_final_invoice` flag.
   */
  balanceDue?: number;
}

/**
 * Invoice data structure for rendering
 */
export interface InvoiceData {
  paymentId: string;
  invoiceNumber: string;
  date: string;
  status: string;
  paymentMethod: string;
  paymentReference?: string;
  paymentNotes?: string;
  customerName: string;
  customerEmail: string;
  customerMobile: string;
  address?: {
    street_1: string;
    street_2?: string;
    landmark?: string;
    city: string;
    state: string;
    pincode: string;
  };
  subscriptionCode?: string;
  lineItems: InvoiceLineItem[];
  pricing: InvoicePricing;
  isPending: boolean;
  /**
   * Three-state payment position (meal-subscription-partial-payment).
   *
   * `isPending` alone cannot express this: a legacy PENDING invoice has
   * `balance_due = 0`, so testing `balanceDue <= 0` would stamp "FULLY PAID" on
   * an unpaid invoice. Derived from `payments.status` first, with `balance_due`
   * used only for the figures. `isPending` is retained for backwards
   * compatibility and stays exactly equivalent to `paymentState === "PENDING"`.
   */
  paymentState: InvoicePaymentState;
}

/**
 * Fetch and construct invoice data for a given payment ID
 * Handles MEAL, KIT, and ADDON categories with appropriate branching
 */
export async function generateInvoiceData(
  paymentId: string
): Promise<InvoiceData | null> {
  const supabaseAdmin = createAdminClient();

  // Fetch core payment + subscription + profile + (possibly) linked stay entry
  const { data: payment, error } = await supabaseAdmin
    .from("payments")
    .select(
      `
      *,
      subscriptions (
        subscription_code,
        total_days,
        customer_category,
        kit_product_id,
        kit_duration_days,
        subscription_plans ( price, base_price ),
        kit_products ( name, base_price, tax_rate )
      ),
      customer_profiles (
        user_id,
        users!customer_profiles_user_id_fkey ( full_name, email, mobile ),
        addresses ( street_1, street_2, landmark, city, state, pincode, is_primary )
      ),
      stay_entries!payments_stay_entry_id_fkey (
        stay_type,
        occupancy_type,
        start_date,
        total_nights,
        payment_amount,
        base_amount,
        tax_amount,
        tax_percentage,
        recalculation_applied
      )
    `
    )
    .eq("id", paymentId)
    .single();

  if (error || !payment) {
    console.error("Error fetching invoice data:", error);
    return null;
  }

  const profile = payment.customer_profiles;
  const sub = payment.subscriptions;
  const customerUser = profile?.users;

  // ─── ACCOMMODATION_FINAL_INVOICE branch (Req 8.3, 8.4, 8.5) ──────────────
  // Checked before the addon/KIT/MEAL branching so no addon_orders lookup or
  // subscription-based branching runs for a stay's final invoice, and no
  // stay_payment_transactions ledger detail is ever fetched or rendered.
  if (payment.invoice_type === "ACCOMMODATION_FINAL_INVOICE") {
    const stay = payment.stay_entries;

    if (!stay) {
      console.error(
        `Accommodation final invoice ${paymentId} has no linked stay_entries row`
      );
      return null;
    }

    // Req 8.3, 8.4: the figures always come from the CURRENT live columns —
    // Save_Stay_Details / Recalculate_Stay is repeatable, so a cached
    // `actual_nights_stayed` snapshot can go stale between invocations.
    // `recalculation_applied` is read for PRESENTATION only (labelling the
    // line item as recalculated), never for selecting between values.
    const nightsForInvoice = Number(stay.total_nights);
    const totalForInvoice = Number(payment.amount);
    const endDateForInvoice = addDaysToISODate(
      stay.start_date,
      nightsForInvoice - 1
    );

    const accBaseAmount = Number(stay.base_amount);
    const accTaxAmountCalc = Number(stay.tax_amount);
    const accTaxPercentCalc = Number(stay.tax_percentage);
    const accDiscountAmount = 0;

    const accSubtitle = stay.recalculation_applied
      ? `${nightsForInvoice} night(s) (recalculated): ${stay.start_date} to ${endDateForInvoice}`
      : `${nightsForInvoice} night(s): ${stay.start_date} to ${endDateForInvoice}`;

    const accLineItems: InvoiceLineItem[] = [
      {
        description: `Accommodation Stay — ${stay.stay_type} (${stay.occupancy_type})`,
        subtitle: accSubtitle,
        amount: accBaseAmount,
      },
    ];

    const accFinalPrice = accBaseAmount - accDiscountAmount;
    const accTotalAmount = totalForInvoice;

    const accIsManual = payment.payment_method === "MANUAL";
    const accMethodLabel = accIsManual ? "Manual" : payment.payment_method;
    const accIsPending = payment.status === "PENDING";

    const accPrimaryAddress =
      profile?.addresses?.find((a: any) => a.is_primary) ||
      profile?.addresses?.[0];

    return {
      paymentId: payment.id,
      invoiceNumber: `INV-${payment.id.split("-")[0].toUpperCase()}`,
      date: payment.created_at,
      status: payment.status,
      paymentMethod: accMethodLabel,
      paymentReference: payment.payment_reference,
      paymentNotes: payment.payment_notes,
      customerName: customerUser?.full_name || "N/A",
      customerEmail: customerUser?.email || "",
      customerMobile: customerUser?.mobile || "",
      address: accPrimaryAddress
        ? {
            street_1: accPrimaryAddress.street_1,
            street_2: accPrimaryAddress.street_2,
            landmark: accPrimaryAddress.landmark,
            city: accPrimaryAddress.city,
            state: accPrimaryAddress.state,
            pincode: accPrimaryAddress.pincode,
          }
        : undefined,
      subscriptionCode: sub?.subscription_code,
      lineItems: accLineItems,
      pricing: {
        baseAmount: accBaseAmount,
        taxAmount: accTaxAmountCalc,
        taxPercent: accTaxPercentCalc,
        discountAmount: accDiscountAmount,
        finalPrice: accFinalPrice,
        totalAmount: accTotalAmount,
      },
      isPending: accIsPending,
      // Accommodation keeps its own balance in `stay_payment_transactions`, not
      // in the meal columns, so the meal balance is deliberately passed as 0.
      // A PAID stay invoice therefore resolves to "PAID" and renders exactly as
      // it did before this feature.
      paymentState: resolveInvoicePaymentState(payment.status, 0),
    };
  }

  // ─── ACCOMMODATION_REFUND_INVOICE branch (Req 14.7) ──────────────────────
  // A second branch beside the final-invoice one above, checked in the same
  // early block before any addon_orders lookup or ADDON/KIT/MEAL branching.
  // A Refund_Invoice documents ONE REFUND `stay_payment_transactions` row —
  // never the stay's totals, running balance, or any other transaction — so
  // it is fetched by `payment.stay_payment_transaction_id` rather than
  // derived from `stay.payment_amount` / the GST breakup used above.
  // `payment.stay_entries` is already populated here: `record_stay_refund_
  // with_invoice()` writes `stay_entry_id` on the Refund_Invoice row itself,
  // so the same embed used by the final-invoice branch also resolves
  // `stay_type` / `occupancy_type` for this branch — no extra join needed for
  // that part.
  if (payment.invoice_type === "ACCOMMODATION_REFUND_INVOICE") {
    const stay = payment.stay_entries;

    if (!stay) {
      console.error(
        `Accommodation refund invoice ${paymentId} has no linked stay_entries row`
      );
      return null;
    }

    if (!payment.stay_payment_transaction_id) {
      console.error(
        `Accommodation refund invoice ${paymentId} has no linked stay_payment_transaction_id`
      );
      return null;
    }

    // Straightforward second lookup keyed by the FK on `payment`, rather than
    // an embed on the main query above: `payments` and
    // `stay_payment_transactions` are linked by TWO distinct FKs
    // (`payments.stay_payment_transaction_id` → this row, and
    // `stay_payment_transactions.refund_invoice_payment_id` → back to the
    // invoice), so a plain second query avoids any relationship-embed
    // ambiguity.
    const { data: refundTx, error: refundTxError } = await supabaseAdmin
      .from("stay_payment_transactions")
      .select("transaction_type, amount, transaction_date, comment, remark")
      .eq("id", payment.stay_payment_transaction_id)
      .single();

    if (refundTxError || !refundTx) {
      console.error(
        `Error fetching linked REFUND transaction for invoice ${paymentId}:`,
        refundTxError
      );
      return null;
    }

    // Flat-amount document: the line item and every pricing figure come from
    // the transaction's own amount, not from `payment.amount`/`stay.*` — the
    // two happen to be equal by construction (record_stay_refund_with_invoice
    // inserts both rows with the same amount in one transaction), but reading
    // the transaction directly keeps this branch honest about its source of
    // truth per Req 14.7.
    const refundAmount = Number(refundTx.amount);

    const refundLineItems: InvoiceLineItem[] = [
      {
        description: `Accommodation Stay Refund — ${stay.stay_type} (${stay.occupancy_type})`,
        subtitle: `Refund dated ${refundTx.transaction_date} · ${refundTx.remark}`,
        amount: refundAmount,
      },
    ];

    const refundIsManual = payment.payment_method === "MANUAL";
    const refundMethodLabel = refundIsManual
      ? "Manual"
      : payment.payment_method;
    const refundIsPending = payment.status === "PENDING";

    const refundPrimaryAddress =
      profile?.addresses?.find((a: any) => a.is_primary) ||
      profile?.addresses?.[0];

    return {
      paymentId: payment.id,
      // Visibly distinct from the final invoice's `INV-…` (Req 14.7 design
      // note) so the two documents are never confused.
      invoiceNumber: `RFND-${payment.id.split("-")[0].toUpperCase()}`,
      date: payment.created_at,
      status: payment.status,
      paymentMethod: refundMethodLabel,
      paymentReference: payment.payment_reference,
      paymentNotes: payment.payment_notes,
      customerName: customerUser?.full_name || "N/A",
      customerEmail: customerUser?.email || "",
      customerMobile: customerUser?.mobile || "",
      address: refundPrimaryAddress
        ? {
            street_1: refundPrimaryAddress.street_1,
            street_2: refundPrimaryAddress.street_2,
            landmark: refundPrimaryAddress.landmark,
            city: refundPrimaryAddress.city,
            state: refundPrimaryAddress.state,
            pincode: refundPrimaryAddress.pincode,
          }
        : undefined,
      subscriptionCode: sub?.subscription_code,
      lineItems: refundLineItems,
      // A flat-amount document: no base/GST breakup exists for a single
      // REFUND transaction, so base = final = total = the transaction's own
      // amount and tax/discount are 0. The existing GST columns are carried
      // through unchanged (all zero) so the shared InvoiceDocument renderer
      // still lays out identically for layout parity, per the design note —
      // it just prints ₹0.00 rows instead of hiding them.
      pricing: {
        baseAmount: refundAmount,
        taxAmount: 0,
        taxPercent: 0,
        discountAmount: 0,
        finalPrice: refundAmount,
        totalAmount: refundAmount,
      },
      isPending: refundIsPending,
      // See the note on the final-invoice branch above.
      paymentState: resolveInvoicePaymentState(payment.status, 0),
    };
  }

  // Check for add-on order separately (only reached for non-accommodation invoices)
  const { data: addonOrder } = await supabaseAdmin
    .from("addon_orders")
    .select("id, total_amount, target_delivery_date, status")
    .eq("payment_id", paymentId)
    .maybeSingle();

  // Requirement 10.4: Validate payment status for KIT orders
  // KIT invoices can only be generated for PAID orders
  if (sub?.customer_category === "KIT" && payment.status !== "PAID") {
    console.error(
      `Cannot generate invoice for unpaid KIT order. Payment ID: ${paymentId}, Status: ${payment.status}`
    );
    return null;
  }

  const primaryAddress =
    profile?.addresses?.find((a: any) => a.is_primary) ||
    profile?.addresses?.[0];

  // ─── Determine line items based on category ─────────────────────────────
  const lineItems: InvoiceLineItem[] = [];
  let baseAmount: number;
  let taxAmountCalc: number;
  let taxPercentCalc: number;
  let discountAmount: number;

  // Whether `discountAmount` follows the admin-manual-onboarding-discount
  // convention: a GROSS concession, with base_amount / tax_amount stored NET of
  // it. Only subscription invoices written by onboard_customer use that
  // convention.
  //
  // It matters because this file has TWO incompatible conventions. The legacy
  // MEAL fallback below infers a discount as `planPrice - priceBeforeTax` and
  // sets baseAmount to the PRE-discount price, which is also what
  // InvoiceDocument's "Base Price → Discount → Price After Discount" rows expect.
  // Add-on orders have their own. Flagging the new convention lets it be
  // converted into the one the component already renders, without touching how
  // any existing row displays.
  let paymentDiscountIsGross = false;

  if (addonOrder) {
    // ADDON ORDER
    const totalAmount = Number(payment.amount);
    
    if (payment.base_amount != null && payment.tax_amount != null) {
      baseAmount = Number(payment.base_amount);
      taxAmountCalc = Number(payment.tax_amount);
      taxPercentCalc = Number(payment.tax_percent ?? 5);
      discountAmount = Number(payment.discount_amount ?? 0);
    } else {
      const priceBeforeTax = totalAmount / 1.05;
      taxAmountCalc = totalAmount - priceBeforeTax;
      taxPercentCalc = 5;
      discountAmount = 0;
      baseAmount = priceBeforeTax;
    }

    lineItems.push({
      description: "ArogyaDiet Add-on Purchase",
      subtitle: "Includes add-on items purchased from the shop.",
      amount: baseAmount,
    });
  } else if (sub?.customer_category === "KIT" && sub?.kit_products) {
    // KIT SUBSCRIPTION
    const kitProduct = sub.kit_products;

    // Prefer the figures RECORDED ON THE PAYMENT, exactly as the MEAL branch
    // does, and fall back to deriving them from the product only for rows that
    // predate those columns being populated.
    //
    // The old code derived tax FORWARD off `kit_products.base_price`
    // (`base * tax_rate`) while treating that same base_price as the taxable
    // value. But base_price is stored tax-INCLUSIVE — resolveKitProductPricing
    // and the onboarding wizard both reverse it out — so a Rs.28,080 kit invoiced
    // Rs.28,080 rendered as base Rs.28,080 + GST Rs.1,404, which does not
    // reconcile against the total. Reading the payment columns fixes that AND is
    // what makes a KIT discount renderable at all, since the concession only
    // exists on the payment row.
    if (payment.base_amount != null && payment.tax_amount != null) {
      baseAmount = Number(payment.base_amount);
      taxAmountCalc = Number(payment.tax_amount);
      taxPercentCalc = Number(
        payment.tax_percent ?? Number(kitProduct.tax_rate ?? 0.05) * 100,
      );
      discountAmount = Number(payment.discount_amount ?? 0);
      paymentDiscountIsGross = true;
    } else {
      const taxRate = Number(kitProduct.tax_rate ?? 0.05);
      const inclusivePrice = Number(kitProduct.base_price);
      baseAmount = inclusivePrice / (1 + taxRate);
      taxAmountCalc = inclusivePrice - baseAmount;
      taxPercentCalc = taxRate * 100;
      discountAmount = 0;
    }

    lineItems.push({
      description: `${kitProduct.name} - ${sub.kit_duration_days} Days`,
      subtitle: `Ready-to-eat meal package delivered to your address.`,
      amount: baseAmount,
    });
  } else {
    // MEAL SUBSCRIPTION (default/legacy)
    const totalAmount = Number(payment.amount);
    
    if (payment.base_amount != null && payment.tax_amount != null) {
      baseAmount = Number(payment.base_amount);
      taxAmountCalc = Number(payment.tax_amount);
      taxPercentCalc = Number(payment.tax_percent ?? 5);
      discountAmount = Number(payment.discount_amount ?? 0);
      paymentDiscountIsGross = true;
    } else {
      const priceBeforeTax = totalAmount / 1.05;
      taxAmountCalc = totalAmount - priceBeforeTax;
      taxPercentCalc = 5;
      discountAmount = 0;

      const planPrice = sub?.subscription_plans?.price
        ? Number(sub.subscription_plans.price)
        : priceBeforeTax;
      discountAmount = Math.max(0, planPrice - priceBeforeTax);
      baseAmount = planPrice;
    }

    lineItems.push({
      description: `ArogyaDiet ${sub?.total_days} Days Standard Plan`,
      subtitle:
        "Includes daily meal delivery, pause credits, and dynamic address routing.",
      amount: baseAmount,
    });
  }

  // ─── Manual discount: convert to the rendering convention ────────────────
  // admin-manual-onboarding-discount stores the GROSS concession the admin typed
  // (e.g. Rs.2,000) with base_amount / tax_amount already NET of it. But GST is
  // only correct if the discount is shown BEFORE tax, so the invoice renders:
  //
  //   Base Price              <- taxable value BEFORE the discount
  //   Discount Applied        <- the pre-tax PORTION of the concession
  //   Price After Discount    <- taxable value after (== stored base_amount)
  //   GST                     <- stored tax_amount, charged on the reduced value
  //
  // which reconciles to payment.amount and states the tax actually collected.
  // `grossDiscount` and `discountTaxRelief` are carried through so the document
  // can also print the single figure the customer was quoted, since Rs.2,000
  // splits into roughly Rs.1,904.77 of charges plus Rs.95.23 of GST relief.
  let grossDiscount = 0;
  let discountTaxRelief = 0;

  if (paymentDiscountIsGross && discountAmount > 0) {
    const reconstructed = reconstructPreDiscountPricing(
      baseAmount,
      taxAmountCalc,
      discountAmount,
      taxPercentCalc,
    );

    grossDiscount = discountAmount;
    discountTaxRelief = reconstructed.taxRelief;
    baseAmount = reconstructed.originalTaxableAmount;
    discountAmount = reconstructed.baseRelief;

    // The subscription line item was pushed with the NET base by the branch
    // above; it must show the same "Base Price" the totals block does, or the
    // itemised list and the totals disagree on the same invoice.
    if (lineItems.length > 0) {
      lineItems[0].amount = baseAmount;
    }
  }

  // ─── Extra charges folded into payment.amount ───────────────────────────
  // Itemised so the invoice reconciles: base + GST + delivery + misc = total.
  // Both default to 0, so invoices recorded without them render exactly as
  // before (no empty rows).
  const deliveryChargeAmount = Number(payment.delivery_charge ?? 0) || 0;
  const miscChargeAmount = Number(payment.misc_charge ?? 0) || 0;
  const miscChargeLabel =
    typeof payment.misc_charge_label === "string" &&
    payment.misc_charge_label.trim() !== ""
      ? payment.misc_charge_label.trim()
      : null;

  if (deliveryChargeAmount > 0) {
    lineItems.push({
      description: "Delivery Charges",
      subtitle: `Distance-based delivery for the ${sub?.total_days ?? 0}-day subscription period.`,
      amount: deliveryChargeAmount,
    });
  }

  if (miscChargeAmount > 0) {
    lineItems.push({
      // The admin-supplied name is the description — never "Miscellaneous".
      description: miscChargeLabel ?? "Additional Charges",
      subtitle: "Additional charges applied at the time of onboarding.",
      amount: miscChargeAmount,
    });
  }

  const finalPrice = baseAmount - discountAmount;
  const totalAmount = Number(payment.amount);

  // Payment method label
  const isManual = payment.payment_method === "MANUAL";
  const methodLabel = isManual ? "Manual" : payment.payment_method;

  // Status-driven labels
  const isPending = payment.status === "PENDING";

  // ─── Payment position (meal-subscription-partial-payment) ────────────────
  // Both columns default to 0 in the DB, so an invoice recorded before this
  // feature reports amountPaid = 0 / balanceDue = 0 and — because the state is
  // resolved from `status` first — still renders exactly as it always did.
  const amountPaidAmount = Number(payment.amount_paid ?? 0) || 0;
  const balanceDueAmount = Number(payment.balance_due ?? 0) || 0;
  const paymentState = resolveInvoicePaymentState(
    payment.status,
    balanceDueAmount,
  );

  return {
    paymentId: payment.id,
    invoiceNumber: `INV-${payment.id.split("-")[0].toUpperCase()}`,
    date: payment.created_at,
    status: payment.status,
    paymentMethod: methodLabel,
    paymentReference: payment.payment_reference,
    paymentNotes: payment.payment_notes,
    customerName: customerUser?.full_name || "N/A",
    customerEmail: customerUser?.email || "",
    customerMobile: customerUser?.mobile || "",
    address: primaryAddress
      ? {
          street_1: primaryAddress.street_1,
          street_2: primaryAddress.street_2,
          landmark: primaryAddress.landmark,
          city: primaryAddress.city,
          state: primaryAddress.state,
          pincode: primaryAddress.pincode,
        }
      : undefined,
    subscriptionCode: sub?.subscription_code,
    lineItems,
    pricing: {
      baseAmount,
      taxAmount: taxAmountCalc,
      taxPercent: taxPercentCalc,
      discountAmount,
      grossDiscount,
      discountTaxRelief,
      finalPrice,
      totalAmount,
      deliveryCharge: deliveryChargeAmount,
      miscCharge: miscChargeAmount,
      miscChargeLabel,
      amountPaid: amountPaidAmount,
      balanceDue: balanceDueAmount,
    },
    isPending,
    paymentState,
  };
}

/**
 * Calculate tax amount for KIT product
 * Helper function for KIT invoice generation
 */
export function calculateKitTax(basePrice: number): number {
  return Number((basePrice * 0.05).toFixed(2));
}
