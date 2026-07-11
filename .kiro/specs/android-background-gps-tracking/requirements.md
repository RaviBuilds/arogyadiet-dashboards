# Requirements Document

## Introduction

This feature covers the reliability redesign of the ArogyaDiet rider app's native Android background GPS layer, plus the rider On Duty / Off Duty duty lifecycle that is coupled to GPS tracking, plus the additive UI needed for the new duty controls.

The rider app is a Capacitor + Next.js hybrid shell. Today its native location service is architected as a **Bound Service** whose lifetime is tied to the WebView Activity binding, so GPS stops when the app is minimized, the screen turns off, another app comes to the foreground, the process is killed, the app is swiped away, or the device reboots. The redesign replaces this with a **Foreground Started Service** whose lifecycle is scoped to the delivery shift rather than the UI, backed by a durable on-device queue and a retrying sync worker, with recovery paths for process kill, swipe-away, and reboot, and full Android 13/14/15 foreground-service compliance. The community plugin `@capacitor-community/background-geolocation` is forked and hardened so the existing JavaScript `addWatcher` / `removeWatcher` contract is preserved.

Layered on top of the reliable native service, the duty lifecycle couples GPS to the On Duty toggle and adds two new ways to end a shift: **auto off-duty** (a server-side scheduled sweep that flips a rider Off Duty roughly five minutes after their deliveries finish) and **admin-initiated off-duty** (a guarded admin action usable only when a rider has no active assignments). Any off-duty decision must reliably stop native tracking even when the app is backgrounded or dead.

**Out of scope (behaviour and UI must remain unchanged):** customer live tracking, admin live tracking (beyond one additive control), the delivery/order flow and dispatch logic, authentication and session management, and any Supabase schema redesign. Duty state reuses existing `rider_profiles` columns and existing `delivery_orders` fields; the only new configuration is a grace-period environment variable.

## Glossary

- **Rider_App**: The Capacitor + Next.js hybrid application running on the rider's Android device, comprising a WebView (JavaScript) layer and a native Android layer.
- **Location_Service**: The native `LocationForegroundService` — a Foreground Started Service that owns the background location lifecycle independent of the WebView Activity.
- **Location_Engine**: The native component wrapping `FusedLocationProviderClient` that requests location fixes and routes them to the Background_Queue.
- **Background_Queue**: The durable, bounded, on-device buffer of captured location fixes (`QueuedLocation` records) that decouples capture from delivery.
- **Sync_Worker**: The native component that drains the Background_Queue to the backend with retry and backoff, and forwards live fixes to the Capacitor_Bridge when the WebView is alive.
- **Boot_Receiver**: The native broadcast receiver that reacts to device boot completion and re-arms tracking in a policy-safe manner when a shift was active.
- **WakeLock_Manager**: The native component that acquires and releases a partial `WakeLock` scoped to the shift.
- **Capacitor_Bridge**: The thin, stateless plugin layer that translates the JavaScript `addWatcher` / `removeWatcher` API into native `ACTION_START_TRACKING` / `ACTION_STOP_TRACKING` intents and forwards native location events back to JavaScript.
- **Shift_State**: The persisted native flag (`ShiftState`, including `isActive`, `riderId`, and start config) that is the single source of truth for whether a shift is active and is used by recovery components.
- **Queued_Location**: A single buffered location fix record with a `SyncState` of `PENDING`, `IN_FLIGHT`, `DELIVERED`, or `FAILED`.
- **Duty_State**: The rider's on/off duty status, represented by the existing `rider_profiles.is_online` column (`true` = On Duty, `false` = Off Duty).
- **On_Duty_Toggle**: The existing rider client control (`rider-status-toggle.tsx`) that sets `is_online` and couples the shift to `addWatcher` / `removeWatcher`.
- **Auto_Off_Duty_Cron**: The new scheduled server endpoint `GET /api/cron/auto-off-duty` that detects riders whose deliveries have finished and flips them Off Duty after a grace period.
- **Admin_Off_Duty_Action**: The new guarded admin server action `adminSetRiderOffDutyAction(riderId)` that marks a rider Off Duty when the rider has no active assignments.
- **Off_Duty_Propagation**: The layered mechanism (`propagateOffDuty`) that signals a server-side off-duty decision to the native Location_Service so it stops in any app state.
- **Active_Delivery_Status**: A `delivery_orders.status` value in the non-terminal, post-relevant set `{OUT_FOR_DELIVERY, ON_THE_WAY, REACHING_TO_LOCATION, PICKED}`.
- **Terminal_Delivery_Status**: A `delivery_orders.status` value of `DELIVERED` or `FAILED`.
- **Grace_Period**: The configurable delay after a rider's last delivery finishes before auto off-duty applies, read from the environment variable `RIDER_AUTO_OFF_DUTY_GRACE_MINUTES` (default 5 minutes).
- **Location_Backend**: The existing Supabase `rider_live_locations` store and its upsert contract, keyed on `rider_id`.

## Requirements

### Requirement 1: Continuous background tracking across app and device states

**User Story:** As a delivery rider, I want GPS to keep flowing while I am On Duty regardless of what my phone is doing, so that my location is always available to customers and operations during my shift.

#### Acceptance Criteria

1. WHILE Shift_State.isActive is true AND the Rider_App is minimized, THE Location_Engine SHALL continue requesting location fixes at intervals not exceeding 15 seconds.
2. WHILE Shift_State.isActive is true AND the device screen is off, THE Location_Engine SHALL continue requesting location fixes at intervals not exceeding 15 seconds.
3. WHILE Shift_State.isActive is true AND another application is in the foreground, THE Location_Engine SHALL continue requesting location fixes at intervals not exceeding 15 seconds.
4. WHILE Shift_State.isActive is true AND a phone or messaging-application call is active, THE Location_Engine SHALL continue requesting location fixes at intervals not exceeding 15 seconds.
5. WHILE Shift_State.isActive is true AND the rider switches between applications, THE Location_Engine SHALL continue requesting location fixes at intervals not exceeding 15 seconds.
6. WHILE Shift_State.isActive is true AND the device enters screen-sleep or Doze, THE Location_Engine SHALL continue requesting location fixes at intervals not exceeding 15 seconds.
7. WHILE Shift_State.isActive is true, THE Location_Service SHALL run as a foreground service and SHALL retain its shift notification, including after the WebView Activity unbinds.
8. IF a requested location fix cannot be obtained within 30 seconds, THEN THE Location_Engine SHALL retry on the next interval and SHALL retain the last known fix.
9. IF the operating system terminates the Location_Service WHILE Shift_State.isActive is true, THEN THE Location_Service SHALL be restarted within 30 seconds of the operating system permitting restart and SHALL resume requesting location fixes.
10. IF location permission is revoked or device location is disabled WHILE Shift_State.isActive is true, THEN THE Location_Service SHALL post a notification indicating tracking is paused, SHALL pause capture, and SHALL automatically resume requesting location fixes when permission and device location are restored.

### Requirement 2: Corrected service lifecycle and unbind semantics

**User Story:** As a rider app maintainer, I want the location service lifecycle decoupled from the UI binding, so that tracking outlives the WebView Activity and stops only on an explicit shift stop.

#### Acceptance Criteria

1. WHEN the WebView Activity unbinds from the Location_Service, THE Location_Service SHALL retain all active location update requests without removing them, and SHALL continue emitting location updates at the configured interval.
2. WHEN the WebView Activity unbinds from the Location_Service, THE Location_Service SHALL remain running as a foreground service without self-terminating and without calling `stopSelf`.
3. WHEN the Location_Service receives `ACTION_START_TRACKING`, THE Location_Service SHALL start the Location_Engine, persist Shift_State.isActive as true, and return `START_STICKY` from `onStartCommand`.
4. IF the Location_Service receives `ACTION_START_TRACKING` AND the Location_Engine fails to start because location permission is not granted or location services are disabled, THEN THE Location_Service SHALL NOT persist Shift_State.isActive as true, SHALL surface an error indication reporting the specific start failure, and SHALL stop itself.
5. WHEN the Location_Service is recreated by the operating system with a null-action start intent AND Shift_State.isActive is true, THE Location_Service SHALL resume tracking from the persisted Shift_State configuration.
6. IF the Location_Service is recreated by the operating system with a null-action start intent AND Shift_State.isActive is true AND the persisted Shift_State configuration is missing or fails validation, THEN THE Location_Service SHALL NOT start the Location_Engine, SHALL surface an error indication reporting the invalid persisted state, and SHALL stop itself.
7. WHEN the Location_Service is recreated by the operating system with a null-action start intent AND Shift_State.isActive is false, THE Location_Service SHALL stop itself.
8. WHEN the Location_Service is destroyed by the operating system, THE Location_Service SHALL stop the Location_Engine, release any held WakeLock, and flush all pending Background_Queue entries to durable storage within 5 seconds.
9. IF the Location_Service is destroyed by the operating system AND the Background_Queue flush to durable storage fails or does not complete within 5 seconds, THEN THE Location_Service SHALL retain the unflushed Background_Queue entries for a subsequent flush attempt without discarding them.

### Requirement 3: Recovery from process kill, swipe-away, and reboot

**User Story:** As a delivery rider, I want tracking to come back automatically after my phone kills the app or restarts, so that I do not have to remember to restart tracking mid-shift.

#### Acceptance Criteria

1. WHEN the operating system kills the Location_Service process under memory pressure AND Shift_State.isActive is true, THE Location_Service SHALL be recreated within 30 seconds of the operating system permitting process restart AND SHALL resume location tracking from the persisted Shift_State without requiring rider interaction.
2. WHEN the rider swipes the Rider_App away from Recents AND Shift_State.isActive is true, THE Location_Service SHALL schedule a restart to occur within 5 seconds AND SHALL resume location tracking from the persisted Shift_State upon restart.
3. WHEN the rider swipes the Rider_App away from Recents AND Shift_State.isActive is false, THE Location_Service SHALL proceed with normal teardown without scheduling a restart.
4. WHEN the device completes booting AND Shift_State.isActive is true, THE Boot_Receiver SHALL re-arm tracking within 60 seconds of boot completion using a policy-safe path that presents a rider-visible notification and does not start background location updates until the rider opens the Rider_App.
5. WHEN the device completes booting AND Shift_State.isActive is false, THE Boot_Receiver SHALL take no action.
6. IF a scheduled or recreated restart of the Location_Service fails to resume tracking, THEN THE Location_Service SHALL retry the restart up to 3 times at intervals of 10 seconds, AND after the final failed attempt SHALL present a rider-visible notification indicating tracking could not resume while preserving the persisted Shift_State.
7. IF the persisted Shift_State cannot be read during recreation, restart, or boot re-arm, THEN THE Location_Service SHALL NOT start background location AND SHALL present a rider-visible notification indicating that tracking must be manually restarted.

### Requirement 4: Durable buffering and at-least-once delivery

**User Story:** As an operations user, I want every captured location to eventually reach the backend even through network gaps or WebView death, so that rider tracks have no silent holes.

#### Acceptance Criteria

1. WHEN the Location_Engine produces a location fix that passes the accuracy gate, THE Location_Engine SHALL enqueue the fix into the Background_Queue with a `PENDING` state and a capture timestamp expressed as milliseconds since the Unix epoch in UTC.
2. IF a location fix fails the accuracy gate, THEN THE Location_Engine SHALL discard the fix before enqueue and SHALL make no change to the Background_Queue.
3. THE Background_Queue SHALL maintain every Queued_Location in exactly one `SyncState` from the set {`PENDING`, `IN_FLIGHT`, `DELIVERED`, `FAILED`} at any time.
4. WHEN the Sync_Worker delivers a batch of between 1 and 100 fixes successfully, THE Sync_Worker SHALL mark those fixes `DELIVERED`.
5. IF a delivery attempt is not confirmed successful within 30 seconds or returns an error, THEN THE Sync_Worker SHALL mark the affected fixes `FAILED` and increment their attempt count.
6. WHEN a fix is marked `FAILED` AND its attempt count is below 10, THE Sync_Worker SHALL schedule a retry using exponential backoff starting at 5 seconds, doubling each attempt, capped at 300 seconds, with added jitter between 0 and 5 seconds.
7. THE Sync_Worker SHALL guarantee that every fix passing the accuracy gate reaches the Location_Backend at least once or remains in the Background_Queue as `PENDING` or `FAILED` until it does.
8. WHEN the Background_Queue exceeds its bound of 10000 entries, THE Background_Queue SHALL evict oldest `DELIVERED` fixes first and then oldest `PENDING` fixes, and SHALL retain the most recent fix.
9. WHERE the WebView is alive, THE Sync_Worker SHALL forward delivered fixes to the Capacitor_Bridge for the existing Supabase upsert path.

### Requirement 5: Android foreground-service and Play-policy compliance

**User Story:** As a rider app maintainer, I want the foreground location service to comply with Android 13, 14, and 15 rules and Google Play policy, so that tracking is not refused by the operating system and the app remains publishable.

#### Acceptance Criteria

1. WHEN the Location_Service starts tracking, THE Location_Service SHALL call `startForeground` with foreground service type `location` within 5 seconds of service start and before returning from `onStartCommand`.
2. IF `startForeground` is not called within 5 seconds of service start, THEN THE Location_Service SHALL stop itself, surface an error indication reporting the foreground-service start timeout, and preserve the persisted Shift_State.
3. WHEN the Location_Service calls `startForeground`, THE Location_Service SHALL hold runtime location permission at that time.
4. IF runtime location permission is not held when the Location_Service attempts to start tracking, THEN THE Location_Service SHALL NOT call `startForeground`, SHALL surface an error indication reporting the missing permission, and SHALL stop itself.
5. WHERE the device runs Android 13 or later, THE Rider_App SHALL request the `POST_NOTIFICATIONS` runtime permission required to display the foreground service notification.
6. IF `POST_NOTIFICATIONS` permission is denied WHERE the device runs Android 13 or later, THEN THE Rider_App SHALL surface an error indication that the tracking notification cannot be shown and SHALL continue to attempt foreground tracking where the operating system permits.
7. WHERE the device runs Android 14 or later, THE Location_Service SHALL declare `foregroundServiceType="location"` and hold the `FOREGROUND_SERVICE_LOCATION` permission.
8. WHERE the device runs Android 15, THE Location_Service SHALL be started only from a foreground context or an operating-system-exempt context, and SHALL NOT initiate a background foreground-service start.
9. IF a foreground-service start returns a foreground-service-start-not-allowed error, THEN THE Location_Service SHALL use the policy-safe notification-tap re-arm path, surface an error indication, and preserve the persisted Shift_State.
10. THE Rider_App SHALL support Android versions 13, 14, and 15.

### Requirement 6: WakeLock management scoped to the shift

**User Story:** As a delivery rider, I want tracking to keep working through Doze and screen sleep without keeping my screen on, so that my battery lasts through the shift.

#### Acceptance Criteria

1. WHEN the Location_Service starts tracking and `startForeground` has completed, THE WakeLock_Manager SHALL acquire a single partial WakeLock, and IF a WakeLock is already held, THEN THE WakeLock_Manager SHALL NOT acquire an additional WakeLock.
2. WHEN the WakeLock_Manager acquires the WakeLock, THE WakeLock_Manager SHALL apply a failsafe timeout not exceeding the configured maximum shift duration of 43200 seconds, after which the WakeLock is automatically released.
3. WHEN the Location_Service stops tracking or is destroyed, THE WakeLock_Manager SHALL release the held WakeLock within 1 second, and IF no WakeLock is currently held, THEN THE WakeLock_Manager SHALL complete without error.
4. IF releasing the WakeLock fails, THEN THE WakeLock_Manager SHALL retry release up to 3 attempts and SHALL surface an error indication that the WakeLock could not be released.
5. WHEN the active shift ends, THE WakeLock_Manager SHALL release the WakeLock within 1 second and SHALL NOT hold it beyond the shift-end event.

### Requirement 7: Preserved Capacitor bridge contract

**User Story:** As a rider app maintainer, I want the JavaScript location API to stay identical, so that existing WebView components need no changes and out-of-scope behaviour is protected.

#### Acceptance Criteria

1. WHEN JavaScript calls `addWatcher` with options, THE Capacitor_Bridge SHALL start the Location_Service via an `ACTION_START_TRACKING` intent and SHALL return, within 2000 milliseconds, a watcher identifier string between 1 and 128 characters that is unique among active watchers.
2. IF the Location_Service fails to start when JavaScript calls `addWatcher`, THEN THE Capacitor_Bridge SHALL return an error, SHALL NOT return a watcher identifier, and SHALL NOT register a watcher.
3. WHEN JavaScript calls `removeWatcher` with a currently active matching watcher identifier, THE Capacitor_Bridge SHALL stop tracking via an `ACTION_STOP_TRACKING` intent.
4. IF JavaScript calls `removeWatcher` with an unknown watcher identifier, THEN THE Capacitor_Bridge SHALL return an error and SHALL NOT issue an `ACTION_STOP_TRACKING` intent.
5. WHEN the Location_Service produces a location event AND the WebView is alive, THE Capacitor_Bridge SHALL deliver the event to the registered JavaScript callback using the existing payload shape, preserving the field names, units, and value types for latitude, longitude, accuracy, altitude, bearing, speed, and time.
6. WHEN the Location_Service produces a location event AND the WebView is not alive, THE Capacitor_Bridge SHALL discard the event without invoking a callback and SHALL NOT retain it.
7. THE Capacitor_Bridge SHALL hold no state that persists across process restarts and SHALL make no shift-lifecycle decisions.

### Requirement 8: Explicit-stop is the only clean stop

**User Story:** As a rider app maintainer, I want tracking to stop cleanly only on an explicit stop, so that transient lifecycle events never end a shift prematurely.

#### Acceptance Criteria

1. WHEN the Location_Service receives `ACTION_STOP_TRACKING`, THE Location_Service SHALL stop the Location_Engine, release the WakeLock, clear Shift_State, and call `stopSelf` within 2 seconds.
2. THE Location_Service SHALL perform a clean tracking stop, defined as stopping the Location_Engine, releasing the WakeLock, clearing Shift_State, and calling `stopSelf`, only in response to `ACTION_STOP_TRACKING`.
3. WHEN the Location_Service receives a transient lifecycle event including `onTaskRemoved`, `onDestroy`, `onLowMemory`, `onTrimMemory`, or a system-initiated process kill WHILE Shift_State.isActive is true, THE Location_Service SHALL NOT perform a clean tracking stop and SHALL preserve Shift_State for recovery.
4. WHEN the Location_Service receives `ACTION_STOP_TRACKING` AND no shift is active, THE Location_Service SHALL treat the request as a no-op and SHALL complete without error.
5. IF a step of the clean tracking stop fails, THEN THE Location_Service SHALL continue the remaining stop steps, SHALL surface an error indication reporting the failed step, and SHALL clear Shift_State.

### Requirement 9: On Duty coupling to continuous tracking

**User Story:** As a delivery rider, I want turning On Duty to start continuous tracking and turning Off Duty to stop it, so that my duty status and tracking always agree.

#### Acceptance Criteria

1. WHEN a rider toggles On Duty, THE On_Duty_Toggle SHALL set `is_online` to true, confirm the update succeeded, and then start background tracking via `addWatcher`, retaining the returned watcher identifier for later teardown.
2. WHILE a rider's `is_online` is true, THE Rider_App SHALL keep device location synced to the Location_Backend at no more than the rate permitted by the existing write throttle.
3. WHEN a rider goes Off Duty by any trigger, being the manual On_Duty_Toggle, the Auto_Off_Duty_Cron, or the Admin_Off_Duty_Action, THE Rider_App SHALL stop background tracking by calling `removeWatcher` on the retained watcher identifier.
4. IF setting `is_online` to true fails, THEN THE On_Duty_Toggle SHALL revert the toggle to its prior state, SHALL NOT start background tracking, SHALL leave no lingering watcher, and SHALL surface an error indication to the rider.
5. IF `is_online` was set to true but the subsequent `addWatcher` call fails, THEN THE On_Duty_Toggle SHALL revert `is_online` to false, revert the toggle state, and surface an error indication to the rider.

### Requirement 10: Auto off-duty after deliveries finish

**User Story:** As an operations manager, I want riders who forget to toggle off to be automatically marked Off Duty after their deliveries finish, so that tracking stops when no work remains.

#### Acceptance Criteria

1. THE Auto_Off_Duty_Cron SHALL run on the configured schedule and SHALL read the Grace_Period from the environment variable `RIDER_AUTO_OFF_DUTY_GRACE_MINUTES`, interpreting it as a whole number of minutes between 0 and 1440 inclusive, and SHALL default to 5 minutes when the variable is unset.
2. IF `RIDER_AUTO_OFF_DUTY_GRACE_MINUTES` is set to a value that is not a whole number between 0 and 1440 inclusive, THEN THE Auto_Off_Duty_Cron SHALL use the default Grace_Period of 5 minutes and continue processing.
3. IF the request secret does not match `CRON_SECRET`, THEN THE Auto_Off_Duty_Cron SHALL return HTTP 401, make no change to any rider's `is_online` or `last_offline_at`, and invoke no Off_Duty_Propagation.
4. IF a rider with `is_online` true has at least one order whose delivery date equals the current calendar day in the service's configured timezone in an Active_Delivery_Status, THEN THE Auto_Off_Duty_Cron SHALL make no change for that rider.
5. IF a rider with `is_online` true has no order for the current calendar day in the service's configured timezone in any Terminal_Delivery_Status, THEN THE Auto_Off_Duty_Cron SHALL make no change for that rider.
6. IF a rider with `is_online` true has all of the current calendar day's orders in a Terminal_Delivery_Status AND the most recent terminal transition occurred within the Grace_Period measured from the cron execution time, THEN THE Auto_Off_Duty_Cron SHALL make no change for that rider.
7. WHEN a rider with `is_online` true has no order for the current calendar day in an Active_Delivery_Status, has at least one order for the current calendar day in a Terminal_Delivery_Status, and the most recent terminal transition occurred more than the Grace_Period before the cron execution time, THE Auto_Off_Duty_Cron SHALL set that rider's `is_online` to false, set `last_offline_at` to the cron execution time, and invoke Off_Duty_Propagation for that rider.
8. IF Off_Duty_Propagation fails for a rider whose `is_online` was set to false, THEN THE Auto_Off_Duty_Cron SHALL retain that rider's `is_online` false and `last_offline_at` values, record the propagation failure in the run result, and continue processing the remaining riders.
9. IF evaluation of any single rider fails during a sweep, THEN THE Auto_Off_Duty_Cron SHALL make no change for that rider, record the failure in the run result, and continue processing the remaining riders.
10. WHEN the Auto_Off_Duty_Cron sweep is run again after a partial or failed prior run, THE Auto_Off_Duty_Cron SHALL re-evaluate current state and SHALL produce no double effect on any rider already marked `is_online` false.

### Requirement 11: Admin-initiated off-duty with active-assignment guard

**User Story:** As an admin, I want to mark a rider Off Duty when they have no active assignments, so that I can correct duty status without disrupting an in-progress delivery.

#### Acceptance Criteria

1. WHEN an authorized admin invokes the Admin_Off_Duty_Action for a rider, THE Admin_Off_Duty_Action SHALL re-check server-side within the same operation and before performing any write whether the rider has any order today in an Active_Delivery_Status.
2. IF the caller is not an authorized admin, THEN THE Admin_Off_Duty_Action SHALL return a typed authorization error and SHALL make no change to the rider's `is_online` or `last_offline_at`.
3. IF the supplied rider identifier does not correspond to an existing rider, THEN THE Admin_Off_Duty_Action SHALL return a typed not-found error and SHALL make no change.
4. IF the rider has at least one order today in an Active_Delivery_Status, THEN THE Admin_Off_Duty_Action SHALL return a typed error indicating the rider has an active assignment and SHALL leave the rider's `is_online` and `last_offline_at` unchanged.
5. WHEN the rider has zero orders today in an Active_Delivery_Status, THE Admin_Off_Duty_Action SHALL set the rider's `is_online` to false, set `last_offline_at` to the current time, and invoke Off_Duty_Propagation for that rider.

### Requirement 12: Off-duty propagation to backgrounded or dead app

**User Story:** As an operations manager, I want an off-duty decision to stop native tracking even when the rider's app is closed, so that we never keep tracking a rider who is Off Duty.

#### Acceptance Criteria

1. WHEN a rider's `is_online` is set to false server-side by any trigger, THE Off_Duty_Propagation SHALL emit an off-duty signal via realtime or push within 5 seconds of the state change for delivery to the Rider_App.
2. IF the off-duty signal cannot be delivered to the Rider_App because it is unreachable, defined as no active realtime connection and no push acknowledgment within 30 seconds, THEN THE Off_Duty_Propagation SHALL retain the authoritative `is_online` false Duty_State so that it is applied on the next Sync_Worker drain cycle or next foreground event.
3. WHEN the Sync_Worker runs its drain cycle AND the authoritative Duty_State for the shift is `is_online` false, THE Location_Service SHALL stop tracking via the `ACTION_STOP_TRACKING` path.
4. WHEN the Rider_App next comes to the foreground AND `is_online` is false while a local watcher exists, THE Rider_App SHALL call `removeWatcher`.
5. WHEN off-duty is triggered manually, automatically, or by admin, THE Location_Service SHALL stop tracking through the single `ACTION_STOP_TRACKING` path only.
6. WHEN a rider's `is_online` is set to false server-side while the app is backgrounded or dead, THE Location_Service SHALL stop tracking no later than the earlier of the next Sync_Worker drain cycle, occurring at an interval of at most 900 seconds, or the next foreground event.
7. WHILE `is_online` is false for the shift, THE Location_Service SHALL remain in the stopped-tracking state and SHALL NOT emit location updates until `is_online` is set to true.

### Requirement 13: Additive duty UI

**User Story:** As an admin, I want a Mark Off Duty control in the existing rider area, so that I can trigger admin off-duty without any redesign of current screens.

#### Acceptance Criteria

1. WHILE an admin views the existing rider area, THE admin rider area SHALL present a Mark Off Duty control within the existing layout, adding only the control and leaving all pre-existing screen elements, positions, and navigation of that screen unchanged.
2. WHERE a rider has zero active assignments for the current calendar day in the system timezone, THE Mark Off Duty control SHALL be in the enabled state, and WHERE a rider has one or more active assignments for the current calendar day in the system timezone, THE Mark Off Duty control SHALL be in the disabled state and SHALL reject activation input.
3. WHEN an admin activates the enabled Mark Off Duty control, THE admin rider area SHALL invoke the Admin_Off_Duty_Action for that rider and SHALL keep the control in a non-activatable state until the invocation returns a success or failure result.
4. WHEN the Admin_Off_Duty_Action returns a success result, THE admin rider area SHALL display a visible success indication for that rider within 2 seconds and SHALL reflect the rider's updated off-duty state without navigating away from the current screen.
5. IF the Admin_Off_Duty_Action returns a failure result or does not return within 10 seconds, THEN THE admin rider area SHALL display an error indication that the off-duty action did not complete, SHALL restore the Mark Off Duty control to its prior enabled state, and SHALL leave the rider's duty state unchanged.
6. WHERE the optional rider auto-off-duty notice is enabled, WHEN a rider opens the Rider_App AND `is_online` is false following an auto off-duty event, THE Rider_App SHALL show a non-blocking notice that permits continued interaction with all existing controls, SHALL NOT add a new screen, and SHALL NOT alter the position, labels, or behavior of the On_Duty_Toggle.

### Requirement 14: No regression to out-of-scope systems

**User Story:** As a product owner, I want customer tracking, admin tracking, and the data schema to stay unchanged, so that the redesign carries no regression risk to working systems.

#### Acceptance Criteria

1. WHEN the customer live tracking feature is exercised after the redesign, THE customer live tracking read path SHALL return the same location records, ordering, and refresh cadence as the pre-redesign baseline captured before the redesign began.
2. WHEN the customer live tracking gating is evaluated after the redesign, THE Rider_App SHALL grant or deny access under the identical conditions as the pre-redesign baseline, producing the same allow or deny outcome for every tested access scenario.
3. WHEN the customer live tracking UI is rendered after the redesign, THE Rider_App SHALL display the same visual elements, layout, and states as the pre-redesign baseline, with zero pixel-level or element-level differences.
4. WHEN the admin live tracking feature is exercised after the redesign, THE admin live tracking read path, gating, map, and overlays SHALL produce the same behaviour and visuals as the pre-redesign baseline, with the sole permitted difference being the additive Mark Off Duty control.
5. WHERE the Mark Off Duty control is present in the admin live tracking UI, THE admin rider area SHALL add only that control and SHALL NOT alter, remove, or reposition any pre-existing admin live tracking element.
6. THE `rider_live_locations` schema, including its columns, types, and constraints, SHALL remain identical to the pre-redesign baseline, and its read queries SHALL return identical result sets for identical inputs.
7. THE duty lifecycle SHALL read and write only existing `rider_profiles` columns and existing `delivery_orders` fields, and SHALL NOT introduce any new duty-state column, table, or field.

### Requirement 15: Error handling and resilience

**User Story:** As a delivery rider, I want tracking to degrade gracefully on permission, service, and network problems, so that recoverable errors do not silently end my shift or lose my locations.

#### Acceptance Criteria

1. IF location permission is revoked mid-shift, THEN THE Location_Service SHALL detect the revocation within 5 seconds, emit an error event, post a permission notification, and pause capture.
2. WHEN location permission is re-granted after a mid-shift revocation, THE Location_Service SHALL resume capture within 5 seconds.
3. IF Google Play Services is unavailable when starting the Location_Engine, THEN THE Location_Service SHALL surface an error event to the Capacitor_Bridge and retry availability at 30-second intervals for up to 10 attempts without crashing.
4. IF the network is unavailable or the backend returns a server error, THEN THE Sync_Worker SHALL retain affected fixes as `PENDING` or `FAILED` and retry with exponential backoff starting at 5 seconds, capped at 300 seconds, for up to 10 attempts per fix.
5. WHEN a fix exhausts its retry attempts, THE Sync_Worker SHALL retain the fix as `FAILED` and SHALL NOT delete it.
6. IF a foreground-service start is disallowed on Android 15, THEN THE Location_Service SHALL use the policy-safe notification-tap re-arm path and SHALL NOT initiate a background start.
7. WHEN an off-duty trigger flips `is_online` to false for a rider already Off Duty, or `removeWatcher` is called for an already-cleared watcher, THE Rider_App SHALL treat the operation as a no-op.
