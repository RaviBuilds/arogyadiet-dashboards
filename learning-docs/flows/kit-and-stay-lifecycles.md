# Flow: KIT Lifecycle

Files: onboarding (`OnboardingService.onboard`, category KIT, any pincode) or `admin-actions/kitLifecycleActions.ts sendNewKitAction` → `KitLifecycleService.createNewKit` → `shippingActions.saveShippingInfoAction` (`kit_shipping_info`) → customer `dashboard/ShippingTracker.tsx` → `kitTrackerActions.confirmReceivedDateAction` → `kitTrackerActions.saveDailyLogAction` → triggers (`create-kit-tracker-sync-trigger.sql`, `create-kit-received-date-lock-trigger.sql`, category guards) → `/api/cron/expire-kits` → `KitLifecycleService.expireEligibleKits` → `kit-history/page.tsx` → `/api/kit-report/[subscriptionId]` (`KitReportService`, `KitReportTemplate.tsx`).

```mermaid
sequenceDiagram
  autonumber
  participant ST as Staff (admin)
  participant K as KitLifecycleService
  participant C as Customer
  participant DB as Postgres (+ triggers)
  participant CR as expire-kits cron (23:30 IST)
  ST->>K: checkEligibility -> createNewKit / onboard KIT
  ST->>DB: saveShippingInfoAction (courier, tracking)
  C->>DB: confirmReceivedDateAction -> subscriptions.kit_received_date
  loop each day
    C->>DB: saveDailyLogAction -> kit_daily_logs
    DB->>DB: trg_kit_daily_logs_sync: count FOOD_SKIPPED, set kit_tracker_end_date
  end
  C--xDB: change received date after logs -> blocked (23514)
  CR->>K: expireEligibleKits(today IST)
  K->>DB: ACTIVE KIT with tracker_end_date passed -> EXPIRED
  C->>DB: kit-history + PDF report
  ST->>K: eligible again -> sendNewKitAction
```

End date formula (trigger): `kit_tracker_end_date = kit_received_date + (kit_duration_days - 1) + skipped_days`.

---

# Flow: Accommodation Stay Lifecycle

Files: `admin/(main)/customers/[id]` → `AccommodationTab`/`NewStayDialog` → `src/actions/stayActions.ts createNewStayAction` (or `accommodationOnboardingActions.ts`) → `AccommodationService.createStay` → payments/ledger (`stayPaymentActions.ts`, `create-stay-payment-lifecycle.sql`) → `/api/cron/transition-stays` (01:00 IST) → `AccommodationService.transitionStays` → daily logs (customer `stay-tracker`, admin logs) → `extendStayAction` / `RecalculateStayDialog` (`create-stay-recalculation.sql`) → `markStayCheckedOutAction` / `checkoutStay` → `generateFinalInvoice` → `/api/stay-health-report/[stayId]`.

```mermaid
sequenceDiagram
  autonumber
  participant AD as Admin
  participant AS as AccommodationService
  participant DB as Postgres
  participant CR as transition-stays cron
  participant C as Customer
  AD->>AS: createStay(type, occupancy, nights, start)
  AS->>DB: stay_entries PENDING + payment/advance
  CR->>AS: transitionStays()
  AS->>DB: PENDING -> ACTIVE on start date
  C->>DB: customer_health_logs, addon_service_requests
  AD->>DB: admin_health_logs
  AD->>AS: extendStay(+n nights) -> stay_extension_history
  AD->>AS: recalculate (early checkout) -> stay_recalculation_history
  CR->>AS: transitionStays() after last night -> FINISHED / awaiting checkout
  AD->>AS: checkoutStay -> finalize_stay_checkout() + generateFinalInvoice
  AD->>DB: record payments / refunds (record_stay_refund_with_invoice)
  C->>DB: health report PDF
```

```mermaid
stateDiagram-v2
  [*] --> PENDING
  PENDING --> ACTIVE: start date (cron)
  PENDING --> EXPIRED
  ACTIVE --> FINISHED: end (cron) / checkout
```
