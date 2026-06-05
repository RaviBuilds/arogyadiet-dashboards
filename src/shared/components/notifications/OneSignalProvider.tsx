"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

type OneSignalClient = {
  init: (options: {
    appId: string;
    allowLocalhostAsSecureOrigin?: boolean;
    serviceWorkerPath?: string;
  }) => Promise<void>;
  login: (externalId: string) => Promise<void>;
  logout: () => Promise<void>;
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

function isLocalSubdomainDev(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NODE_ENV !== "development") return false;

  const hostname = window.location.hostname;
  return hostname !== "localhost" && hostname.endsWith(".localhost");
}

export function OneSignalProvider({ userId }: { userId: string | null }) {
  const initStartedRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);
  const [shouldLoadScript, setShouldLoadScript] = useState(true);

  useEffect(() => {
    if (isLocalSubdomainDev()) {
      setShouldLoadScript(false);
    }
  }, []);

  useEffect(() => {
    if (!ONESIGNAL_APP_ID || typeof window === "undefined") return;

    if (isLocalSubdomainDev()) {
      console.warn(
        "OneSignal skipped: local subdomain hostname does not match OneSignal site configuration.",
      );
      return;
    }

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
              allowLocalhostAsSecureOrigin: process.env.NODE_ENV === "development",
              serviceWorkerPath: "/OneSignalSDKWorker.js",
            });
            window.OneSignal = OneSignal;
          } catch (err) {
            console.warn("OneSignal initialization caught silently:", err);
            return;
          }
        }

        await syncUser(OneSignal);
      } catch (error) {
        console.warn("OneSignal failed to load gracefully:", error);
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
      console.warn("OneSignal failed to load gracefully:", error);
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

  if (!ONESIGNAL_APP_ID || !shouldLoadScript) {
    return null;
  }

  return <Script src={ONESIGNAL_SCRIPT_SRC} strategy="afterInteractive" defer />;
}
