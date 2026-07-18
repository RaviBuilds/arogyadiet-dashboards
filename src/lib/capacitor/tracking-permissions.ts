/**
 * Rider tracking-permission orchestration.
 *
 * Continuous background GPS tracking on modern Android (target SDK 34+) needs
 * THREE permissions that the plain `addWatcher` location gate does NOT cover:
 *
 *   1. Foreground location  — "While using the app" (fine/coarse).
 *   2. Background location   — "Allow all the time" (ACCESS_BACKGROUND_LOCATION,
 *                              Android 10+). Without this a one-time / "while in
 *                              use" grant is revoked the instant the rider leaves
 *                              the app, killing the foreground service. This was
 *                              the root cause of "online but GPS inactive".
 *   3. Notifications         — POST_NOTIFICATIONS (Android 13+). Without it the
 *                              persistent tracking notification is suppressed.
 *
 * These must be requested in stages (Android requires foreground location to be
 * granted before background location can be requested, and on Android 11+ the
 * background grant is routed to a Settings screen). This module wraps that flow.
 */

import { Capacitor } from "@capacitor/core";
import {
  BackgroundGeolocation,
  type TrackingPermissionStatus,
} from "@/lib/capacitor/background-geolocation-stub";

export type { TrackingPermissionStatus };

/** All three permissions granted → tracking will survive backgrounding. */
export function isFullyPermitted(status: TrackingPermissionStatus): boolean {
  return (
    status.location === "granted" &&
    status.backgroundLocation === "granted" &&
    status.notifications === "granted"
  );
}

/** On non-native/web, treat as fully permitted (native guards apply elsewhere). */
const WEB_STATUS: TrackingPermissionStatus = {
  location: "granted",
  backgroundLocation: "granted",
  notifications: "granted",
};

/**
 * Reads the current permission status without prompting. Fails open (returns a
 * fully-granted status) if the native method is missing — e.g. an older APK
 * that predates these methods — so the rider is never hard-blocked by an
 * unexpected error.
 */
export async function getTrackingPermissions(): Promise<TrackingPermissionStatus> {
  if (!Capacitor.isNativePlatform()) return WEB_STATUS;
  try {
    return await BackgroundGeolocation.getTrackingPermissionStatus();
  } catch (err) {
    console.error("[tracking-permissions] status check failed:", err);
    return WEB_STATUS;
  }
}

/**
 * Runs the staged permission request flow: notifications → foreground location
 * → background location ("all the time"). Each step is a no-op if already
 * granted. Returns the final status after all prompts complete.
 *
 * On Android 11+ the background-location request opens a Settings screen rather
 * than an in-app dialog; the caller should re-check on app foreground (the
 * onboarding banner does this) and/or guide the rider to "Allow all the time".
 */
export async function ensureTrackingPermissions(): Promise<TrackingPermissionStatus> {
  if (!Capacitor.isNativePlatform()) return WEB_STATUS;

  try {
    // 1. Notifications first — cheap, keeps the FGS notification visible.
    let status = await BackgroundGeolocation.requestNotificationPermission();

    // 2. Foreground location ("While using the app").
    if (status.location !== "granted") {
      status = await BackgroundGeolocation.requestForegroundLocationPermission();
    }

    // 3. Background location ("Allow all the time"). Only meaningful once
    //    foreground is granted; the native method chains it if needed.
    if (status.location === "granted" && status.backgroundLocation !== "granted") {
      status = await BackgroundGeolocation.requestBackgroundLocationPermission();
    }

    return status;
  } catch (err) {
    // Older APK without these methods → fail open so we don't block the rider.
    console.error("[tracking-permissions] request flow failed:", err);
    return getTrackingPermissions();
  }
}
