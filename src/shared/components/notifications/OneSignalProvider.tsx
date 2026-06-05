"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";
import { dispatchNotificationsRefresh } from "@/lib/notifications/refresh";

type OneSignalClient = {
  init: (options: {
    appId: string;
    safari_web_id?: string;
    notifyButton?: { enable: boolean };
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

declare global {
  interface Window {
    OneSignalDeferred?: Array<(oneSignal: OneSignalClient) => void | Promise<void>>;
    OneSignal?: OneSignalClient;
  }
}

const ONESIGNAL_APP_ID = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
const ONESIGNAL_SCRIPT_SRC =
  "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";

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

export function OneSignalProvider({ userId }: { userId: string | null }) {
  const initStartedRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ONESIGNAL_APP_ID || typeof window === "undefined") return;

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

  useEffect(() => {
    return () => {
      if (lastUserIdRef.current && window.OneSignal) {
        void window.OneSignal.logout().catch((error) => {
          console.warn("OneSignal logout failed gracefully:", error);
        });
        lastUserIdRef.current = null;
      }
    };
  }, []);

  if (!ONESIGNAL_APP_ID) {
    return null;
  }

  return <Script src={ONESIGNAL_SCRIPT_SRC} strategy="afterInteractive" defer />;
}
