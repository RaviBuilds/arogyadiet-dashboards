/**
 * Capacitor bridge shim for @capacitor-community/background-geolocation.
 *
 * The upstream package ships no JavaScript runtime entry, so web bundlers
 * (Next.js/Turbopack) can't resolve it directly — hence this local module is
 * aliased in place of the package (see next.config.ts).
 *
 * IMPORTANT: This must delegate to Capacitor's `registerPlugin` rather than
 * throw. The native app loads the deployed web build via `server.url`, so the
 * JavaScript that runs on the device is THIS build. If this module throws (or
 * no-ops), the hardened native LocationForegroundService can never be reached
 * from the device — which is exactly the bug we are fixing.
 *
 * `registerPlugin` is a safe everywhere:
 *   - On a native device it returns a proxy that bridges to the native
 *     @CapacitorPlugin(name = "BackgroundGeolocation") implementation.
 *   - In a plain web browser it returns a proxy whose method calls reject with
 *     "not implemented on web" — but every caller is already guarded by
 *     Capacitor.isNativePlatform(), so those methods are never invoked on web.
 */

import { registerPlugin } from "@capacitor/core";

export interface WatcherOptions {
  backgroundMessage?: string;
  backgroundTitle?: string;
  requestPermissions?: boolean;
  stale?: boolean;
  distanceFilter?: number;
  /** Real rider id (rider_profiles.id). Passed to the native service so it can
   *  upload live location directly to Supabase, independent of the WebView. */
  riderId?: string;
}

export interface Location {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  simulated: boolean;
  bearing: number | null;
  speed: number | null;
  time: number | null;
}

export interface CallbackError extends Error {
  code?: string;
}

export interface BackgroundGeolocationPlugin {
  addWatcher(
    options: WatcherOptions,
    callback: (position?: Location, error?: CallbackError) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
}

/**
 * The real plugin proxy. On native this bridges to the hardened
 * LocationForegroundService via the "BackgroundGeolocation" plugin name; on
 * web it is a proxy whose calls reject (never invoked, due to isNativePlatform
 * guards at every call site).
 */
export const BackgroundGeolocation =
  registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");
