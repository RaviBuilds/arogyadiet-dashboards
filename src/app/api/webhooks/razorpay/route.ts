import crypto from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyAdmins, sendNotificationToUser, buildPushPayload } from "@/lib/notifications";
import { getCustomerNameByProfileId } from "@/lib/notifications/lookups";

// Razorpay webhook backstop for the ADDON (shop) checkout flow.
//
// The primary payment confirmation path is client-side: Checkout.js's
// `handler` callback fires in the browser/WebView and calls
// `verifyAddonPayment` (src/actions/shop-actions.ts). On Android, a UPI
// app-switch (GPay/PhonePe) can background or kill the WebView activity
// before that callback ever runs, leaving a payment captured on Razorpay's
// side with no corresponding `addon_orders`/`payments` update. This route
// reconciles that case independently of the client.
//
// Scope: only the addon/shop flow, because `addon_orders`/`payments` rows
// already exist (created before the Razorpay order) with the exact
// `payment_id` embedded in `order.notes`. The subscription checkout flow
// (`checkoutActions.ts`) does NOT persist its `checkoutData` server-side
// before payment — it's passed back from the client after payment — so a
// webhook cannot reconstruct a subscription from `order.notes` alone. That
// flow still relies solely on the client callback; if the same app-switch
// reliability problem needs closing there, `checkoutData` must first be
// persisted server-side at order-creation time.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature");
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!secret) {
    console.error("Razorpay webhook: RAZORPAY_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  if (expectedSignature !== signature) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: {
    event?: string;
    payload?: {
      payment?: {
        entity?: {
          id?: string;
          order_id?: string;
          notes?: { payment_id?: string; checkout_type?: string };
        };
      };
    };
  };

  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (event.event !== "payment.captured" && event.event !== "order.paid") {
    // Acknowledge and ignore events we don't act on.
    return NextResponse.json({ received: true });
  }

  const paymentEntity = event.payload?.payment?.entity;
  const razorpayPaymentId = paymentEntity?.id;
  const razorpayOrderId = paymentEntity?.order_id;
  const internalPaymentId = paymentEntity?.notes?.payment_id;
  const checkoutType = paymentEntity?.notes?.checkout_type;

  if (!razorpayPaymentId || !razorpayOrderId || !internalPaymentId) {
    console.warn("Razorpay webhook: missing identifiers in payload", {
      razorpayPaymentId,
      razorpayOrderId,
      internalPaymentId,
    });
    return NextResponse.json({ received: true });
  }

  if (checkoutType !== "ADDON") {
    // Subscription checkoutData isn't persisted pre-payment; see file header.
    return NextResponse.json({ received: true });
  }

  const supabase = createAdminClient();

  // Idempotency: if we've already recorded this payment, do nothing.
  const { data: existingTx } = await supabase
    .from("razorpay_transactions")
    .select("id")
    .eq("razorpay_payment_id", razorpayPaymentId)
    .maybeSingle();

  if (existingTx) {
    return NextResponse.json({ received: true, alreadyProcessed: true });
  }

  const { data: payment, error: paymentFetchError } = await supabase
    .from("payments")
    .select("id, status, customer_profile_id")
    .eq("id", internalPaymentId)
    .maybeSingle();

  if (paymentFetchError || !payment) {
    console.error("Razorpay webhook: payment not found", internalPaymentId, paymentFetchError);
    return NextResponse.json({ received: true });
  }

  if (payment.status === "PAID") {
    return NextResponse.json({ received: true, alreadyProcessed: true });
  }

  const { error: rzpTxError } = await supabase.from("razorpay_transactions").insert({
    payment_id: internalPaymentId,
    razorpay_order_id: razorpayOrderId,
    razorpay_payment_id: razorpayPaymentId,
    razorpay_signature: signature,
    gateway_status: "SUCCESS",
  });

  if (rzpTxError) {
    console.error("Razorpay webhook: failed to insert transaction", rzpTxError);
    return NextResponse.json({ error: "Failed to record transaction" }, { status: 500 });
  }

  const { error: paymentUpdateError } = await supabase
    .from("payments")
    .update({ status: "PAID", paid_at: new Date().toISOString() })
    .eq("id", internalPaymentId);

  if (paymentUpdateError) {
    console.error("Razorpay webhook: failed to update payment", paymentUpdateError);
    return NextResponse.json({ error: "Failed to update payment" }, { status: 500 });
  }

  const { data: updatedOrder, error: addonOrderUpdateError } = await supabase
    .from("addon_orders")
    .update({ status: "PAID" })
    .eq("payment_id", internalPaymentId)
    .select("id, franchise_id, addon_order_items(product_id, quantity)")
    .maybeSingle();

  if (addonOrderUpdateError) {
    console.error("Razorpay webhook: failed to update addon order", addonOrderUpdateError);
    return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
  }

  if (updatedOrder?.franchise_id) {
    const orderItems = (updatedOrder.addon_order_items ?? []) as Array<{
      product_id: string;
      quantity: number;
    }>;

    for (const orderItem of orderItems) {
      const { data: decremented, error: decError } = await supabase.rpc(
        "decrement_franchise_product_stock",
        {
          p_franchise_id: updatedOrder.franchise_id,
          p_product_id: orderItem.product_id,
          p_quantity: orderItem.quantity,
        },
      );

      if (decError || decremented === false) {
        console.error(
          "Razorpay webhook: franchise stock decrement issue:",
          decError?.message ?? "insufficient stock",
          { product_id: orderItem.product_id },
        );
      }
    }
  }

  if (payment.customer_profile_id) {
    const customerName = await getCustomerNameByProfileId(payment.customer_profile_id);

    const { data: customerProfile } = await supabase
      .from("customer_profiles")
      .select("user_id")
      .eq("id", payment.customer_profile_id)
      .maybeSingle();

    if (customerProfile?.user_id) {
      const title = "Product purchase confirmed!";
      const message =
        "Your recent purchase is confirmed and scheduled for delivery along with your upcoming meals.";

      await sendNotificationToUser(customerProfile.user_id, {
        title,
        message,
        actionUrl: "/customer/meals",
        sendEmail: false,
        ...buildPushPayload(title, message, `product-purchase-webhook-${internalPaymentId}`),
      });
    }

    const adminTitle = "Product purchase confirmed!";
    const adminMessage = `Hi Admin, Customer ${customerName} has completed a product purchase (reconciled via webhook).`;

    await notifyAdmins({
      title: adminTitle,
      message: adminMessage,
      actionUrl: "/admin/customers",
      sendEmail: false,
      ...buildPushPayload(
        adminTitle,
        adminMessage,
        `product-purchase-admin-webhook-${internalPaymentId}`,
      ),
    });
  }

  return NextResponse.json({ received: true });
}
