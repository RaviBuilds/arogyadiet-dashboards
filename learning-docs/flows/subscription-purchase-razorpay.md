# Flow: Subscription Purchase with Razorpay

Files: `src/app/customer/(main)/subscription/checkout/page.tsx` → `src/shared/components/customer/subscription/checkout/checkout-wizard.tsx.tsx` → `step-5-preview.tsx` → `src/actions/checkoutActions.ts` → `src/services/DeliveryChargeService.ts`, `src/lib/coupons/resolveSubscriptionCoupon.ts`, `src/services/SubscriptionPaymentService.ts` → Razorpay → `activateSubscription` → `src/actions/manageMealActions.ts` (`cascadePendingSubscriptionDates`) → `src/lib/notifications.ts` → later `src/app/api/cron/activate-subscriptions/route.ts`.

```mermaid
flowchart TD
  A["Checkout page: session + outstanding-balance redirect"] --> B["Wizard steps 1-4 (client state)"]
  B --> C["Step 5: previewDeliveryChargeAction, validateCouponAction"]
  C --> D["createRazorpayOrderAction<br/>balance gate, plan price, coupon, GST, delivery charge"]
  D --> E["razorpay.orders.create (notes: SUBSCRIPTION)"]
  E --> F["Checkout.js modal"]
  F -->|handler| G["verifyAndActivateSubscriptionAction<br/>HMAC sha256(order|payment)"]
  F -->|"app resumed (Capacitor appStateChange)"| H["checkAndReconcileSubscriptionPaymentAction<br/>razorpay.orders.fetchPayments"]
  F -->|"WebView killed"| X["LOST: no webhook for subscriptions"]
  G --> I["activateSubscription"]
  H --> I
  I --> J["insert payments SUCCESS"]
  J --> K["insert subscriptions ACTIVE or PENDING"]
  K --> L{"already ACTIVE?"}
  L -- yes --> M["cascadePendingSubscriptionDates + shift pauses/overrides"]
  L -- no --> N
  M --> N["link payment, razorpay_transactions"]
  N --> O["insert subscription_daily_preferences (duration + pauses rows)"]
  O --> P["coupon times_used++, subscription_events ACTIVATED"]
  P --> Q["notify customer + admins; client -> /subscription/success"]
  K -. PENDING .-> R["14:00 IST cron activate-subscriptions"]
```

Key facts for interviews:
- The server never trusts the client's price.
- Two confirmation paths (handler, resume reconciliation); idempotency check exists only in the reconcile path.
- The writes are sequential supabase-js calls, not a transaction.
- Payment status written: `SUCCESS` (other flows use `PAID`).
