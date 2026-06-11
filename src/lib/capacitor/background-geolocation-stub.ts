/**
 * Stub for @capacitor-community/background-geolocation.
 *
 * This package is native-only (Android/iOS) with no JavaScript implementation.
 * During web builds (Next.js/Turbopack), this stub is resolved instead.
 * All actual usage is guarded by Capacitor.isNativePlatform() checks,
 * so this code never executes in practice.
 */

export interface WatcherOptions {
  backgroundMessage?: string;
  backgroundTitle?: string;
  requestPermissions?: boolean;
  stale?: boolean;
  distanceFilter?: number;
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

function throwNativeOnly(): never {
  throw new Error(
    "@capacitor-community/background-geolocation is only available on native platforms.",
  );
}

export const BackgroundGeolocation: BackgroundGeolocationPlugin = {
  addWatcher: () => throwNativeOnly(),
  removeWatcher: () => throwNativeOnly(),
  openSettings: () => throwNativeOnly(),
};
