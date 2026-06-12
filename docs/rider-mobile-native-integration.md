# Rider Mobile App - Native Integration Audit & Implementation

## Status: ✅ Complete (Web Codebase Synchronized)

---

## Summary of Changes Made

### 1. Background Geolocation (Already Implemented, Enhanced)

**Files involved:**
- `src/shared/components/rider/rider-status-toggle.tsx` — On Duty toggle starts/stops background GPS
- `src/shared/components/rider/LiveLocationTracker.tsx` — Route-level GPS with session hijack detection
- `src/lib/capacitor/background-geolocation-stub.ts` — Web build stub (existing)

**What was already working:**
- `@capacitor-community/background-geolocation` is properly used with `distanceFilter: 10`
- Foreground service notification: title "Active Delivery Route", message "ArogyaDiet is tracking your route for delivery updates."
- Coordinates are upserted into `rider_live_locations` table via Supabase client
- `removeWatcher` cleanup on Off Duty and component unmount
- Platform guard: `Capacitor.isNativePlatform()` prevents execution on web

**Enhancement added:**
- **Keep Awake** (`@capacitor-community/keep-awake`): Screen stays on while rider is On Duty to prevent GPS interruption. Automatically released when going Off Duty.

### 2. Native Push Notifications (OneSignal)

**Files involved:**
- `src/shared/components/notifications/OneSignalProvider.tsx` — Enhanced with native platform detection
- `src/app/rider/(main)/rider-layout-client.tsx` — Dynamic import of OneSignal
- `src/lib/capacitor/native-notifications.ts` — Native permission utility
- `src/lib/onesignal/server.ts` — Server-side push delivery (unchanged)

**How it works on native:**
- OneSignal Web SDK v16 runs inside the Capacitor WebView
- On native, service workers aren't available, but the SDK falls back to in-page listeners
- Firebase Cloud Messaging (FCM) handles actual background delivery via the Android native layer
- The rider's `user_id` is passed to `OneSignal.login(userId)` mapping push tokens to the rider in OneSignal's system
- Server actions use `sendPushToExternalUserIds([riderId], payload)` to target riders for new order assignments

**Native enhancement:**
- Added `isNativePlatform()` detection to skip service worker path configuration on native
- Added `ensureNativeNotificationPermission()` safety net for Android 13+ POST_NOTIFICATIONS permission

### 3. Android Hardware Back Button

**Files involved:**
- `src/lib/capacitor/native-back-button.ts` — New module
- `src/lib/capacitor/app-stub.ts` — Web build stub
- `src/shared/components/rider/NativeShellProvider.tsx` — New wrapper component

**Behavior:**
- Physical back button navigates backward through Next.js router history
- On root page (no history), calls `App.exitApp()` for clean exit
- Only registers on native platforms

### 4. Native Shell Provider (New)

**File:** `src/shared/components/rider/NativeShellProvider.tsx`

**Wraps the entire rider portal and initializes:**
1. Android back button listener
2. Native notification permission check
3. Viewport meta tag fix for Android keyboard handling

**Integration:** Loaded via dynamic import in `rider-layout-client.tsx`, wraps the entire rider layout in `layout.tsx`.

### 5. Window.alert / Window.confirm Audit

**Result:** ✅ No `window.alert()` or `window.confirm()` calls found in the rider portal or shared components. No bridging to `@capacitor/dialog` is needed.

### 6. Authentication Persistence

**How auth works in the native WebView:**
- Supabase Auth uses `@supabase/ssr` with cookie-based sessions
- `createBrowserClient()` in the WebView uses localStorage for token persistence
- The Capacitor WebView preserves localStorage and cookies across app restarts
- No modification needed — tokens persist seamlessly in the native Android WebView

---

## Build Configuration Changes

### `next.config.ts`
```typescript
serverExternalPackages: [
  "@capacitor-community/background-geolocation",
  "@capacitor-community/keep-awake",
  "@capacitor/app",
],
turbopack: {
  resolveAlias: {
    "@capacitor-community/background-geolocation": "./src/lib/capacitor/background-geolocation-stub.ts",
    "@capacitor-community/keep-awake": "./src/lib/capacitor/keep-awake-stub.ts",
    "@capacitor/app": "./src/lib/capacitor/app-stub.ts",
  },
},
```

### New Stub Files (for web builds)
- `src/lib/capacitor/app-stub.ts`
- `src/lib/capacitor/keep-awake-stub.ts`

---

## NPM Packages Required in `rider-mobile-app` Android Project

These must be installed in the Capacitor native wrapper project:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/app
npm install @capacitor/geolocation
npm install @capacitor-community/background-geolocation
npm install @capacitor-community/keep-awake
```

### Android Permissions (AndroidManifest.xml)

```xml
<!-- Location -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />

<!-- Foreground Service for background GPS -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />

<!-- Keep screen awake -->
<uses-permission android:name="android.permission.WAKE_LOCK" />

<!-- Notifications (Android 13+) -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

<!-- Network -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

### Firebase/OneSignal Setup (Android)

1. Add `google-services.json` from Firebase Console to `android/app/`
2. Configure OneSignal App ID in the native project's config
3. OneSignal Web SDK in the WebView will detect native context and use FCM delivery

---

## Capacitor Config (`capacitor.config.json`)

Already created at project root with:
- App ID: `com.arogyadiet.rider`
- WebDir: `out` (for static export) or use server URL for hybrid mode
- Plugin configs for BackgroundGeolocation, SplashScreen, PushNotifications

---

## Build Verification

✅ `npm run build` passes successfully with all changes.
✅ No TypeScript errors.
✅ All native-only code is properly stubbed for web builds.
✅ All `Capacitor.isNativePlatform()` guards are in place.
