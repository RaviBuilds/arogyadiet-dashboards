# @capacitor-community/background-geolocation (ArogyaDiet fork)

Project-owned fork of [`@capacitor-community/background-geolocation`](https://github.com/capacitor-community/background-geolocation) **v1.2.26**.

This fork exists to support the native Android background GPS reliability
redesign in `.kiro/specs/android-background-gps-tracking`. The plan is to
**fork-and-harden**: replace the native Android service internals (Started +
Foreground Service, `START_STICKY`, `onTaskRemoved`, `BootReceiver`, WakeLock,
durable queue) in later tasks **while keeping the JavaScript contract identical**.

> **Task 1.1 status:** this is the *baseline* fork. The Android sources here are a
> faithful copy of upstream v1.2.26 (unchanged behaviour). Hardening happens in
> tasks 1.2, 1.3 and 2.x. Keeping the baseline faithful is what makes
> "the JS contract is unchanged" verifiable by direct comparison.

## Why a fork is needed (and why the JS is untouched)

- **Requirements 7.8 / 14.7:** the `addWatcher` / `removeWatcher` JS API and the
  `location` event payload must remain byte-for-byte compatible, and all changes
  must be additive.
- The consuming components — `src/shared/components/rider/rider-status-toggle.tsx`
  and `src/shared/components/rider/LiveLocationTracker.tsx` — import the plugin as:

  ```ts
  import { BackgroundGeolocation } from "@capacitor-community/background-geolocation";
  ```

  Those files are **not edited** by this task.

## JS contract: surface of truth

The plugin exposes exactly three methods and two data shapes:

| Symbol | Kept identical to |
| --- | --- |
| `WatcherOptions` | upstream `definitions.d.ts` + `src/lib/capacitor/background-geolocation-stub.ts` |
| `Location` | upstream `definitions.d.ts` + the stub |
| `CallbackError` | upstream `definitions.d.ts` + the stub |
| `BackgroundGeolocationPlugin` (`addWatcher`, `removeWatcher`, `openSettings`) | upstream `definitions.d.ts` + the stub |

- **Web builds** keep using `src/lib/capacitor/background-geolocation-stub.ts` as the
  JS surface of truth (unchanged). It is wired via `next.config.ts`
  (webpack + turbopack aliases), `tsconfig.json` `paths`, and `serverExternalPackages`.
  On web the native plugin never runs (`Capacitor.isNativePlatform()` guards all calls).
- **Native (Android) builds** use this fork. Upstream shipped **no JS runtime entry**
  (consumers were expected to call `registerPlugin("BackgroundGeolocation")`
  themselves). This fork adds `src/index.ts` → `dist/` which does exactly that and
  re-exports the named `BackgroundGeolocation`, so the existing named import
  resolves to the fork on native **with no JS edits**.

## How resolution / registration works

1. **Same package name.** This fork keeps the npm name
   `@capacitor-community/background-geolocation`, so any tooling that resolves that
   specifier can be pointed here without touching import statements.
2. **Same Capacitor plugin name.** The native class is annotated
   `@CapacitorPlugin(name = "BackgroundGeolocation")` and the JS entry calls
   `registerPlugin("BackgroundGeolocation")`. Capacitor binds JS ⇄ native by this
   name at runtime, independent of the import path.
3. **Root `package.json` override.** The web repo declares an `overrides` entry
   redirecting `@capacitor-community/background-geolocation` to this local folder,
   so the project formally owns the fork.

### Wiring the native Capacitor wrapper project

The rider native wrapper (the separate Capacitor Android project that holds the
`android/` platform) consumes this fork under the same specifier, then syncs:

```bash
# Point the dependency at the fork (choose one):
#   package.json -> "@capacitor-community/background-geolocation": "file:../arogyadiet/native/plugins/background-geolocation"
#   or an npm "overrides" entry to the same path
npm install
npx cap sync android
```

`npx cap sync` reads the `capacitor.android.src` field in this fork's
`package.json` and includes `android/` as a Gradle module, registering the
`BackgroundGeolocation` plugin automatically. No manual plugin registration or JS
change is required.

## Scope

Android only, matching the spec. iOS is intentionally not included in this fork's
`capacitor` config. If iOS support is later required, port `ios/` from upstream
v1.2.26 and add an `ios` entry to `capacitor` in `package.json`.

## Provenance

- Upstream: `@capacitor-community/background-geolocation@1.2.26` (MIT, © 2021 James Diacono)
- `LICENSE` is preserved from upstream.
- Android package namespace is kept as `com.equimaps.capacitor_background_geolocation`
  for the baseline fork. Task 1.2 introduces the project-owned
  `com.arogyadiet.rider.location` package for the hardened service classes.

## Hardened service package (task 1.2)

The hardened service classes live under `com.arogyadiet.rider.location`
(`android/src/main/java/com/arogyadiet/rider/location/`), matching the app
package `com.arogyadiet.rider` so the design's relative manifest name
`.location.LocationForegroundService` resolves correctly (manifest entries are
authored in task 1.3).

- **Language: Java.** The baseline fork's Android sources are Java and the module's
  `build.gradle` only applies `com.android.library` (no Kotlin plugin), so these
  stubs are Java to match the module's build configuration. The design's
  Kotlin-style signatures map 1:1.
- **Skeleton only.** These are compilable class stubs — package/imports, class
  declarations, method signatures with `TODO(task …)` markers, and shared
  constants. No behaviour yet; that lands in tasks 2.x–5.x.

| File | Role (design Part E.1) |
| --- | --- |
| `LocationConstants` | Intent actions, extras keys and `NOTIFICATION_ID` (Part E.3) |
| `LocationForegroundService` | Started + Foreground lifecycle owner |
| `LocationEngine` | `FusedLocationProviderClient` wrapper |
| `LocationQueue` | Durable bounded fix buffer |
| `SyncWorker` | Drains the queue with retry/backoff |
| `ShiftStateStore` | Durable shift-state persistence |
| `WakeLockManager` | Partial WakeLock scoped to the shift |
| `BootReceiver` | Policy-safe re-arm on boot |
