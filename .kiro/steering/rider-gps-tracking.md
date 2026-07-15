---
inclusion: manual
---

# Rider Live GPS Tracking — Status & Resume Context

**Status as of 2026-07-12: Core fix implemented and Doze-tested. Pilot rollout in progress (limited test riders, not general release).**

This document is the resumable context for the rider live-location tracking fix. Read this before continuing any work on rider GPS/tracking/location issues.

---

## 1. Original problem (reported by riders)

- Admin's live tracking map showed rider location freezing / "GPS inactive" mid-route.
- Riders reported: opening another app, minimizing the app, or taking a phone call caused location updates to stop.
- Riders explicitly requested: ability to lock the screen and keep the phone in a pocket for long drives (they know the route, don't need on-screen navigation) while location keeps updating for the admin.

## 2. Root cause

The original implementation uploaded location from **JavaScript inside the WebView** to Supabase. Android suspends/throttles WebView JS timers in the background (Doze, App Standby, OEM killers) — so uploads silently stopped exactly when the rider locked the screen or switched apps. This was the fundamental architectural flaw, not a Capacitor limitation.

## 3. Architecture fix (implemented, native side)

Moved the entire upload pipeline into the native Android layer so it no longer depends on the WebView being alive.

**Native plugin location:** `native/plugins/background-geolocation/android/src/main/java/com/arogyadiet/rider/location/`
(module namespace `com.equimaps.capacitor_background_geolocation` for the Capacitor bridge class itself — see below)

Key files:
- `LocationForegroundService.java` — foreground service (`foregroundServiceType="location"`), owns shift lifecycle, native heartbeat, START_STICKY + AlarmManager restart, WakeLock.
- `SupabaseUploader.java` — dependency-free HTTP POST from native background thread to a `SECURITY DEFINER` Supabase RPC (`upsert_rider_live_location`). Independent of WebView.
- `LocationQueue.java` — durable SQLite queue (survives crashes/offline), bounded at 10k entries, `deleteForRidersOtherThan(riderId)` purges stale rows from prior placeholder-id builds.
- `LocationEngineConfig.java` — 10m distance filter (reduced from 25m).
- `SyncWorker.java` — drain cycle + backoff retry, runs on dedicated `HandlerThread` (never main thread).
- `com/equimaps/capacitor_background_geolocation/BackgroundGeolocation.java` — the actual `@CapacitorPlugin(name = "BackgroundGeolocation")` bridge class (note: different package than the location logic above — fully-qualified names required in AndroidManifest.xml, a relative name resolves to the wrong package).

**Fixes implemented (all confirmed working via live device testing + DB verification):**
1. Null lat/lng upsert guard (was causing Postgres 23502 errors on first callback).
2. `removeWatcher` matches by UUID OR callback-id value (JS/native id mismatch bug), plus defensive stop-tracking call.
3. Distance filter reduced 25m → 10m (JS options + native default).
4. **Core fix**: upload moved from WebView JS to native `SupabaseUploader` running on a background `HandlerThread`.
5. Real rider UUID passed through `addWatcher({ riderId })` → native bridge `call.getString("riderId")` → `ShiftState`. (Previously native used the Capacitor callbackId — a meaningless numeric string — as the "rider id", causing `invalid input syntax for type uuid` Postgres errors.)
6. `LocationQueue.deleteForRidersOtherThan(riderId)` — purges queue rows tagged with old placeholder ids, called on every `ACTION_START_TRACKING`.
7. Fatal location error handling in JS (`rider-status-toggle.tsx`): detects device location off / permission denied, tears down watcher, flips rider off-duty server-side, shows toast.
8. Removed redundant JS-side Supabase upsert/heartbeat code — native now owns 100% of the upload pipeline. JS callback in `rider-status-toggle.tsx` is now purely for fatal-error detection.
9. **30-second native heartbeat**: re-uploads last cached coordinates every 30s even when stationary (below the 10m distance filter), keeping `updated_at` fresh. Admin dashboard's staleness threshold is 90s, so this gives ~3x margin. Runs on `syncHandler` (the same background `HandlerThread`), independent of GPS fixes.

**Supabase side:**
- RPC: `scripts/create-rider-live-location-upsert-rpc.sql` — `SECURITY DEFINER`, callable by anon role (RLS intentionally relaxed for `rider_live_locations` per user's explicit decision — live location is considered low-security, short-lived data).
- Table `rider_live_locations`: columns `rider_id (uuid, PK-like)`, `lat`, `lng`, `updated_at`, `tracker_session_id`, `franchise_id`. One row per rider (upsert, not history).
- Credentials: `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`, embedded in the native `SupabaseUploader` (publishable/anon key, safe to embed per user's explicit approval).

**Web/JS side changes:**
- `src/shared/components/rider/rider-status-toggle.tsx` — `addWatcher` now passes real `riderId`; JS callback only handles fatal errors (location off/permission denied) — teardown, flip off-duty, toast. All periodic upload/heartbeat logic removed (native owns it).
- `src/lib/capacitor/background-geolocation-stub.ts` — Capacitor plugin JS shim (must delegate to `registerPlugin`, never throw/no-op — this is what makes the deployed Vercel web bundle actually reach the native service).

**Build/deploy mechanics (important for anyone resuming):**
- App is Capacitor + `server.url` pointing to `deliverypartner.arogyadiet.com` (Vercel) — the web bundle is NOT packaged in the APK, it loads remotely. **Web/JS changes deploy via normal Vercel deploy, no APK rebuild needed.**
- Native changes require, in order:
  1. `robocopy "E:\Local Clients\Next.js\arogyadiet\native\plugins\background-geolocation" "E:\Local Clients\Next.js\rider-mobile-app\local-plugins\background-geolocation" /E`
  2. `robocopy "E:\Local Clients\Next.js\rider-mobile-app\local-plugins\background-geolocation" "E:\Local Clients\Next.js\rider-mobile-app\node_modules\@capacitor-community\background-geolocation" /E`
  3. `npx cap sync android` — run from `E:\Local Clients\Next.js\rider-mobile-app` root, NOT from the `android` subfolder.
  4. Android Studio: Rebuild Project, then Run (or Generate Signed Bundle/APK for release testing).
- The `rider-mobile-app` repo is a separate project outside this workspace's file-access boundary — I (the assistant) cannot read/write there directly. The user has a Gemini agent available in Android Studio for that side; I provide prompts for it to execute.
- User's Android Studio has a Terminal tab and a Logcat panel used throughout testing (filters used: `tag:SupabaseUploader`, `tag:LocationFGService`).

## 4. Doze / battery-optimization endurance testing (completed 2026-07-12)

**Method:** Forced deep Doze via adb (`dumpsys battery unplug` → `dumpsys deviceidle force-idle`) while polling the `rider_live_locations.updated_at` column directly via the Postgres MCP tool (ground truth, no video/log guessing needed). Test rider: `b762fea6-bd07-4749-98e5-1dcd959f24e6`. Test device: **Vivo V2031** (FuntouchOS, Android 13, API 33) — a known aggressive OEM background-killer, so this is a strong worst-case proxy.

**Run 1 — no extra permissions (only what the app requested by default):**
- Died at ~7 minutes into forced Doze. Logcat showed `PROCESS ENDED` then a `PROCESS STARTED` (START_STICKY attempt) immediately followed by `PROCESS ENDED` again — Vivo blocked the restart.

**Run 2 — standard Android Settings "Unrestricted" battery toggle granted:**
- Died at ~9 minutes. Marginal improvement, same failure pattern.

**Run 3 — added iManager-level "Unrestricted" toggle (Vivo-specific, separate from Settings app):**
- **Survived 18+ minutes with zero interruption.** `updated_at` stayed within ~20s of "now" at every checkpoint (baseline, 6min, 9min [past prior death point], 18min). Same `tracker_session_id` throughout — process never died or restarted.

**Conclusion:** The native tracking architecture (foreground service + heartbeat + wakelock + native upload) is genuinely Doze-proof — it works indefinitely once the OS allows the process to live. The only failure mode found was OEM-level battery killers (Vivo iManager, and by extension MIUI/ColorOS/OxygenOS equivalents on other brands), which require a manufacturer-specific permission the rider must set manually. This is **not fixable in code** — it's a well-known Android fragmentation issue (see https://dontkillmyapp.com for the community reference).

**Caveats/things NOT yet tested:**
- Only tested on one device (Vivo). Xiaomi/Oppo/Realme/Samsung have their own equivalents but weren't verified directly.
- Forced `deviceidle force-idle` is harsher than real-world Doze (no maintenance windows) — a reasonable worst-case proxy, not identical to reality.
- Only ~18 minutes stationary tested, not a full multi-hour real shift with driving/battery drain/OS updates.
- No test yet of multiple riders tracking simultaneously, or of the reboot-recovery (`BootReceiver`) / `onTaskRemoved` restart-alarm paths under real conditions.

## 5. Permission onboarding feature (implemented 2026-07-12, in this codebase)

Since the fix is proven but depends on a manual per-device OEM permission the rider must set, built an in-app onboarding flow rather than relying on a rider admin conversation alone.

**New native plugin methods** (in `com/equimaps/capacitor_background_geolocation/BackgroundGeolocation.java`):
- `getBatteryOptimizationStatus()` — returns `{ isIgnoringBatteryOptimizations, manufacturer, model, sdkInt }` via `PowerManager.isIgnoringBatteryOptimizations()` + `Build.MANUFACTURER`. Only sees stock Android's exemption list — cannot see OEM-specific power managers (no public API for those).
- `requestIgnoreBatteryOptimizations()` — launches the stock `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` system prompt.
- Manifest: added `android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` to `native/plugins/background-geolocation/android/src/main/AndroidManifest.xml`.

**New web files:**
- `src/lib/capacitor/oem-battery-instructions.ts` — manufacturer → manual instruction steps map (Vivo, Xiaomi, Oppo, Realme, OnePlus, Samsung, generic fallback). Vivo steps explicitly cover both toggles proven necessary in testing (Section 4, Run 3).
- `src/shared/components/rider/BatteryPermissionOnboarding.tsx` — client component rendered on the rider dashboard (`src/app/rider/(main)/dashboard/dashboard-content.tsx`, placed above `RiderStatusToggle`). Shows an amber banner if `getBatteryOptimizationStatus()` reports not-exempt; tapping opens a dialog with (1) a button firing the stock exemption prompt and (2) OEM-specific manual steps + "Open App Settings" button. Re-checks on `appStateChange` (rider returning from Settings) and via a manual "I've done this — recheck" button. Session-dismissible ("Later") but resurfaces every app open until actually resolved. Fails open (shows nothing) if the native call throws — e.g. an old APK without these methods deployed yet.
- Extended `src/lib/capacitor/background-geolocation-stub.ts` with the two new method signatures + `BatteryOptimizationStatus` type.

**Verification done:** `npx tsc --noEmit` (pre-existing unrelated test-file errors only, none in touched files), `npx next build` (exit 0, `/rider/dashboard` compiles). Native side compiled successfully per Gemini agent report (Gradle `assembleDebug` succeeded, both new `@PluginMethod`s compile against the Capacitor SDK, manifest permission merged correctly). Not yet runtime-verified on-device (banner not yet visually confirmed on a real phone) — this is the next step before wider pilot distribution.

## 6. Rider admin documentation (created 2026-07-12)

`RIDER_GPS_TRACKING_SETUP_CHECKLIST.md` (project root) — full checklist for the rider admin to walk riders through: install/permission steps, brand-specific manual settings (Vivo/Xiaomi/Oppo/Realme/OnePlus/Samsung), safe vs. unsafe rider habits during a shift, and a troubleshooting question script for when a rider reports a tracking issue. Send this to the rider admin as-is.

## 7. Current release status — DO NOT treat as fully shipped

**This is explicitly a limited pilot, not a general rider rollout.** User's own plan (confirmed 2026-07-12): build a release APK, hand it to a small set of test riders only, gather real-shift feedback, iterate, then do a final release build once stable.

**Before recommending general rollout, still need:**
1. On-device runtime confirmation that the new battery-permission banner actually renders and functions (native methods compiled but untested live).
2. Pilot data from real riders across multiple OEM brands (only Vivo has been stress-tested).
3. A real multi-hour shift test with actual driving/GPS movement (only ~18 min stationary Doze has been verified).
4. Vercel deploy of the current web changes (`BatteryPermissionOnboarding.tsx` etc.) — confirm this has actually been pushed/deployed, since the rider app loads the web bundle remotely and these changes need to be live for pilot riders to see the banner.

**Explicitly deferred / not yet built (candidates for next session):**
- `WorkManager` periodic job as a second recovery path alongside `AlarmManager` (extra resilience layer, not required for current pilot).
- In-app "tracking may have stopped — tap to fix" detector/banner for silent failures during a shift (safety net before wider rollout).
- Server-side authoritative shift-state check (`ShiftAuthorityCallback.checkAuthoritativeShiftState()` in `LocationForegroundService.java` is currently a stub returning `UNKNOWN` — TODO comment already in code for wiring a native HTTP GET to `rider_profiles.is_online`).
- `tracker_session_id` does not appear to rotate per shift-toggle (observed same session id across multiple toggle-off/on cycles during testing) — minor, not investigated, not blocking.

## 8. Key facts for resuming a session

- Test rider UUID used throughout: `b762fea6-bd07-4749-98e5-1dcd959f24e6`.
- Postgres MCP tool (`mcp_postgres_readonly_query`) has direct read access to the Supabase DB — this was the ground-truth verification method for every Doze test, far more reliable than asking the user to read Logcat/video. Prefer this for any future live-tracking verification.
- `rider_live_locations` schema: `rider_id (uuid)`, `lat (numeric)`, `lng (numeric)`, `updated_at (timestamptz)`, `tracker_session_id (text)`, `franchise_id (uuid)`.
- User has a Gemini agent inside Android Studio for native-side operations (builds, syncs, manifest checks) — provide it explicit copy-paste-able prompts rather than assuming it has this conversation's context.
- User's rider-mobile-app project root: `E:\Local Clients\Next.js\rider-mobile-app` (outside this workspace, not directly accessible to the assistant).
- Signing key used for release builds: `rider_alias` (per Android Studio's Generate Signed Bundle dialog) — flagged as "not registered by a verified developer," which is expected/non-blocking for sideloaded test APKs (Play Integrity notice only).

---

## 9. Regression found & fixed (2026-07-15): `LiveLocationTracker` was a second, conflicting watcher

**Symptom (reported):** Rider marks On Duty → bike icon + "Live GPS" show correctly for a short time → then admin map flips to "Rider is online but GPS is inactive", and the rider's own `/route` page shows "Acquiring GPS..." forever. Happens for all riders, and specifically **starts right after marking batch pickup**.

**DB ground truth (via `mcp_postgres_readonly_query`):** Test rider (`b762fea6...`) went on-duty `02:24:01`, last `rider_live_locations.updated_at` `02:25:32` (~90s later), then dead 15+ min. Every online rider stale by hours/days. Classic WebView-JS-throttled-in-background death — the native 30s heartbeat was NOT running, meaning the native service had been stopped/clobbered.

**Root cause:** Section 3.8 claimed the JS-side upload was removed, but `src/shared/components/rider/LiveLocationTracker.tsx` was NOT cleaned up. It was still mounted on `/route` (via `RouteGpsIndicator`) and `/route/[orderId]`, and it:
1. started a **second** `BackgroundGeolocation.addWatcher` — with **no `riderId`** and `distanceFilter: 25`, conflicting with the single native watcher owned by `rider-status-toggle.tsx`;
2. uploaded to `rider_live_locations` from **WebView JS** (the original architectural bug — dies under Doze/background throttling), overwriting `tracker_session_id` with its own random id;
3. called `removeWatcher` on cleanup/unmount → **stopped the native foreground service** that the On Duty toggle had started.

It only mounts once `isGpsActive` is true, which is when orders flip to `OUT_FOR_DELIVERY` — i.e. **immediately after batch pickup**. That's the trigger.

**Fix (web/JS only — deploys via Vercel, no APK rebuild):**
- Rewrote `LiveLocationTracker.tsx` as a **read-only status reader**: no `addWatcher`, no `removeWatcher`, no upsert. It polls `rider_live_locations.updated_at` every 5s and reports `active` if fresh within `GPS_STALE_MS` (90s, matching `AdminLiveTrackingMap`), else `acquiring`. The native service started by the On Duty toggle is now the sole owner of the watcher and upload pipeline.
- Updated `RouteGpsIndicator.tsx` comment/branches to match (dropped the obsolete `error` branch).
- `rider-status-toggle.tsx` unchanged — it remains the single `addWatcher` owner.

**Verify after deploy:** on-duty a rider, mark batch pickup, confirm `rider_live_locations.updated_at` keeps advancing (native 30s heartbeat) and the admin map stays on "Live GPS". Note: pre-existing stale rows for riders who never got the new build will still show inactive until they run a build that never starts the JS watcher (i.e. after this web deploy, since the web bundle loads remotely).
