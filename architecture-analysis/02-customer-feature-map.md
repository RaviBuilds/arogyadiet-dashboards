# 02 — Customer Portal Feature Map

> Portal: `customer.*` → `/customer`. The customer portal is organized around **three product lines** — every customer belongs to one (or more) of them — plus shared supporting modules.

## Diagram 2 — Customer Product Lines

```mermaid
%%{init: {"theme":"base","mindmap":{"padding":32},"themeVariables":{"cScale0":"#0f172a","cScale1":"#134e4a","cScale2":"#1e3a8a","cScale3":"#4c1d95","cScale4":"#78350f","cScale5":"#14532d","cScale6":"#0c4a6e","cScale7":"#3f0f5f","cScaleLabel0":"#f1f5f9","cScaleLabel1":"#f1f5f9","cScaleLabel2":"#f1f5f9","cScaleLabel3":"#f1f5f9","cScaleLabel4":"#f1f5f9","cScaleLabel5":"#f1f5f9","cScaleLabel6":"#f1f5f9","cScaleLabel7":"#f1f5f9","primaryColor":"#0f172a","primaryTextColor":"#f1f5f9","primaryBorderColor":"#38bdf8","textColor":"#f1f5f9","defaultColor":"#f1f5f9","lineColor":"#94a3b8"},"themeCSS":"text{fill:#f1f5f9 !important;} .mindmap-node text{fill:#f1f5f9 !important;} [class*=root] text{fill:#f1f5f9 !important;} .node-root text{fill:#f1f5f9 !important;}"}}%%
mindmap
  root((Customer))
    MEAL — food delivery
      Plans and Checkout ✅
        Plan selection
        Coupon application
        Delivery charge
        Razorpay payment
        Partial payment option
        Activation
      Daily Meal Planner ✅
        Meal preference per day
        Add-ons shown for the day
      Pause Preferences ✅
        Pause credits
        Timeline recalculation
      Address Preferences ✅
        Per-day address
        5 PM cutoff rule
      Billing and Invoices ✅
      Subscription History ✅
      Live Tracking ✅
        Rider location on map
        Status timeline
    KIT — shipped diet kit
      Kit Tracker ✅
        Daily log — food taken or skipped
        Weight and steps
        Activity minutes
        Nutrition details
      Shipping Info ✅
        Courier partner and tracking
      Kit History ✅
      PDF Report ✅
    ACCOMMODATION — wellness stay
      Stay Tracker ✅
      Health Logs ✅
        Water intake
        Activity
      Add-on Services ✅
        Request and track status
      Stay History ✅
      Health Report PDF ✅
```

## Diagram 2b — Supporting Customer Modules

```mermaid
%%{init: {"theme":"base","mindmap":{"padding":32},"themeVariables":{"cScale0":"#0f172a","cScale1":"#134e4a","cScale2":"#1e3a8a","cScale3":"#4c1d95","cScale4":"#78350f","cScale5":"#14532d","cScale6":"#0c4a6e","cScale7":"#3f0f5f","cScaleLabel0":"#f1f5f9","cScaleLabel1":"#f1f5f9","cScaleLabel2":"#f1f5f9","cScaleLabel3":"#f1f5f9","cScaleLabel4":"#f1f5f9","cScaleLabel5":"#f1f5f9","cScaleLabel6":"#f1f5f9","cScaleLabel7":"#f1f5f9","primaryColor":"#0f172a","primaryTextColor":"#f1f5f9","primaryBorderColor":"#38bdf8","textColor":"#f1f5f9","defaultColor":"#f1f5f9","lineColor":"#94a3b8"},"themeCSS":"text{fill:#f1f5f9 !important;} .mindmap-node text{fill:#f1f5f9 !important;} [class*=root] text{fill:#f1f5f9 !important;} .node-root text{fill:#f1f5f9 !important;}"}}%%
mindmap
  root((Customer 2))
    Authentication
      Mobile + PIN login ✅
        Temp PIN → set new PIN flow
        Lockout throttling
      OTP login ⛔ built, not mounted
      Email recovery ✅
        Forgot password
        Update password
      Self-signup ⛔ disabled by design
        Accounts created by Admin
    Dashboard ✅
      Quick stats
      Profile completion popup
    Shop ✅
      Product catalog
      Cart and checkout
        Razorpay payment
        Webhook-backed confirmation
      My Orders
    Health Logs ✅
      Self health-log submission
      Dietitian-reviewed
    Profile ✅
      Personal and medical details
      Addresses — Home, Work, Other
    Get the App 🟡
      APK download landing page
      QR code
      Operator setup steps unchecked
```

## Notes for the client conversation

- **One login, deliberately simple:** customers log in with mobile + PIN. A complete OTP login exists in the code but is not connected to the live login page — deliberate product decision or oversight, still to be confirmed.
- **Category-aware navigation:** a MEAL subscriber doesn't see KIT/Stay screens; a KIT customer doesn't see meal-planning screens. Enforced at the routing level, not just hidden menus.
- **Two payment paths:** subscriptions confirm via the payment app's callback (with an in-app recovery if interrupted); shop purchases add a server-side confirmation backstop — robust against mobile payment app-switching.
- **The 5 PM rule:** changes to tomorrow's meals, address, or pauses lock at 5:00 PM IST; afterwards the earliest editable day shifts to the day after tomorrow.

