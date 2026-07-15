"use server";

import Razorpay from "razorpay";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js"; // Use server client in production
import { addDays, format, differenceInCalendarDays, parseISO } from "date-fns";
import { cascadePendingSubscriptionDates } from "@/actions/manageMealActions";
import { notifyAdmins, sendNotificationToUser } from "@/lib/notifications";
import { getCustomerNameByProfileId } from "@/lib/notifications/lookups";
import {
  applyCouponToBasePrice,
  resolveSubscriptionCoupon,
} from "@/lib/coupons/resolveSubscriptionCoupon";
import { computeForCustomer } from "@/services/DeliveryChargeService";
import { calculateTotalPayable } from "@/lib/delivery/deliveryCharge";
const razorpay = new Razorpay({
  key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// REAL SUPABASE VALIDATION
export async function validateCouponAction(
  code: string,
  customerProfileId: string,
  planId: string,
) {
  try {
    const { data: plan } = await supabaseAdmin
      .from("subscription_plans")
      .select("duration_days")
      .eq("id", planId)
      .maybeSingle();

    const resolved = await resolveSubscriptionCoupon(
      supabaseAdmin,
      code,
      customerProfileId,
      planId,
      plan?.duration_days,
    );

    if (!resolved.success) {
      return { success: false, error: resolved.error };
    }

    const { coupon, resolvedDiscountValue } = resolved.result;

    return {
      success: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        discount_type: coupon.discount_type,
        discount_value: resolvedDiscountValue,
      },
    };
  } catch (error) {
    console.error("Action Error:", error);
    return { success: false, error: "Failed to validate coupon." };
  }
}

// PREVIEW DELIVERY CHARGE (for customer checkout review step)
// No admin gate — this is called from the customer checkout UI to display
// the delivery charge before the customer proceeds to pay.
export async function previewDeliveryChargeAction(
  customerProfileId: string,
  planId: string,
) {
  try {
    const { data: plan } = await supabaseAdmin
      .from("subscription_plans")
      .select("duration_days")
      .eq("id", planId)
      .single();
    if (!plan) return { success: false as const, error: "Plan not found" };

    const outcome = await computeForCustomer(supabaseAdmin, {
      customerProfileId,
      planDays: plan.duration_days,
    });

    if (outcome.ok) {
      return {
        success: true as const,
        totalDeliveryCharge: outcome.totalDeliveryCharge,
        perDayCharge: outcome.perDayCharge,
        distanceKm: outcome.distanceKm,
        ratePerKm: outcome.ratePerKm,
      };
    } else {
      return {
        success: false as const,
        error: "Unable to compute delivery charge",
        deliveryChargeFailure: {
          reason: outcome.reason,
          ...(outcome.reason === "unresolved_clinic"
            ? { clinicResolution: outcome.clinicResolution }
            : {}),
        },
      };
    }
  } catch (error) {
    console.error("Preview Delivery Charge Error:", error);
    return { success: false as const, error: "Failed to compute delivery charge" };
  }
}

// SECURE ORDER CREATION
export async function createRazorpayOrderAction(
  planId: string,
  planDuration: number,
  couponCode?: string,
  customerProfileId?: string,
) {
  try {
    // 1. Fetch the exact base price from the database securely!
    const { data: plan } = await supabaseAdmin
      .from("subscription_plans")
      .select("*")
      .eq("id", planId)
      .single();
    if (!plan) throw new Error("Plan not found");

    const originalBasePrice = plan.base_price;
    const originalTaxAmount = plan.tax_amount;
    const gstRate =
      originalBasePrice > 0 ? originalTaxAmount / originalBasePrice : 0.05;

    let finalBasePrice = originalBasePrice;
    let hasValidCoupon = false;

    // 2. Securely apply discount on the server
    if (couponCode && customerProfileId) {
      const validation = await validateCouponAction(
        couponCode,
        customerProfileId,
        planId,
      );
      if (validation.success && validation.coupon) {
        if (validation.coupon.discount_type === "FLAT") {
          finalBasePrice -= validation.coupon.discount_value;
        } else if (validation.coupon.discount_type === "PERCENTAGE") {
          finalBasePrice -=
            (finalBasePrice * validation.coupon.discount_value) / 100;
        }
        finalBasePrice = Math.max(1, finalBasePrice); // Minimum 1 INR
        hasValidCoupon = true;
      }
    }

    // 3. Recalculate GST securely on the server using the dynamic rate
    const finalGst = hasValidCoupon
      ? finalBasePrice * gstRate
      : originalTaxAmount;
    const planAmountINR = finalBasePrice + finalGst;

    // 4. Compute delivery charge server-side (Req 9.1, 9.5, 9.6)
    let totalDeliveryCharge = 0;
    let deliveryChargeOutcome: Awaited<ReturnType<typeof computeForCustomer>> | null = null;

    if (customerProfileId) {
      deliveryChargeOutcome = await computeForCustomer(supabaseAdmin, {
        customerProfileId,
        planDays: plan.duration_days,
      });

      if (deliveryChargeOutcome.ok) {
        totalDeliveryCharge = deliveryChargeOutcome.totalDeliveryCharge;
      } else {
        // If delivery charge cannot be computed, refuse order creation (Req 9.7)
        return {
          success: false,
          error: "Unable to compute delivery charge",
          deliveryChargeFailure: {
            reason: deliveryChargeOutcome.reason,
            ...(deliveryChargeOutcome.reason === "unresolved_clinic"
              ? { clinicResolution: deliveryChargeOutcome.clinicResolution }
              : {}),
          },
        };
      }
    }

    // 5. Calculate Total_Payable = plan amount + delivery charge (Req 6.2)
    const totalAmountINR = calculateTotalPayable(planAmountINR, totalDeliveryCharge);

    const options = {
      amount: Math.round(totalAmountINR * 100), // Razorpay wants paisa
      currency: "INR",
      receipt: `rcpt_${Date.now()}`,
    };

    const order = await razorpay.orders.create({
      ...options,
      notes: { checkout_type: "SUBSCRIPTION" },
    });
    return {
      success: true,
      order,
      totalAmountINR,
      appliedBasePrice: finalBasePrice,
      appliedGst: finalGst,
      totalDeliveryCharge,
    };
  } catch (error) {
    console.error("Razorpay Order Error:", error);
    return { success: false, error: "Failed to create payment order" };
  }
}

// ACTIVATION & COUPON BURNING

export async function verifyAndActivateSubscriptionAction(
  paymentResponse: any,
  checkoutData: any,
  couponCode?: string,
) {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    paymentResponse;
  const body = razorpay_order_id + "|" + razorpay_payment_id;

  // Verify Razorpay Signature Cryptographically
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(body.toString())
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    return { success: false, error: "Invalid payment signature" };
  }

  return activateSubscription(
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    checkoutData,
    couponCode,
  );
}

// Reconciliation path for the Android app-switch case: if the Checkout.js
// `handler` callback never fires (WebView backgrounded/killed during a UPI
// app-switch), the client calls this once it resumes. Instead of trusting a
// client-supplied signature, it asks Razorpay's API directly (server-to-server,
// authenticated with our secret key) whether the order was actually paid.
export async function checkAndReconcileSubscriptionPaymentAction(
  razorpayOrderId: string,
  checkoutData: any,
  couponCode?: string,
) {
  try {
    // Skip if this order was already activated (avoids duplicate subscriptions
    // if the client's own `handler` callback also completes independently).
    const { data: existingTx } = await supabaseAdmin
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

    return activateSubscription(
      razorpayOrderId,
      capturedPayment.id,
      "server-verified-via-razorpay-api",
      checkoutData,
      couponCode,
    );
  } catch (error) {
    console.error("Reconcile Subscription Payment Error:", error);
    return { success: false, error: "Failed to reconcile payment status." };
  }
}

async function activateSubscription(
  razorpay_order_id: string,
  razorpay_payment_id: string,
  razorpay_signature: string,
  checkoutData: any,
  couponCode?: string,
) {
  try {
    // 1. Fetch required data
    const {
      planId,
      customerProfileId,
      startDate,
      foodType,
      pausedDates = [],
      mealOverrides = {},
      addressId,
      deliveryCharge: clientDeliveryCharge,
    } = checkoutData;

    const { data: plan } = await supabaseAdmin
      .from("subscription_plans")
      .select("*")
      .eq("id", planId)
      .single();
    if (!plan) throw new Error("Plan not found");

    // --- RECOMPUTE DELIVERY CHARGE SERVER-SIDE (Req 9.5, 9.6) ---
    let totalDeliveryCharge = 0;

    if (customerProfileId) {
      const deliveryOutcome = await computeForCustomer(supabaseAdmin, {
        customerProfileId,
        planDays: plan.duration_days,
      });

      if (deliveryOutcome.ok) {
        totalDeliveryCharge = deliveryOutcome.totalDeliveryCharge;
      } else {
        // If delivery charge cannot be computed, refuse subscription creation (Req 9.7, 6.5)
        return {
          success: false,
          error: "Unable to compute delivery charge for subscription activation.",
          deliveryChargeFailure: {
            reason: deliveryOutcome.reason,
            ...(deliveryOutcome.reason === "unresolved_clinic"
              ? { clinicResolution: deliveryOutcome.clinicResolution }
              : {}),
          },
        };
      }
    }

    // Reject any client-supplied delivery charge that differs from server-computed value (Req 9.6)
    if (
      clientDeliveryCharge !== undefined &&
      clientDeliveryCharge !== null &&
      Number(clientDeliveryCharge) !== totalDeliveryCharge
    ) {
      return {
        success: false,
        error: "Delivery charge mismatch. The server-computed delivery charge differs from the client-supplied value.",
      };
    }
    // -----------------------------------------------------------

    // --- RECALCULATE EXACT AMOUNT FOR ACCURATE INVOICING ---
    let finalBasePrice = plan.base_price;
    const originalTaxAmount = plan.tax_amount;
    const gstRate =
      finalBasePrice > 0 ? originalTaxAmount / finalBasePrice : 0.05;
    let hasValidCoupon = false;

    if (couponCode && customerProfileId) {
      const resolved = await resolveSubscriptionCoupon(
        supabaseAdmin,
        couponCode,
        customerProfileId,
        planId,
        plan.duration_days,
      );

      if (resolved.success) {
        const { coupon, resolvedDiscountValue } = resolved.result;
        finalBasePrice = applyCouponToBasePrice(
          finalBasePrice,
          coupon,
          resolvedDiscountValue,
        );
        hasValidCoupon = true;
      }
    }

    const finalGst = hasValidCoupon
      ? finalBasePrice * gstRate
      : originalTaxAmount;
    const planAmountINR = finalBasePrice + finalGst;

    // Total_Payable = plan amount + delivery charge (Req 6.2)
    const exactAmountPaid = calculateTotalPayable(planAmountINR, totalDeliveryCharge);
    // ------------------------------------------------------------

    // Map UI food types to DB meal_categories seed values
    const mealTypeMap: Record<string, string> = {
      Veg: "VEG",
      "Non-Veg": "CHICKEN",
      Egg: "EGG",
      Mixed: "MIXED",
    };

    const { data: categories } = await supabaseAdmin
      .from("meal_categories")
      .select("id, code");
    const getCategoryId = (uiType: string) => {
      const dbCode = mealTypeMap[uiType] || "VEG";
      return categories?.find((c) => c.code === dbCode)?.id || null;
    };

    // 3. Insert Payment Record (with full invoice breakdown)
    const { data: payment, error: paymentError } = await supabaseAdmin
      .from("payments")
      .insert({
        customer_profile_id: customerProfileId,
        payment_method: "RAZORPAY",
        amount: exactAmountPaid, // Total_Payable = plan + delivery (Req 6.2)
        status: "SUCCESS",
        paid_at: new Date().toISOString(),
        base_amount: finalBasePrice,
        tax_percent: gstRate * 100,
        tax_amount: finalGst,
        discount_amount: hasValidCoupon
          ? Math.max(0, plan.base_price - finalBasePrice)
          : 0,
        invoice_type: "SUBSCRIPTION",
        delivery_charge: totalDeliveryCharge, // Req 6.1, 6.3 — delivery tax is ₹0.00 (Req 6.4)
      })
      .select("id")
      .single();

    if (paymentError) throw paymentError;

    // 4. Calculate Subscription Dates
    const baseDuration = plan.duration_days;
    const pausesUsed = pausedDates.length;
    const start = new Date(startDate);
    const end = addDays(start, baseDuration - 1);
    const effectiveEnd = addDays(start, baseDuration + pausesUsed - 1);

    // Generate a readable subscription code
    const subCode = `SUB-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const { data: activeSubs } = await supabaseAdmin
      .from("subscriptions")
      .select("id, effective_end_on, ends_on")
      .eq("customer_profile_id", customerProfileId)
      .eq("status", "ACTIVE");

    const hasActive = (activeSubs?.length ?? 0) > 0;
    const subscriptionStatus = hasActive ? "PENDING" : "ACTIVE";

    // 5. Insert Subscription Record
    const { data: subscription, error: subError } = await supabaseAdmin
      .from("subscriptions")
      .insert({
        customer_profile_id: customerProfileId,
        plan_id: planId,
        subscription_code: subCode,
        starts_on: format(start, "yyyy-MM-dd"),
        ends_on: format(end, "yyyy-MM-dd"),
        effective_end_on: format(effectiveEnd, "yyyy-MM-dd"),
        status: subscriptionStatus,
        total_days: baseDuration,
        pause_credits_total: plan.pause_credits,
        pause_credits_used: pausesUsed,
        delivery_charge: totalDeliveryCharge, // Req 6.1 — persist delivery charge on subscription
      })
      .select("id")
      .single();

    if (subError) throw subError;

    if (hasActive && activeSubs) {
      const baseEnd = activeSubs.reduce((latest, s) => {
        const end = new Date(s.effective_end_on ?? s.ends_on!);
        return end > latest ? end : latest;
      }, new Date(0));
      await cascadePendingSubscriptionDates(customerProfileId, baseEnd);
    }

    // 6. Link Payment to Subscription
    const { error: paymentUpdateError } = await supabaseAdmin
      .from("payments")
      .update({ subscription_id: subscription.id })
      .eq("id", payment.id);

    if (paymentUpdateError) throw paymentUpdateError;

    // 7. Insert Razorpay Transaction Audit
    const { error: transactionError } = await supabaseAdmin
      .from("razorpay_transactions")
      .insert({
        payment_id: payment.id,
        razorpay_order_id: razorpay_order_id,
        razorpay_payment_id: razorpay_payment_id,
        razorpay_signature: razorpay_signature,
        gateway_status: "SUCCESS",
      });

    if (transactionError) throw transactionError;

    // 8. Generate Daily Preferences (Meal Planner & Paused Dates logic)
    let prefsStart = start;
    let shiftedPausedDates = pausedDates as string[];
    let shiftedMealOverrides = mealOverrides as Record<string, string>;

    if (hasActive) {
      const { data: cascadedSub, error: cascadedSubError } = await supabaseAdmin
        .from("subscriptions")
        .select("starts_on")
        .eq("id", subscription.id)
        .single();

      if (cascadedSubError || !cascadedSub) {
        throw new Error("Failed to load cascaded subscription dates");
      }

      prefsStart = parseISO(cascadedSub.starts_on);
      const dayOffset = differenceInCalendarDays(prefsStart, start);

      shiftedPausedDates = pausedDates.map((d: string) =>
        format(addDays(parseISO(d), dayOffset), "yyyy-MM-dd"),
      );
      shiftedMealOverrides = Object.fromEntries(
        Object.entries(mealOverrides as Record<string, string>).map(
          ([date, meal]) => [
            format(addDays(parseISO(date), dayOffset), "yyyy-MM-dd"),
            meal,
          ],
        ),
      );

      await supabaseAdmin
        .from("subscription_daily_preferences")
        .delete()
        .eq("subscription_id", subscription.id);
    }

    const dailyPreferences = [];
    const totalDaysToGenerate = baseDuration + pausesUsed;
    let currentDate = prefsStart;

    for (let i = 0; i < totalDaysToGenerate; i++) {
      const dateStr = format(currentDate, "yyyy-MM-dd");
      const isPaused = shiftedPausedDates.includes(dateStr);
      const dayMealType = isPaused
        ? null
        : shiftedMealOverrides[dateStr] || foodType;

      dailyPreferences.push({
        subscription_id: subscription.id,
        customer_profile_id: customerProfileId,
        preference_date: dateStr,
        meal_category_id: isPaused ? null : getCategoryId(dayMealType),
        delivery_address_id: addressId,
        is_paused: isPaused,
        pause_credit_used: isPaused,
      });

      currentDate = addDays(currentDate, 1);
    }

    const { error: prefsError } = await supabaseAdmin
      .from("subscription_daily_preferences")
      .insert(dailyPreferences);
    if (prefsError) throw prefsError;

    // 9. Burn the Coupon
    if (couponCode && customerProfileId) {
      const resolved = await resolveSubscriptionCoupon(
        supabaseAdmin,
        couponCode,
        customerProfileId,
        planId,
        plan.duration_days,
      );

      if (resolved.success) {
        const { coupon } = resolved.result;
        await supabaseAdmin
          .from("coupons")
          .update({ times_used: coupon.times_used + 1 })
          .eq("id", coupon.id);
      }
    }

    // 10. Log the Activation Event
    await supabaseAdmin.from("subscription_events").insert({
      subscription_id: subscription.id,
      event_type: "ACTIVATED",
      note: "Activated via Razorpay Online Checkout",
    });

    const { data: customerProfile } = await supabaseAdmin
      .from("customer_profiles")
      .select("user_id")
      .eq("id", customerProfileId)
      .maybeSingle();

    const customerName = await getCustomerNameByProfileId(customerProfileId);
    const planName = plan.name ?? "subscription plan";

    if (customerProfile?.user_id) {
      await sendNotificationToUser(customerProfile.user_id, {
        title: "Subscription Started!",
        message:
          "Thanks for purchasing subscription. Know how to manage your subscription. Click here to view invoice.",
        actionUrl: "/customer/subscription/manage/planner",
        sendEmail: true,
      });
    }

    await notifyAdmins({
      title: "Subscription Started!",
      message: `Hi Admin, Subscription ${planName} purchased by ${customerName} customer.`,
      actionUrl: "/admin/subscriptions",
      sendEmail: true,
      emailStrategy: "shared",
    });

    return {
      success: true,
      message: "Subscription fully activated and recorded!",
    };
  } catch (error) {
    console.error("Verification & DB Insertion Error:", error);
    return {
      success: false,
      error: "Payment verification or database save failed.",
    };
  }
}
