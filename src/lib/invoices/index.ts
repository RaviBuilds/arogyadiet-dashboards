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
  baseAmount: number;
  taxAmount: number;
  taxPercent: number;
  discountAmount: number;
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
        actual_nights_stayed,
        early_checkout_applied
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

    const nightsForInvoice = stay.early_checkout_applied
      ? Number(stay.actual_nights_stayed)
      : Number(stay.total_nights);
    const endDateForInvoice = addDaysToISODate(
      stay.start_date,
      nightsForInvoice - 1
    );

    const accBaseAmount = Number(stay.base_amount);
    const accTaxAmountCalc = Number(stay.tax_amount);
    const accTaxPercentCalc = Number(stay.tax_percentage);
    const accDiscountAmount = 0;

    const accLineItems: InvoiceLineItem[] = [
      {
        description: `Accommodation Stay — ${stay.stay_type} (${stay.occupancy_type})`,
        subtitle: `${nightsForInvoice} night(s): ${stay.start_date} to ${endDateForInvoice}`,
        amount: accBaseAmount,
      },
    ];

    const accFinalPrice = accBaseAmount - accDiscountAmount;
    const accTotalAmount = Number(payment.amount);

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
    baseAmount = Number(kitProduct.base_price);
    taxAmountCalc = baseAmount * Number(kitProduct.tax_rate);
    taxPercentCalc = Number(kitProduct.tax_rate) * 100;
    discountAmount = 0;

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
      finalPrice,
      totalAmount,
      deliveryCharge: deliveryChargeAmount,
      miscCharge: miscChargeAmount,
      miscChargeLabel,
    },
    isPending,
  };
}

/**
 * Calculate tax amount for KIT product
 * Helper function for KIT invoice generation
 */
export function calculateKitTax(basePrice: number): number {
  return Number((basePrice * 0.05).toFixed(2));
}
