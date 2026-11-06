# Flow: Rider Duty → Delivery → Payout

Files: `src/app/rider/(main)/dashboard/dashboard-content.tsx` → `src/shared/components/rider/BatteryPermissionOnboarding.tsx`, `rider-status-toggle.tsx` → `src/actions/rider-actions/shiftActions.ts` → native `LocationForegroundService.java` → `SupabaseUploader.java` → RPC `upsert_rider_live_location` → `src/app/rider/(main)/route/page.tsx` → `src/actions/rider-actions/routeActions.ts` → `src/lib/delivery/deliveryStatusNotifications.ts` → `src/app/api/cron/auto-off-duty/route.ts` → `src/actions/admin-actions/financeActions.ts` → `src/app/rider/(main)/payout/page.tsx`.

```mermaid
sequenceDiagram
  autonumber
  actor R as Rider (Android app)
  participant T as rider-status-toggle.tsx
  participant S as shiftActions.ts
  participant N as Native foreground service
  participant DB as Supabase
  participant RA as routeActions.ts
  participant CU as Customer map (Realtime)
  participant FI as financeActions.ts (master)
  R->>T: toggle On Duty
  T->>S: setRiderOnlineAction(true)
  S->>DB: rider_profiles.is_online = true
  T->>N: addWatcher({riderId})
  loop GPS fix (10 m) / 30 s heartbeat
    N->>DB: rpc upsert_rider_live_location
    DB-->>CU: realtime UPDATE
  end
  R->>RA: markBatchPickedUpAction
  RA->>DB: orders OUT_FOR_DELIVERY, batch IN_TRANSIT, status logs
  R->>RA: markOrderOnTheWayAction(order)
  RA->>DB: REACHING_TO_LOCATION + log + customer push
  R->>RA: markOrderDeliveredAction(order)
  RA->>DB: DELIVERED, delivered_at (payout_amount already set by routing)
  opt cannot deliver
    R->>RA: requestFailedDeliveryAction(reason)
    RA->>DB: PENDING_FAILURE_APPROVAL + admin notification
  end
  R->>T: toggle Off Duty (or cron after stale heartbeat)
  T->>N: removeWatcher
  T->>S: setRiderOnlineAction(false)
  Note over FI: monthly (27th -> 26th)
  FI->>DB: generateMonthlyPayment: sum DELIVERED payout_amount -> rider_monthly_summaries GENERATED
  FI->>DB: markPaymentAsPaid -> PAID
  R->>DB: payout page reads orders + summaries (net_payable mismatch for leaderboard)
```

Notes:
- Payout per stop = route leg km × ₹/km from `RateConfigService` (default constant if no rate).
- The auto-off-duty cron (every 5 min) flips riders whose heartbeat is older than `RIDER_HEARTBEAT_STALE_MINUTES` (default 10) unless they have an in-progress delivery.
- The monthly cron route exists but is not in the pg_cron SQL.
