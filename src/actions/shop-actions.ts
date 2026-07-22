"use server";

import crypto from "crypto";
import Razorpay from "razorpay";
import { createClient } from "@/lib/supabase/server";
import {
  fetchProductForCheckout,
  isProductUnavailable,
} from "@/lib/products/catalog-queries";
import { calculateShopOrderBreakdown } from "@/lib/pricing/inclusive-tax";
import { CartItem } from "@/types/product";
import { notifyAdmins, sendNotificationToUser, buildPushPayload } from "@/lib/notifications";
import {
  getCustomerNameByProfileId,
} from "@/lib/notifications/lookups";
import { getISTDateString } from "@/lib/dates/ist";
import {
  evaluateFranchiseStockOutcome,
  UNFULFILLABLE_STOCK_STATUS,
  type ItemDecrementResult,
} from "@/lib/shop/franchiseStockFailsafe";

const razorpay = new Razorpay({
  key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

export async function processStandaloneCheckout(items: CartItem[]) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    const { data: dbUser, error: dbUserError } = await supabase
      .from("users")
      .select("id")
      .eq("auth_user_id", user.id)
      .single();

    if (dbUserError || !dbUser) {
      throw new Error("User not found.");
    }

    const { data: profile, error: profileError } = await supabase
      .from("customer_profiles")
      .select("id, franchise_id")
      .eq("user_id", dbUser.id)
      .single();

    if (profileError || !profile) {
      throw new Error("Customer profile not found.");
    }

    const customer_profile_id = profile.id;
    const customerFranchiseId: string | null = profile.franchise_id ?? null;

    const { data: activeSubscription, error: subscriptionError } =
      await supabase
        .from("subscriptions")
        .select("id")
        .eq("customer_profile_id", customer_profile_id)
        .eq("status", "ACTIVE")
        .limit(1)
        .maybeSingle();

    if (subscriptionError || !activeSubscription) {
      throw new Error(
        "You must have an active meal subscription to purchase add-ons.",
      );
    }

    const today = getISTDateString(0);
    const { data: nextActiveDay, error: preferenceError } = await supabase
      .from("subscription_daily_preferences")
      .select("preference_date")
      .eq("customer_profile_id", customer_profile_id)
      .eq("is_paused", false)
      .gt("preference_date", today)
      .order("preference_date", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (preferenceError || !nextActiveDay) {
      throw new Error("No upcoming active delivery days found.");
    }

    const verifiedItems: Array<{
      product_id: string;
      quantity: number;
      unit_price: number;
      line_total: number;
    }> = [];

    let true_total = 0;

    for (const item of items) {
      const { data: product, error: productError } =
        await fetchProductForCheckout(supabase, item.id);

      if (isProductUnavailable(product, productError)) {
        throw new Error("Product is no longer available.");
      }

      if (customerFranchiseId) {
        const { data: setting } = await supabase
          .from("franchise_product_settings")
          .select("stock_quantity, is_visible")
          .eq("franchise_id", customerFranchiseId)
          .eq("product_id", item.id)
          .maybeSingle();

        if (!setting || !setting.is_visible) {
          throw new Error("One of your items is not available in your area.");
        }
        if ((setting.stock_quantity ?? 0) < item.quantity) {
          throw new Error("Not enough stock available for one of your items.");
        }
      }

      const unitPrice = product!.sale_price ?? product!.original_price;
      const lineTotal = unitPrice * item.quantity;
      true_total += lineTotal;

      verifiedItems.push({
        product_id: product!.id,
        quantity: item.quantity,
        unit_price: unitPrice,
        line_total: lineTotal,
      });
    }

    const { data: addon_order, error: addonOrderError } = await supabase
      .from("addon_orders")
      .insert({
        customer_profile_id,
        franchise_id: customerFranchiseId,
        total_amount: true_total,
        target_delivery_date: nextActiveDay.preference_date,
        status: "PENDING",
      })
      .select("id")
      .single();

    if (addonOrderError || !addon_order) {
      throw new Error("Failed to initialize add-on order.");
    }

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .insert({
        customer_profile_id,
        payment_method: "RAZORPAY",
        amount: true_total,
        status: "PENDING",
      })
      .select("id")
      .single();

    if (paymentError || !payment) {
      throw new Error("Failed to create pending payment.");
    }

    const { error: addonOrderPaymentLinkError } = await supabase
      .from("addon_orders")
      .update({ payment_id: payment.id })
      .eq("id", addon_order.id);

    if (addonOrderPaymentLinkError) {
      throw new Error("Failed to link payment with add-on order.");
    }

    // IMPORTANT: Only insert columns that actually exist in the DB schema.
    // DO NOT include computed fields like `line_total`.
    const orderItemsData = verifiedItems.map((item) => ({
      addon_order_id: addon_order.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
    }));

    const { error: addonOrderItemsError } = await supabase
      .from("addon_order_items")
      .insert(orderItemsData);

    if (addonOrderItemsError) {
      throw new Error("Failed to create add-on order items.");
    }

    const amountInPaisa = Math.round(true_total * 100);

    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaisa,
      currency: "INR",
      receipt: `rcpt_${payment.id}`.substring(0, 40),
      notes: { payment_id: payment.id, checkout_type: "ADDON" },
    });

    return {
      success: true,
      orderId: addon_order.id,
      totalAmount: true_total,
      razorpayOrderId: razorpayOrder.id,
      paymentId: payment.id,
      razorpayKey: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to process standalone checkout.",
    };
  }
}

export async function createAddonCheckoutOrder(
  items: CartItem[],
  couponCode?: string,
) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    const { data: dbUser, error: dbUserError } = await supabase
      .from("users")
      .select("id, full_name")
      .eq("auth_user_id", user.id)
      .single();

    if (dbUserError || !dbUser) {
      throw new Error("User not found.");
    }

    const { data: profile, error: profileError } = await supabase
      .from("customer_profiles")
      .select("id, franchise_id")
      .eq("user_id", dbUser.id)
      .single();

    if (profileError || !profile) {
      throw new Error("Customer profile not found.");
    }

    const customer_profile_id = profile.id;
    const customerFranchiseId: string | null = profile.franchise_id ?? null;

    const { data: activeSubscription, error: subscriptionError } =
      await supabase
        .from("subscriptions")
        .select("id")
        .eq("customer_profile_id", customer_profile_id)
        .eq("status", "ACTIVE")
        .limit(1)
        .maybeSingle();

    if (subscriptionError || !activeSubscription) {
      throw new Error(
        "You must have an active meal subscription to purchase add-ons.",
      );
    }

    const today = getISTDateString(0);
    const { data: nextActiveDay, error: preferenceError } = await supabase
      .from("subscription_daily_preferences")
      .select("preference_date")
      .eq("customer_profile_id", customer_profile_id)
      .eq("is_paused", false)
      .gt("preference_date", today)
      .order("preference_date", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (preferenceError || !nextActiveDay) {
      throw new Error("No upcoming active delivery days found.");
    }

    const { data: primaryAddress, error: primaryAddressError } = await supabase
      .from("addresses")
      .select("*")
      .eq("customer_profile_id", customer_profile_id)
      .eq("is_primary", true)
      .limit(1)
      .maybeSingle();

    if (primaryAddressError) {
      throw new Error("Failed to fetch billing address.");
    }

    const verifiedItems: Array<{
      product_id: string;
      quantity: number;
      unit_price: number;
      line_total: number;
    }> = [];

    const orderLines: Array<{ gross: number; taxPercent: number }> = [];

    for (const item of items) {
      const { data: product, error: productError } =
        await fetchProductForCheckout(supabase, item.id);

      if (isProductUnavailable(product, productError)) {
        throw new Error("Product is no longer available.");
      }

      // Franchise customers buy against their franchise's stock + visibility.
      if (customerFranchiseId) {
        const { data: setting } = await supabase
          .from("franchise_product_settings")
          .select("stock_quantity, is_visible")
          .eq("franchise_id", customerFranchiseId)
          .eq("product_id", item.id)
          .maybeSingle();

        if (!setting || !setting.is_visible) {
          throw new Error("One of your items is not available in your area.");
        }
        if ((setting.stock_quantity ?? 0) < item.quantity) {
          throw new Error(
            "Not enough stock available for one of your items.",
          );
        }
      }

      const unitPrice = product!.sale_price ?? product!.original_price;
      const lineTotal = unitPrice * item.quantity;

      orderLines.push({
        gross: lineTotal,
        taxPercent: Number(product!.tax_percent ?? 0),
      });

      verifiedItems.push({
        product_id: product!.id,
        quantity: item.quantity,
        unit_price: unitPrice,
        line_total: lineTotal,
      });
    }

    let appliedCouponCode: string | null = null;
    let couponDiscount: {
      type: "PERCENTAGE" | "FLAT";
      value: number;
    } | null = null;

    if (couponCode?.trim()) {
      const normalizedCouponCode = couponCode.trim().toUpperCase();

      const { data: coupon, error: couponError } = await supabase
        .from("coupons")
        .select("*")
        .eq("code", normalizedCouponCode)
        .eq("customer_profile_id", customer_profile_id)
        .single();

      if (couponError || !coupon) {
        throw new Error("Invalid coupon code.");
      }

      if (
        typeof coupon.max_uses === "number" &&
        typeof coupon.times_used === "number" &&
        coupon.times_used >= coupon.max_uses
      ) {
        throw new Error("This coupon usage limit has been reached.");
      }

      if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
        throw new Error("This coupon has expired.");
      }

      if (
        coupon.discount_type === "PERCENTAGE" ||
        coupon.discount_type === "FLAT"
      ) {
        couponDiscount = {
          type: coupon.discount_type,
          value: Number(coupon.discount_value ?? 0),
        };
      }

      appliedCouponCode = normalizedCouponCode;
    }

    const breakdown = calculateShopOrderBreakdown(
      orderLines,
      couponDiscount ?? undefined,
    );
    const total = breakdown.total;

    const { data: addon_order, error: addonOrderError } = await supabase
      .from("addon_orders")
      .insert({
        customer_profile_id,
        franchise_id: customerFranchiseId,
        total_amount: total,
        target_delivery_date: nextActiveDay.preference_date,
        status: "PENDING",
      })
      .select("id")
      .single();

    if (addonOrderError || !addon_order) {
      console.error("SUPABASE ORDER INSERT ERROR:", addonOrderError);
      return {
        success: false,
        error: `Database Error: ${addonOrderError.message}`,
      };
    }

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .insert({
        customer_profile_id,
        payment_method: "RAZORPAY",
        amount: total,
        status: "PENDING",
        subscription_id: null,
        base_amount: breakdown.baseSubtotal,
        tax_percent:
          breakdown.displayTaxPercent ??
          breakdown.effectiveTaxPercent ??
          0,
        tax_amount: breakdown.tax,
        discount_amount: breakdown.discount,
        invoice_type: "ADDON",
      })
      .select("id")
      .single();

    if (paymentError || !payment) {
      console.error("SUPABASE PAYMENT INSERT ERROR:", paymentError);
      return {
        success: false,
        error: `Database Error: ${paymentError.message}`,
      };
    }

    const { error: addonOrderPaymentLinkError } = await supabase
      .from("addon_orders")
      .update({ payment_id: payment.id })
      .eq("id", addon_order.id);

    if (addonOrderPaymentLinkError) {
      throw new Error("Failed to link payment with add-on order.");
    }

    // IMPORTANT: Only insert columns that actually exist in the DB schema.
    // DO NOT include computed fields like `line_total`.
    const orderItemsData = verifiedItems.map((item) => ({
      addon_order_id: addon_order.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
    }));

    const { error: addonOrderItemsError } = await supabase
      .from("addon_order_items")
      .insert(orderItemsData);

    if (addonOrderItemsError) {
      console.error("SUPABASE ITEMS INSERT ERROR:", addonOrderItemsError);
      return {
        success: false,
        error: `Database Error: ${addonOrderItemsError.message}`,
      };
    }

    // Razorpay strictly requires an integer amount in paisa.
    const grandTotal = total;
    const amountInPaisa = Math.round(grandTotal * 100);

    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaisa,
      currency: "INR",
      receipt: `rcpt_${payment.id}`.substring(0, 40),
      notes: { payment_id: payment.id, checkout_type: "ADDON" },
    });

    return {
      success: true,
      orderId: addon_order.id,
      paymentId: payment.id,
      razorpayOrderId: razorpayOrder.id,
      razorpayKey:
        process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID,
      billingDetails: {
        full_name: dbUser.full_name,
        address: primaryAddress,
      },
      breakdown: {
        grossSubtotal: breakdown.grossSubtotal,
        subtotal: breakdown.baseSubtotal,
        discount: breakdown.discount,
        gst: breakdown.tax,
        total: breakdown.total,
      },
      appliedCouponCode,
    };
  } catch (error) {
    console.error("FINAL CHECKOUT FLOW ERROR:", error);
    return {
      success: false,
      error: `Checkout Error: ${
        error instanceof Error ? error.message : JSON.stringify(error)
      }`,
    };
  }
}

export async function validateCouponCode(code: string) {
  try {
    const supabase = await createClient();
    const cleanCode = code.trim();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    const { data: dbUser, error: dbUserError } = await supabase
      .from("users")
      .select("id")
      .eq("auth_user_id", user.id)
      .single();

    if (dbUserError || !dbUser) {
      throw new Error("User not found.");
    }

    const { data: profile, error: profileError } = await supabase
      .from("customer_profiles")
      .select("id")
      .eq("user_id", dbUser.id)
      .single();

    if (profileError || !profile) {
      throw new Error("Customer profile not found.");
    }

    const customer_profile_id = profile.id;

    const { data: coupon, error: couponError } = await supabase
      .from("coupons")
      .select("discount_type, discount_value, expires_at, times_used, max_uses")
      .ilike("code", cleanCode)
      .eq("customer_profile_id", customer_profile_id)
      .maybeSingle();


    if (couponError || !coupon) {
      return { success: false, error: "Invalid coupon code" };
    }

    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return { success: false, error: "Coupon expired" };
    }

    if (
      typeof coupon.times_used === "number" &&
      typeof coupon.max_uses === "number" &&
      coupon.times_used >= coupon.max_uses
    ) {
      return { success: false, error: "Coupon usage limit reached" };
    }

    return {
      success: true,
      discountType: coupon.discount_type,
      discountValue: parseFloat(coupon.discount_value),
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to validate coupon",
    };
  }
}

export async function updateAddonOrderDeliveryDate(
  addonOrderId: string,
  newDeliveryDate: string,
) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) throw new Error("Unauthorized");

    const { data: order, error: fetchError } = await supabase
      .from("addon_orders")
      .select("id, status, delivery_order_id")
      .eq("id", addonOrderId)
      .single();

    if (fetchError || !order) throw new Error("Order not found.");
    if (order.status !== "PAID")
      throw new Error("Only paid orders can be rescheduled.");
    if (order.delivery_order_id)
      throw new Error(
        "This order has already been scheduled for delivery and cannot be changed.",
      );

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    if (newDeliveryDate < tomorrowStr)
      throw new Error("Delivery date must be tomorrow or later.");

    const { error: updateError } = await supabase
      .from("addon_orders")
      .update({ target_delivery_date: newDeliveryDate })
      .eq("id", addonOrderId);

    if (updateError) throw new Error(updateError.message);

    const { revalidatePath } = await import("next/cache");
    revalidatePath("/shop/orders");

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to update delivery date.",
    };
  }
}

// Reconciliation path for the Android app-switch case: if the Checkout.js
// `handler` callback never fires (WebView backgrounded/killed during a UPI
// app-switch), the client calls this once it resumes. It asks Razorpay's API
// directly (server-to-server) whether the order was actually paid, instead of
// trusting a client-supplied signature.
export async function checkAndReconcileAddonPaymentAction(
  paymentId: string,
  razorpayOrderId: string,
) {
  try {
    const supabase = await createClient();

    const { data: existingTx } = await supabase
      .from("razorpay_transactions")
      .select("id")
      .eq("razorpay_order_id", razorpayOrderId)
      .maybeSingle();

    if (existingTx) {
      return { success: true, alreadyProcessed: true };
    }

    const payments = await razorpay.orders.fetchPayments(razorpayOrderId);
    const capturedPayment = payments.items?.find(
      (p: any) => p.status === "captured" || p.status === "authorized",
    );

    if (!capturedPayment) {
      return { success: false, pending: true, error: "Payment not yet captured" };
    }

    return verifyAddonPayment(paymentId, {
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: capturedPayment.id,
      razorpay_signature: "server-verified-via-razorpay-api",
    });
  } catch (error) {
    console.error("Reconcile Addon Payment Error:", error);
    return { success: false, error: "Failed to reconcile payment status." };
  }
}

export async function verifyAddonPayment(
  paymentId: string,
  razorpayResponse: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  },
) {
  try {
    const supabase = await createClient();
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      razorpayResponse;

    // "server-verified-via-razorpay-api" marks calls arriving from
    // checkAndReconcileAddonPaymentAction, which already confirmed the
    // payment directly against Razorpay's API (server-to-server) — there is
    // no client-supplied signature to check in that path.
    if (razorpay_signature !== "server-verified-via-razorpay-api") {
      const body = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
        .update(body)
        .digest("hex");

      if (expectedSignature !== razorpay_signature) {
        throw new Error("Invalid payment signature.");
      }
    }

    // STRICT SEQUENCE (fail-fast):
    // 1) Signature verification (above)
    // 2) Insert into `razorpay_transactions`
    const { error: rzpTxError } = await supabase
      .from("razorpay_transactions")
      .insert({
        payment_id: paymentId,
        razorpay_order_id: razorpayResponse.razorpay_order_id,
        razorpay_payment_id: razorpayResponse.razorpay_payment_id,
        razorpay_signature: razorpayResponse.razorpay_signature,
        gateway_status: "SUCCESS", // Schema requires this NOT NULL field
      });

    if (rzpTxError) throw new Error(`Razorpay TX Error: ${rzpTxError.message}`);

    // 3) Update `payments` to PAID
    const { error: paymentUpdateError } = await supabase
      .from("payments")
      .update({
        status: "PAID",
        paid_at: new Date().toISOString(),
      })
      .eq("id", paymentId);

    if (paymentUpdateError)
      throw new Error(`Payment Update Error: ${paymentUpdateError.message}`);

    // 4) Update `addon_orders` to PAID (by `payment_id`)
    const { error: addonOrderUpdateError } = await supabase
      .from("addon_orders")
      .update({ status: "PAID" })
      .eq("payment_id", paymentId);

    if (addonOrderUpdateError)
      throw new Error(
        `Addon Order Update Error: ${addonOrderUpdateError.message}`,
      );

    // Franchise orders: deduct from the FRANCHISE's stock (never core stock).
    // Core orders (franchise_id null) keep their existing behaviour (no decrement).
    const { data: paidOrder } = await supabase
      .from("addon_orders")
      .select("id, franchise_id, addon_order_items(product_id, quantity)")
      .eq("payment_id", paymentId)
      .maybeSingle();

    // Defect #6 fix (Property 6 / Req 2.7): the `decrement_franchise_product_stock`
    // RPC is the source of atomicity — it returns `false` (without decrementing)
    // when franchise stock is insufficient (e.g. a concurrent sale). Honor that
    // `false`/error result at the flow level instead of swallowing it: any item
    // that could not be decremented makes the order unfulfillable, so we flag it
    // for ops review / refund and alert admins rather than leaving it silently
    // PAID with unavailable stock (oversell).
    let unfulfillableProductIds: string[] = [];

    if (paidOrder?.franchise_id) {
      const orderItems = (paidOrder.addon_order_items ?? []) as Array<{
        product_id: string;
        quantity: number;
      }>;

      const decrementResults: ItemDecrementResult[] = [];

      for (const orderItem of orderItems) {
        const { data: decremented, error: decError } = await supabase.rpc(
          "decrement_franchise_product_stock",
          {
            p_franchise_id: paidOrder.franchise_id,
            p_product_id: orderItem.product_id,
            p_quantity: orderItem.quantity,
          },
        );

        const ok = !decError && decremented !== false;

        if (!ok) {
          // Stock could not be reduced (e.g. concurrent sale). Keep logging for
          // ops visibility; the order-level decision below stops it from being
          // silently completed.
          console.error(
            "Franchise stock decrement issue:",
            decError?.message ?? "insufficient stock",
            { product_id: orderItem.product_id },
          );
        }

        decrementResults.push({
          product_id: orderItem.product_id,
          quantity: orderItem.quantity,
          decremented: ok,
        });
      }

      const outcome = evaluateFranchiseStockOutcome(decrementResults);
      unfulfillableProductIds = outcome.unfulfillableProductIds;

      if (!outcome.fulfillable) {
        // Flag the order as unfulfillable for the franchise so ops can review /
        // refund. Scoped by payment_id (this order only). We deliberately keep
        // `status = PAID` (the customer WAS charged) and use a dedicated
        // `fulfillment_status` marker so the condition is explicit and never
        // silent.
        const { error: flagError } = await supabase
          .from("addon_orders")
          .update({ fulfillment_status: UNFULFILLABLE_STOCK_STATUS })
          .eq("payment_id", paymentId);

        if (flagError) {
          console.error(
            "Failed to flag franchise order as unfulfillable:",
            flagError.message,
            { payment_id: paymentId },
          );
        }

        // Surface the oversell condition to admins for refund / manual handling.
        const oversellTitle = "Franchise stock oversell — action needed";
        const oversellMessage = `A franchise shop order (payment ${paymentId}) was paid but stock could not be reserved for ${unfulfillableProductIds.length} item(s). Review for refund or restock.`;

        await notifyAdmins({
          title: oversellTitle,
          message: oversellMessage,
          actionUrl: "/admin/customers",
          sendEmail: false,
          ...buildPushPayload(
            oversellTitle,
            oversellMessage,
            `franchise-oversell-${paymentId}`,
          ),
        });
      }
    }

    const { data: payment } = await supabase
      .from("payments")
      .select("customer_profile_id")
      .eq("id", paymentId)
      .maybeSingle();

    let productName = "product";
    let customerName = "Customer";

    if (payment?.customer_profile_id) {
      customerName = await getCustomerNameByProfileId(payment.customer_profile_id);

      const { data: addonOrders } = await supabase
        .from("addon_orders")
        .select("addon_order_items(products(name))")
        .eq("payment_id", paymentId)
        .limit(1);

      const items = addonOrders?.[0]?.addon_order_items;
      const firstItem = Array.isArray(items) ? items[0] : items;
      const product = Array.isArray(firstItem?.products)
        ? firstItem.products[0]
        : firstItem?.products;
      if (product?.name) {
        productName = product.name;
      }

      const { data: customerProfile } = await supabase
        .from("customer_profiles")
        .select("user_id")
        .eq("id", payment.customer_profile_id)
        .maybeSingle();

      if (customerProfile?.user_id) {
        const customerTitle = "Product purchase confirmed!";
        const customerMessage = `You have purchased product ${productName}, its scheduled for the delivery along with upcoming meals delivery.`;

        await sendNotificationToUser(customerProfile.user_id, {
          title: customerTitle,
          message: customerMessage,
          actionUrl: "/customer/meals",
          sendEmail: false,
          ...buildPushPayload(
            customerTitle,
            customerMessage,
            `product-purchase-${paymentId}`,
          ),
        });
      }
    }

    const adminTitle = "Product purchase confirmed!";
    const adminMessage = `Hi Admin, Customer ${customerName} has purchased the product ${productName}.`;

    await notifyAdmins({
      title: adminTitle,
      message: adminMessage,
      actionUrl: "/admin/customers",
      sendEmail: false,
      ...buildPushPayload(adminTitle, adminMessage, `product-purchase-admin-${paymentId}`),
    });

    // Payment is verified (customer was charged), but if any franchise item
    // could not be stocked we report it as unfulfillable so callers can inform
    // the customer / trigger a refund rather than treating this as a clean sale.
    if (unfulfillableProductIds.length > 0) {
      return {
        success: true,
        unfulfillable: true,
        unfulfillableProductIds,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to verify add-on payment.",
    };
  }
}
