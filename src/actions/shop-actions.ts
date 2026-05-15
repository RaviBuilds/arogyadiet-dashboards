"use server";

import crypto from "crypto";
import Razorpay from "razorpay";
import { createClient } from "@/lib/supabase/server";
import { CartItem } from "@/types/product";

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
      .select("id")
      .eq("user_id", dbUser.id)
      .single();

    if (profileError || !profile) {
      throw new Error("Customer profile not found.");
    }

    const customer_profile_id = profile.id;

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

    const today = new Date().toISOString().split("T")[0];
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
      const { data: product, error: productError } = await supabase
        .from("products")
        .select("id, original_price, sale_price")
        .eq("id", item.id)
        .single();

      if (productError || !product) {
        throw new Error(`Invalid product in cart: ${item.id}`);
      }

      const unitPrice = product.sale_price ?? product.original_price;
      const lineTotal = unitPrice * item.quantity;
      true_total += lineTotal;

      verifiedItems.push({
        product_id: product.id,
        quantity: item.quantity,
        unit_price: unitPrice,
        line_total: lineTotal,
      });
    }

    const { data: addon_order, error: addonOrderError } = await supabase
      .from("addon_orders")
      .insert({
        customer_profile_id,
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
      .select("id")
      .eq("user_id", dbUser.id)
      .single();

    if (profileError || !profile) {
      throw new Error("Customer profile not found.");
    }

    const customer_profile_id = profile.id;

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

    const today = new Date().toISOString().split("T")[0];
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

    let subtotal = 0;

    for (const item of items) {
      const { data: product, error: productError } = await supabase
        .from("products")
        .select("id, original_price, sale_price")
        .eq("id", item.id)
        .single();

      if (productError || !product) {
        throw new Error(`Invalid product in cart: ${item.id}`);
      }

      const unitPrice = product.sale_price ?? product.original_price;
      const lineTotal = unitPrice * item.quantity;
      subtotal += lineTotal;

      verifiedItems.push({
        product_id: product.id,
        quantity: item.quantity,
        unit_price: unitPrice,
        line_total: lineTotal,
      });
    }

    let discount = 0;
    let appliedCouponCode: string | null = null;

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

      if (coupon.discount_type === "PERCENTAGE") {
        discount = (subtotal * Number(coupon.discount_value ?? 0)) / 100;
      } else if (coupon.discount_type === "FLAT") {
        discount = Number(coupon.discount_value ?? 0);
      }

      discount = Math.max(0, Math.min(discount, subtotal));
      appliedCouponCode = normalizedCouponCode;
    }

    const taxableAmount = Math.max(0, subtotal - discount);
    const gst = taxableAmount * 0.05;
    const total = taxableAmount + gst;

    const { data: addon_order, error: addonOrderError } = await supabase
      .from("addon_orders")
      .insert({
        customer_profile_id,
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
        subtotal,
        discount,
        gst,
        total,
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

    console.log("Fetched Coupon:", coupon);

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

export async function verifyAddonPayment(
  paymentId: string,
  razorpayResponse: any,
) {
  try {
    const supabase = await createClient();
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      razorpayResponse;

    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return { success: false, error: "Invalid payment signature." };
    }

    const { error: paymentUpdateError } = await supabase
      .from("payments")
      .update({
        status: "PAID",
        paid_at: new Date().toISOString(),
      })
      .eq("id", paymentId);

    if (paymentUpdateError) {
      throw new Error("Failed to update payment status.");
    }

    const { error: addonOrderUpdateError } = await supabase
      .from("addon_orders")
      .update({ status: "PAID" })
      .eq("payment_id", paymentId);

    if (addonOrderUpdateError) {
      throw new Error("Failed to update add-on order status.");
    }

    const { error: transactionError } = await supabase
      .from("razorpay_transactions")
      .insert({
        payment_id: paymentId,
        razorpay_order_id: razorpayResponse.razorpay_order_id,
        razorpay_payment_id: razorpayResponse.razorpay_payment_id,
        razorpay_signature: razorpayResponse.razorpay_signature,
        gateway_status: "SUCCESS", // Crucial: Schema requires this NOT NULL field
      });

    if (transactionError) {
      // We log this but DO NOT throw, because the customer's payment actually succeeded
      // and we don't want to break the frontend success redirect over an audit log failure.
      console.error(
        "Critical Audit Error: Failed to insert razorpay_transaction record:",
        transactionError.message,
      );
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
