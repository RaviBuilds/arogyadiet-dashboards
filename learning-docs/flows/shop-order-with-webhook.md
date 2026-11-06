# Flow: Shop Order with Razorpay Webhook Backstop

Files: `src/store/useCartStore.ts` → `src/app/customer/(main)/shop/checkout/page.tsx` → `src/actions/shop-actions.ts` (`createAddonCheckoutOrder`, `verifyAddonPayment`, `checkAndReconcileAddonPaymentAction`) → Razorpay → `src/app/api/webhooks/razorpay/route.ts` → RPCs `decrement_franchise_product_stock` / `clinic_shop_apply_sale` → `src/app/api/cron/link-products/route.ts` → `systemActions.runProductLinkingAction`.

```mermaid
sequenceDiagram
  autonumber
  participant C as Customer checkout
  participant A as shop-actions.ts
  participant DB as Supabase
  participant RZ as Razorpay
  participant W as /api/webhooks/razorpay
  C->>A: createAddonCheckoutOrder(cart, coupon)
  A->>DB: session -> profile, active sub, next delivery day, stock/visibility
  A->>DB: insert addon_orders PENDING, payments PENDING (ADDON), items
  A->>RZ: orders.create(notes {payment_id, checkout_type: ADDON})
  C->>RZ: pay (UPI may switch apps)
  alt client callback runs
    RZ-->>C: handler(response)
    C->>A: verifyAddonPayment(paymentId, response)
    A->>A: HMAC(order|payment, KEY_SECRET)
    A->>DB: razorpay_transactions, payments PAID, addon_orders PAID
    A->>DB: franchise: decrement_franchise_product_stock / core: clinic_shop_apply_sale
  else app resumed
    C->>A: checkAndReconcileAddonPaymentAction -> fetchPayments -> verifyAddonPayment(marker)
  end
  RZ->>W: POST payment.captured / order.paid (x-razorpay-signature)
  W->>W: HMAC(raw body, WEBHOOK_SECRET) == signature?
  W->>DB: already processed? (razorpay_payment_id or payment PAID) -> 200
  W->>DB: else rzp tx, payments PAID, addon_orders PAID, franchise stock decrement, notify
  Note over DB: 23:55 IST link-products -> addon_orders.delivery_order_id
```

Error/retry behaviour:
- Webhook returns 500 on DB failures so Razorpay retries (Razorpay retries failed webhooks — per Razorpay docs, not verifiable in code).
- Returns 200 for ignored events and already-processed payments (idempotent).
- Gap: webhook path does not call `clinic_shop_apply_sale`, so core-clinic stock is not decremented when only the webhook completes the order.
