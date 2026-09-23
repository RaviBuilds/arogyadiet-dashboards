# 03 — Rider Portal Feature Map

> Portal: `deliverypartner.*` → `/rider`. Runs inside the Android app (Capacitor APK); also usable in a mobile browser.

## Diagram 3 — Rider Feature Tree

```mermaid
%%{init: {"theme":"base","mindmap":{"padding":32},"themeVariables":{"cScale0":"#0f172a","cScale1":"#134e4a","cScale2":"#1e3a8a","cScale3":"#4c1d95","cScale4":"#78350f","cScale5":"#14532d","cScale6":"#0c4a6e","cScale7":"#3f0f5f","cScaleLabel0":"#f1f5f9","cScaleLabel1":"#f1f5f9","cScaleLabel2":"#f1f5f9","cScaleLabel3":"#f1f5f9","cScaleLabel4":"#f1f5f9","cScaleLabel5":"#f1f5f9","cScaleLabel6":"#f1f5f9","cScaleLabel7":"#f1f5f9","primaryColor":"#0f172a","primaryTextColor":"#f1f5f9","primaryBorderColor":"#38bdf8","textColor":"#f1f5f9","defaultColor":"#f1f5f9","lineColor":"#94a3b8"},"themeCSS":"text{fill:#f1f5f9 !important;} .mindmap-node text{fill:#f1f5f9 !important;} [class*=root] text{fill:#f1f5f9 !important;} .node-root text{fill:#f1f5f9 !important;}"}}%%
mindmap
  root((Rider))
    Authentication ✅
      Email + password login
      Forgot password
      Update password
    Dashboard ✅
      Duty toggle
      Today's assigned orders
      Earnings snapshot
    Duty and Shift ✅
      On-duty starts native GPS tracking
      Auto off-duty when idle
        System sweep every 5 minutes
      Tracking survives reboot
        Boot receiver
        Foreground service
    Route ✅
      Optimized stop order
      Batch summary
        Total distance
        Expected payout
    Delivery ✅
      Pickup confirmation
      Status updates
        Out for delivery
        Reaching location
      Delivered or Failed marking
      Delivery proof photo upload
      Failure approval flow
        Pending-admin-approval state
    Live Tracking ✅
      Background location updates
        Foreground service + notification
      Offline buffering
        Queued locations sync later
      Battery-optimization guidance
        Per phone-brand instructions
    Payout
      Monthly summary view 🟡
        Display column mismatch under review
      Withdrawal history ✅
    Profile ✅
      Personal and emergency contact
```

## Notes for the client conversation

- **The tracking is genuinely native.** Going on duty starts an Android foreground service (with a persistent notification) that records location even in the background, buffers fixes while offline, and syncs when connectivity returns. Tracking restarts after a phone reboot. This is hardened, verified code — the strongest mobile capability in the platform.
- **Route is pre-computed, not rider-decided:** stops arrive in an optimized order with a distance and expected payout for the batch, so riders simply follow the list.
- **One honest caveat:** the payout screen reads a summary column the monthly settlement job doesn't currently populate, so figures need reconciliation until the fix lands (🟡 — the top-priority open item).
- Two legacy route folders exist in the rider app but are not part of any flow (dead surfaces — cleanup candidate).
