"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";
import { dispatchNotificationsRefresh } from "@/lib/notifications/refresh";

// ─── Types ──────────────────────────────────────────────────────────────────────

type OneSignalClient = {
  init: (options: {
    appId: string;
    safari_web_id?: string;
    notifyButton?: { enable: boolean };
    serviceWorkerPath?: string;
  }) => Promise<void>;
  login: (externalId: string) => Promise<void>;
  logout: () => Promise<void>;
  Slidedown?: {
    promptPush: (options?: { force?: boolean }) => Promise<void>;
  };
  Notifications?: {
    isPushSupported: () => boolean;
    permission: boolean;
    addEventListener: (
      event: "foregroundWillDisplay",
      listener: (event: { preventDefault?: () => void }) => void,
    ) => void;
    removeEventListener: (
      event: "foregroundWillDisplay",
      listener: (event: { preventDefault?: () => void }) => void,
    ) => void;
  };
  User?: {
    PushSubscription?: {
      optedIn?: boolean;
    };
  };
};

/**
 * Type for the native OneSignal Cordova/Capacitor plugin.
 * Injected globally at `window.plugins.OneSignal` by onesignal-cordova-plugin
 * at runtime inside the native Android shell. Never imported as a module.
 */
type NativeOneSignalPlugin = {
  initialize: (appId: string) => void;
  login: (externalId: string) => void;
  logout: () => void;
  Notifications: {
    requestPermission: (accepted: boolean) => Promise<void>;
    addEventListener: (
      event: string,
      listener: (data: unknown) => void,
    ) => void;
    removeEventListener: (
      event: string,
      listener: (data: unknown) => void,
    ) => void;
    hasPermission: () => boolean;
  };
  User: {
    pushSubscription: {
      optedIn: boolean;
      id: string | null;
      token: string | null;
    };
  };
};

declare global {
  interface Window {
    OneSignalDeferred?: Array<
      (oneSignal: OneSignalClient) => void | Promise<void>
    >;
    OneSignal?: OneSignalClient;
    plugins?: {
      OneSignal?: NativeOneSignalPlugin;
    };
  }
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const ONESIGNAL_APP_ID = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
const ONESIGNAL_SCRIPT_SRC =
  "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";

// ─── Platform Detection (lazy, client-only) ─────────────────────────────────────

/**
 * Safely checks if we're running inside a Capacitor native shell.
 * This must ONLY be called client-side (inside useEffect or event handlers).
 * Returns false during SSR and on Vercel builds.
 */
function checkIsNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // @capacitor/core sets window.Capacitor when loaded in a native shell
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return cap?.isNativePlatform?.() ?? false;
  } catch {
    return false;
  }
}

// ─── Web SDK Helpers ────────────────────────────────────────────────────────────

function registerForegroundRefreshListener(OneSignal: OneSignalClient) {
  if (!OneSignal.Notifications?.addEventListener) return;

  const onForegroundDisplay = () => {
    dispatchNotificationsRefresh();
  };

  OneSignal.Notifications.addEventListener(
    "foregroundWillDisplay",
    onForegroundDisplay,
  );
}

// ─── Native Plugin Initialization ───────────────────────────────────────────────

/**
 * Initializes the native OneSignal plugin via `window.plugins.OneSignal`.
 *
 * This is the Cordova plugin registered globally by onesignal-cordova-plugin
 * when the Capacitor app boots. It communicates directly with the native
 * Android SDK and FCM — no service workers or web imports needed.
 */
function initializeNativeOneSignal(
  appId: string,
  userId: string | null,
): void {
  const nativeOneSignal = window.plugins?.OneSignal;

  if (!nativeOneSignal) {
    console.warn(
      "[OneSignal] Native plugin not available on window.plugins.OneSignal. " +
        "Ensure onesignal-cordova-plugin is installed in rider-mobile-app.",
    );
    return;
  }

  // Initialize with the OneSignal App ID
  nativeOneSignal.initialize(appId);

  // Prompt for push notification permission (Android 13+ system dialog)
  nativeOneSignal.Notifications.requestPermission(true);

  // Listen for foreground notifications to refresh the in-app bell
  nativeOneSignal.Notifications.addEventListener(
    "foregroundWillDisplay",
    () => {
      dispatchNotificationsRefresh();
    },
  );

  // Map push subscription to the authenticated rider's user_id
  if (userId) {
    nativeOneSignal.login(userId);
  }
}

/**
 * Syncs user identity with the native OneSignal plugin on re-renders.
 */
function syncNativeUser(
  userId: string | null,
  prevUserId: string | null,
): void {
  const nativeOneSignal = window.plugins?.OneSignal;
  if (!nativeOneSignal) return;

  if (userId && userId !== prevUserId) {
    nativeOneSignal.login(userId);
  } else if (!userId && prevUserId) {
    nativeOneSignal.logout();
  }
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function OneSignalProvider({ userId }: { userId: string | null }) {
  const initStartedRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);
  const isNativeRef = useRef<boolean | null>(null);

  // ─── Unified initialization (runs client-side only) ─────────────────────────
  useEffect(() => {
    if (!ONESIGNAL_APP_ID || typeof window === "undefined") return;

    // Lazily detect platform once on first mount
    if (isNativeRef.current === null) {
      isNativeRef.current = checkIsNativePlatform();
    }

    const isNative = isNativeRef.current;

    // ── Native Path ─────────────────────────────────────────────────────────
    if (isNative) {
      if (!initStartedRef.current) {
        initStartedRef.current = true;
        initializeNativeOneSignal(ONESIGNAL_APP_ID, userId);
        lastUserIdRef.current = userId;
      } else {
        syncNativeUser(userId, lastUserIdRef.current);
        lastUserIdRef.current = userId;
      }
      return;
    }

    // ── Web Path ────────────────────────────────────────────────────────────
    const syncUser = async (OneSignal: OneSignalClient) => {
      try {
        if (userId) {
          if (lastUserIdRef.current !== userId) {
            await OneSignal.login(userId);
            lastUserIdRef.current = userId;
          }
          return;
        }

        if (lastUserIdRef.current) {
          await OneSignal.logout();
          lastUserIdRef.current = null;
        }
      } catch (error) {
        console.warn("OneSignal user sync failed gracefully:", error);
      }
    };

    const runWithOneSignal = async (OneSignal: OneSignalClient) => {
      try {
        if (!initStartedRef.current) {
          initStartedRef.current = true;
          try {
            await OneSignal.init({
              appId: ONESIGNAL_APP_ID,
              safari_web_id: process.env.NEXT_PUBLIC_ONESIGNAL_SAFARI_ID,
              notifyButton: { enable: false },
            });

            registerForegroundRefreshListener(OneSignal);

            const canPrompt =
              OneSignal.Slidedown &&
              OneSignal.Notifications?.isPushSupported?.() !== false &&
              !OneSignal.User?.PushSubscription?.optedIn;

            try {
              if (canPrompt && OneSignal.Slidedown) {
                await OneSignal.Slidedown.promptPush();
              }
            } catch (promptError) {
              console.warn("OneSignal permission prompt failed:", promptError);
            }

            window.OneSignal = OneSignal;
          } catch (err) {
            console.warn("OneSignal initialization failed:", err);
            return;
          }
        }

        await syncUser(OneSignal);
      } catch (error) {
        console.warn("OneSignal initialization failed:", error);
      }
    };

    try {
      if (window.OneSignal) {
        void runWithOneSignal(window.OneSignal);
        return;
      }

      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push((OneSignal) => {
        void runWithOneSignal(OneSignal);
      });
    } catch (error) {
      console.warn("OneSignal initialization failed:", error);
    }
  }, [userId]);

  // ─── Cleanup on Unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (!lastUserIdRef.current) return;

      const isNative = isNativeRef.current;

      if (isNative) {
        window.plugins?.OneSignal?.logout();
      } else if (window.OneSignal) {
        void window.OneSignal.logout().catch((error) => {
          console.warn("OneSignal logout failed gracefully:", error);
        });
      }

      lastUserIdRef.current = null;
    };
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (!ONESIGNAL_APP_ID) {
    return null;
  }

  // On native, the Cordova plugin IS the SDK — no script tag needed.
  // We still render the script tag unconditionally on the server/initial render
  // since we can't know the platform at SSR time. On native, the script will
  // simply fail to load (no network needed) and we use window.plugins instead.
  // This is harmless and avoids hydration mismatches.
  return <Script src={ONESIGNAL_SCRIPT_SRC} strategy="afterInteractive" defer />;
}
