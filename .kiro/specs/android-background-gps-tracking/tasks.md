# Implementation Plan: Android Background GPS Tracking + Rider Duty Lifecycle

## Overview

This plan converts the design into incremental coding steps across two languages the design already fixes: **Kotlin/Java** for the native Android layer (the fork-and-harden of `@capacitor-community/background-geolocation` — Parts A–I) and **TypeScript** for the Next.js 16 duty-lifecycle additions (Part J). Each step builds on the previous one and ends by wiring new code into an integration point, so there is no orphaned code.

The build order follows the design's phased roadmap (Part H):
1. Fork setup and native module scaffolding (Phase 0).
2. Started + Foreground Service core lifecycle (Phase 1) — fixes the primary root causes.
3. Durable queue + sync worker + persisted shift state (Phase 2).
4. Recovery paths: swipe-away, low-memory kill, reboot, WakeLock (Phase 3).
5. Capacitor bridge intent contract + explicit-stop path (spans Phases 1–3).
6. Rider duty lifecycle: On Duty coupling, auto off-duty cron, admin off-duty action, layered off-duty propagation, additive UI (Phase 5).
7. Regression guards for the out-of-scope customer/admin tracking read paths.

Property tests reference the design's Correctness Properties (Properties 1–14). Native path anchors use the forked plugin's Android module and the app package `com.arogyadiet.rider` (service class `.location.LocationForegroundService`). TypeScript anchors reuse existing files: `src/actions/rider-actions/shiftActions.ts`, `src/actions/admin-actions/liveTrackingActions.ts`, `src/shared/components/rider/rider-status-toggle.tsx`, `src/shared/components/admin/operations/AdminLiveTracking.tsx`, `src/app/api/cron/`, and `vercel.json`.

## Tasks

- [x] 1. Fork setup and native module scaffolding
  - [x] 1.1 Fork the plugin and confirm the JS contract is unchanged
    - Fork `@capacitor-community/background-geolocation` into a local, project-owned Android module and register it so the existing `BackgroundGeolocation.addWatcher/removeWatcher` JS imports in `rider-status-toggle.tsx` and `LiveLocationTracker.tsx` resolve to the fork with no JS edits
    - Keep the existing `src/lib/capacitor/background-geolocation-stub.ts` typings as the JS surface of truth (unchanged)
    - _Requirements: 7.8, 14.7_

  - [x] 1.2 Create the native `location` package skeleton and shared constants
    - Under the fork's Android module (`com.arogyadiet...location`), create empty class stubs: `LocationForegroundService`, `LocationEngine`, `LocationQueue`, `SyncWorker`, `ShiftStateStore`, `WakeLockManager`, `BootReceiver`
    - Define intent-action constants (`ACTION_START_TRACKING`, `ACTION_STOP_TRACKING`, `ACTION_BOOT_REARM`), the extras keys (`riderId`, `notifTitle`, `notifMessage`, `distanceFilterM`, `desiredIntervalMs`, `fastestIntervalMs`, `requestPermissions`, `stale`), and `NOTIFICATION_ID`
    - _Requirements: 2.3, 7.1_

  - [x] 1.3 Author AndroidManifest entries for the foreground service, permissions, and boot receiver
    - Add location/FGS/wakelock/boot/notification permissions and the `<service android:foregroundServiceType="location" android:exported="false">` and `<receiver>` (BOOT_COMPLETED, QUICKBOOT_POWERON) declarations per design E.4
    - _Requirements: 5.7, 5.10, 3.4_

- [x] 2. Started + Foreground Service core lifecycle
  - [x] 2.1 Implement `ShiftStateStore` durable persistence
    - Persist/read/clear `ShiftState` (`isActive`, `riderId`, `startedAtEpoch`, `watcherId`, `notifTitle`, `notifMessage`) in a store that survives process death; validate on read
    - _Requirements: 2.3, 2.5, 2.6_

  - [x] 2.2 Implement `LocationEngine` with adaptive cadence and accuracy gate
    - Wrap `FusedLocationProviderClient`; expose `start(request)`/`stop()`; build an adaptive `LocationRequest` (ADR-006) capped so fixes are produced at intervals not exceeding 15s; route each fix to `onLocationResult`; apply the accuracy gate and retain last-known fix on timeout
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 4.1, 4.2_

  - [x] 2.3 Implement `onStartCommand` returning `START_STICKY` with FGS promotion
    - Handle `ACTION_START_TRACKING`: call `startForeground(NOTIFICATION_ID, notification)` with type `location` within the OS window and before returning, guard on runtime location permission held, start the engine, persist `ShiftState.isActive=true`, return `START_STICKY`
    - Handle `null`-action redelivery: resume from persisted `ShiftState` when active, stop self when inactive or state invalid
    - _Requirements: 2.3, 2.5, 2.6, 2.7, 5.1, 5.3_

  - [ ]* 2.4 Write property test for FGS compliance
    - **Property 7: FGS compliance** — `startForeground(type=location)` is always called within the OS window with location permission held whenever tracking starts
    - **Validates: Requirements 5.1, 5.3**

  - [x] 2.5 Implement corrected `onUnbind` and `onDestroy`
    - `onUnbind`: do NOT remove location updates or call `stopSelf`; only pause live-forwarding; keep the foreground notification and engine running
    - `onDestroy`: stop engine + remove callbacks, release WakeLock, flush pending queue to durable storage within 5s, and rely on `START_STICKY`/scheduling to return if not an explicit stop
    - _Requirements: 2.1, 2.2, 2.8, 2.9_

  - [ ]* 2.6 Write property test for no-unbind-teardown / lifecycle independence
    - **Property 2: No unbind teardown** and **Property 1: Lifecycle independence** — `onUnbind` never stops the engine or self-terminates; while `isActive` the engine keeps running across UI transitions
    - **Validates: Requirements 2.1, 2.2, 1.7**

  - [x] 2.7 Handle start-failure and Android 13/14/15 permission/compliance paths
    - On engine start failure (permission missing / location disabled): do not persist `isActive`, surface a typed error to the bridge, stop self; do not call `startForeground` without permission; on FGS-start-not-allowed use the policy-safe re-arm path and preserve `ShiftState`; request `POST_NOTIFICATIONS` on Android 13+ and continue tracking where OS permits if denied
    - _Requirements: 2.4, 5.2, 5.4, 5.5, 5.6, 5.8, 5.9, 15.3_

- [x] 3. Checkpoint - core service continuity
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Durable buffering and sync
  - [x] 4.1 Implement `LocationQueue` durable bounded buffer
    - Local persistence (Room/SQLite) for `QueuedLocation`; `enqueue`, `peekBatch(limit)`, `markDelivered`, `markFailed`, `prune`; enforce single-`SyncState` invariant, the 10000-entry bound with oldest-`DELIVERED`-then-oldest-`PENDING` eviction retaining the most recent fix, and `DELIVERED` retention pruning
    - _Requirements: 4.3, 4.8_

  - [ ]* 4.2 Write property test for single-state invariant
    - **Property 5: Single-state invariant** — every `QueuedLocation` is in exactly one `SyncState` at any time
    - **Validates: Requirements 4.3**

  - [x] 4.3 Implement `SyncWorker` drain with retry/backoff
    - `drain()`: peek `PENDING` batch (1–100), mark `IN_FLIGHT`, deliver, mark `DELIVERED` on success else `FAILED` with attempt increment; exponential backoff base 5s doubling capped 300s with 0–5s jitter up to 10 attempts; guarantee at-least-once (fixes stay `PENDING`/`FAILED` until delivered); never delete an exhausted fix
    - _Requirements: 4.4, 4.5, 4.6, 4.7, 15.4, 15.5_

  - [ ]* 4.4 Write property test for at-least-once delivery
    - **Property 4: At-least-once delivery** — every fix passing the accuracy gate reaches the backend at least once or remains queued as `PENDING`/`FAILED`; no silent loss except bounded eviction
    - **Validates: Requirements 4.7, 4.4**

  - [x] 4.5 Wire the capture→queue→sync pipeline and live-forward to the bridge
    - Connect `LocationEngine.onLocationResult` → `LocationQueue.enqueue` → opportunistic `SyncWorker.drain`; when the WebView is alive, live-forward delivered fixes to the Capacitor bridge for the existing Supabase upsert path
    - _Requirements: 4.1, 4.9_

- [x] 5. Recovery from kill, swipe-away, and reboot
  - [x] 5.1 Implement `WakeLockManager` scoped to the shift
    - Acquire a single partial WakeLock after `startForeground` (idempotent), failsafe timeout ≤ 43200s, release within 1s on stop/destroy/shift-end with retry up to 3 and error surfaced on failure; no-op release when none held
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 5.2 Write unit tests for WakeLock lifecycle
    - Test single-acquire idempotency, failsafe timeout, release-within-1s, retry-on-release-failure, and no-op release
    - _Requirements: 6.1, 6.3, 6.4_

  - [x] 5.3 Implement `onTaskRemoved` swipe-away restart scheduling
    - When `isActive`, schedule a restart within 5s (AlarmManager / sticky redelivery) and resume from persisted `ShiftState`; when inactive, normal teardown with no restart; never remove location updates because of task removal
    - _Requirements: 3.2, 3.3, 8.3_

  - [x] 5.4 Implement low-memory kill resume via START_STICKY
    - On OS recreation with null-action intent while `isActive`, resume tracking from persisted `ShiftState` within 30s without rider interaction; retry a failed restart up to 3 times at 10s intervals and post a rider-visible "could not resume" notification after the final failure while preserving `ShiftState`
    - _Requirements: 3.1, 3.6, 3.7_

  - [x] 5.5 Implement `BootReceiver` policy-safe re-arm
    - On BOOT_COMPLETED with `isActive`, within 60s present a rider-visible notification and re-arm only via notification tap (no background location start until the rider opens the app); take no action when inactive; on unreadable `ShiftState` post a manual-restart notification and start nothing
    - _Requirements: 3.4, 3.5, 3.7_

  - [ ]* 5.6 Write property test for recovery guarantee
    - **Property 3: Recovery guarantee** — if the service is destroyed while `isActive` by any non-explicit-stop cause (kill, swipe, reboot), it is re-armed via `START_STICKY`, `onTaskRemoved` scheduling, or `BootReceiver`
    - **Validates: Requirements 3.1, 3.2, 3.4**

- [x] 6. Capacitor bridge intent contract and explicit-stop path
  - [x] 6.1 Implement the bridge `addWatcher` → `ACTION_START_TRACKING` translation
    - Marshal watcher options into start-intent extras, call `startForegroundService`, return a unique 1–128 char watcher id within 2000ms; on service start failure return an error and register no watcher; hold no cross-process state and make no lifecycle decisions
    - _Requirements: 7.1, 7.2, 7.7_

  - [x] 6.2 Implement the bridge `removeWatcher` → `ACTION_STOP_TRACKING` translation and event forwarding
    - Map a known watcher id to `ACTION_STOP_TRACKING`; return an error and issue no stop intent for an unknown id; forward native `location` events to the registered JS callback with the exact existing payload shape (latitude, longitude, accuracy, altitude, bearing, speed, time) only when the WebView is alive, discarding events (no retention) when it is not
    - _Requirements: 7.3, 7.4, 7.5, 7.6_

  - [ ]* 6.3 Write property test for contract stability
    - **Property 8: Contract stability** — the JS-facing `location` event payload and `addWatcher/removeWatcher` semantics are byte-compatible with the current plugin
    - **Validates: Requirements 7.5, 7.8**

  - [x] 6.4 Implement the explicit clean-stop path
    - On `ACTION_STOP_TRACKING`: stop engine, release WakeLock, clear `ShiftState`, `stopSelf` within 2s; treat stop with no active shift as a no-op; on transient events (`onTaskRemoved`/`onDestroy`/`onLowMemory`/`onTrimMemory`/system kill) never perform a clean stop and preserve `ShiftState`; on a failed stop step continue remaining steps, surface the failed step, and clear `ShiftState`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 15.7_

  - [ ]* 6.5 Write property test for explicit-stop-only clean stop
    - **Property 6: Explicit-stop is the only clean stop** — tracking performs a clean stop iff `ACTION_STOP_TRACKING` was received; transient lifecycle events never clean-stop
    - **Validates: Requirements 8.2, 8.3**

- [x] 7. Mid-shift error handling and resilience
  - [x] 7.1 Implement permission-revocation and Play-Services resilience
    - Detect location-permission revocation within 5s, emit an error event, post a permission notification, pause capture, and resume within 5s on re-grant; on Play Services unavailability surface an error event and retry availability at 30s intervals up to 10 attempts without crashing
    - _Requirements: 1.10, 15.1, 15.2, 15.3_

  - [ ]* 7.2 Write unit tests for error-handling paths
    - Test revoke→pause→resume, Play-Services retry ceiling, and OS-kill restart-within-30s behavior
    - _Requirements: 1.9, 1.10, 15.1_

- [x] 8. Checkpoint - native reliability complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Rider duty lifecycle: server-side auto off-duty
  - [x] 9.1 Add grace-period config and shared active/terminal status helpers
    - Read `RIDER_AUTO_OFF_DUTY_GRACE_MINUTES` (whole minutes 0–1440, default 5, fall back to 5 on invalid); define shared `ACTIVE_DELIVERY_STATUSES` / terminal-status sets and an IST "today" helper (reuse `getISTDateString`) in a duty-lifecycle util
    - _Requirements: 10.1, 10.2_

  - [x] 9.2 Implement the auto-off-duty sweep detection logic
    - In a testable server function, evaluate each `is_online=true` rider against today's `delivery_orders`: skip if any active order, skip if no terminal order, skip if last terminal transition within grace; otherwise mark eligible; per-rider failures are isolated and recorded; re-runs produce no double effect (idempotent)
    - _Requirements: 10.4, 10.5, 10.6, 10.7, 10.9, 10.10_

  - [x]* 9.3 Write property test for auto-off-duty never firing during active delivery
    - **Property 12: Auto off-duty never fires during an active delivery** — for any rider with ≥1 active order today the sweep makes no change; only all-terminal riders past grace are flipped
    - **Validates: Requirements 10.4, 10.7**

  - [x] 9.4 Implement the `GET /api/cron/auto-off-duty` route and register it in vercel.json
    - Create the route following the `link-products` pattern: `CRON_SECRET` guard returning 401 (no writes on mismatch), invoke the sweep with `createAdminClient`, set `is_online=false`+`last_offline_at=now()` for eligible riders using the `setRiderOnlineAction(false)` update shape, call `propagateOffDuty` per flipped rider, and add the cron entry to `vercel.json`
    - _Requirements: 10.1, 10.3, 10.7, 10.8, 14.7_

  - [x]* 9.5 Write unit tests for cron auth and idempotency
    - Wrong secret → 401 with no writes; double-run no double effect; propagation-failure path retains flipped state and records the failure
    - _Requirements: 10.3, 10.8, 10.10_

- [x] 10. Rider duty lifecycle: guarded admin off-duty
  - [x] 10.1 Implement `adminSetRiderOffDutyAction(riderId)` with active-assignment guard
    - Add the action in `src/actions/admin-actions/liveTrackingActions.ts` (or a sibling `adminShiftActions.ts`) using `createAdminClient`: enforce admin authorization (typed error), not-found for unknown rider, server-authoritative re-check of active orders today (typed error + no change when active), else set `is_online=false`+`last_offline_at=now()` and invoke `propagateOffDuty`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 14.7_

  - [x]* 10.2 Write property test for admin off-duty guard
    - **Property 13: Admin off-duty is guarded** — the action flips `is_online=false` iff the rider has zero active assignments today; otherwise it errors and makes no change
    - **Validates: Requirements 11.4, 11.5**

- [x] 11. Rider duty lifecycle: off-duty propagation and native stop
  - [x] 11.1 Implement `propagateOffDuty(riderId)` fast-path signal
    - Emit an off-duty signal via Supabase realtime on `rider_profiles` and/or existing OneSignal push within 5s of the `is_online→false` change; retain the authoritative `is_online=false` state when the app is unreachable (no realtime connection / no push ack within 30s)
    - _Requirements: 12.1, 12.2_

  - [x] 11.2 Implement the SyncWorker authoritative shift-state check (background-safe stop)
    - Extend the native `SyncWorker` drain cycle (interval ≤ 900s) to read the authoritative `is_online` for the shift and, when false, stop via the single `ACTION_STOP_TRACKING` path; while `is_online=false` remain stopped and emit no updates until it is true again
    - _Requirements: 12.3, 12.5, 12.6, 12.7_

  - [x] 11.3 Implement next-foreground reconcile in the rider app
    - On app foreground, read `is_online`; if false while a local watcher exists, call `removeWatcher` (mapped to `ACTION_STOP_TRACKING`); treat an already-cleared watcher / already-off state as a no-op
    - _Requirements: 12.4, 12.5, 15.7_

  - [ ]* 11.4 Write property test for single-stop-mechanism and dead-app stop
    - **Property 10: Single stop mechanism, three triggers** and **Property 11: Off-duty eventually stops a backgrounded/dead app** — all triggers converge on `ACTION_STOP_TRACKING`, and a server-side off-duty always stops native tracking within the bounded window
    - **Validates: Requirements 12.5, 12.6**

- [x] 12. Rider duty lifecycle: On Duty coupling verification
  - [x] 12.1 Verify and harden On Duty ⇄ tracking coupling in `rider-status-toggle.tsx`
    - Confirm On toggle sets `is_online=true`, confirms success, then `addWatcher` retaining the watcher id; Off (any trigger) calls `removeWatcher`; on `is_online` set failure revert the toggle with no watcher started; on `addWatcher` failure after `is_online=true` revert `is_online` to false and the toggle, surfacing an error — make only the minimal edits needed to satisfy these clauses
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ]* 12.2 Write property test for On Duty ⇒ continuous tracking
    - **Property 9: On Duty ⇒ continuous tracking** — while `is_online=true` tracking stays active/synced; any off trigger stops it (`is_online ⇔ shift tracking active`)
    - **Validates: Requirements 9.1, 9.3**

- [x] 13. Additive duty UI
  - [x] 13.1 Add the admin "Mark Off Duty" control to the existing admin rider area
    - Add a single control within `AdminLiveTracking.tsx` (or the rider row/detail) without altering existing elements, positions, or navigation; enable only when the rider has zero active assignments today (disabled + rejecting input otherwise); on activate call `adminSetRiderOffDutyAction`, hold non-activatable until it returns, show a success indication within 2s reflecting the off-duty state without navigating, and on failure/10s-timeout show an error and restore the prior enabled state
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 14.5_

  - [x] 13.2 Add the optional rider auto-off-duty notice
    - When the rider opens the app and `is_online` is false following an auto off-duty event, show a non-blocking notice that adds no new screen and does not alter the `On_Duty_Toggle` position, labels, or behavior
    - _Requirements: 13.6_

- [x] 14. Out-of-scope regression guards
  - [x]* 14.1 Write regression tests for customer and admin tracking read paths
    - Assert `LiveTrackingMap` and `AdminLiveTrackingMap` read paths, gating, and UI are unchanged (only the additive Mark Off Duty control differs), and that `rider_live_locations` queries return identical result sets for identical inputs
    - **Property 14: No regression to out-of-scope read paths**
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.6**

- [x] 15. Final checkpoint - end-to-end duty lifecycle and reliability
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Native tasks are Kotlin/Java inside the forked plugin's Android module; duty-lifecycle tasks are TypeScript in the existing Next.js app.
- Property tests reference the design's Correctness Properties (1–14) and the specific requirement clauses they validate.
- Checkpoints (tasks 3, 8, 15) provide incremental validation at phase boundaries.
- The plan honors the design's scope boundaries: JS bridge contract preserved, `rider_live_locations` schema and customer/admin tracking read paths untouched, duty state reuses existing `rider_profiles`/`delivery_orders` fields, and the only new configuration is `RIDER_AUTO_OFF_DUTY_GRACE_MINUTES`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.2", "5.1", "9.1"] },
    { "id": 2, "tasks": ["2.3", "4.1", "9.2", "10.1"] },
    { "id": 3, "tasks": ["2.5", "4.3", "9.3", "9.4", "10.2"] },
    { "id": 4, "tasks": ["2.7", "2.4", "6.1", "11.1"] },
    { "id": 5, "tasks": ["4.5", "2.6", "9.5"] },
    { "id": 6, "tasks": ["5.3", "6.2", "11.2", "11.3"] },
    { "id": 7, "tasks": ["5.4", "5.5", "6.3", "4.2", "4.4"] },
    { "id": 8, "tasks": ["6.4", "5.2", "5.6", "12.1", "13.1", "13.2"] },
    { "id": 9, "tasks": ["7.1", "11.4", "12.2"] },
    { "id": 10, "tasks": ["6.5", "7.2", "14.1"] }
  ]
}
```
