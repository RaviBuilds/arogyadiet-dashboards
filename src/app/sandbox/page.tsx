"use client";

import Script from "next/script";
import { useState } from "react";
import { triggerTestPush } from "./actions";

type OneSignalClient = {
  init: (options: {
    appId: string;
    allowLocalhostAsSecureOrigin?: boolean;
  }) => Promise<void>;
  login: (externalId: string) => Promise<void>;
};

type OneSignalWindow = Window & {
  OneSignalDeferred?: Array<(oneSignal: OneSignalClient) => void | Promise<void>>;
  OneSignal?: OneSignalClient;
};

function getOneSignalWindow(): OneSignalWindow {
  return window as OneSignalWindow;
}

const ONESIGNAL_APP_ID = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
const ONESIGNAL_SCRIPT_SRC =
  "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";

async function getOneSignal(): Promise<OneSignalClient> {
  const oneSignalWindow = getOneSignalWindow();

  if (oneSignalWindow.OneSignal) {
    return oneSignalWindow.OneSignal;
  }

  return new Promise((resolve) => {
    oneSignalWindow.OneSignalDeferred = oneSignalWindow.OneSignalDeferred || [];
    oneSignalWindow.OneSignalDeferred.push((OneSignal) => resolve(OneSignal));
  });
}

export default function SandboxPage() {
  const [userId, setUserId] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState<"init" | "push" | null>(null);
  const [scriptReady, setScriptReady] = useState(false);

  const handleInitAndLink = async () => {
    if (!ONESIGNAL_APP_ID) {
      setStatus("Missing NEXT_PUBLIC_ONESIGNAL_APP_ID in environment.");
      return;
    }

    if (!userId.trim()) {
      setStatus("Enter a Supabase user ID first.");
      return;
    }

    setLoading("init");
    setStatus(null);

    try {
      const OneSignal = await getOneSignal();
      await OneSignal.init({
        appId: ONESIGNAL_APP_ID,
        allowLocalhostAsSecureOrigin: true,
      });
      await OneSignal.login(userId.trim());
      setStatus("Device linked. You can fire a test push.");
    } catch (error) {
      console.warn("OneSignal sandbox init failed:", error);
      setStatus(
        error instanceof Error
          ? `Init failed: ${error.message}`
          : "Init failed. Check the console for details.",
      );
    } finally {
      setLoading(null);
    }
  };

  const handleFirePush = async () => {
    if (!userId.trim()) {
      setStatus("Enter a Supabase user ID first.");
      return;
    }

    setLoading("push");
    setStatus(null);

    try {
      const result = await triggerTestPush(userId.trim());
      if (result.error) {
        setStatus(result.error);
        return;
      }
      setStatus("Server action fired. Check for the push notification.");
    } catch (error) {
      console.warn("Sandbox push action failed:", error);
      setStatus(
        error instanceof Error
          ? `Push failed: ${error.message}`
          : "Push failed. Check the console for details.",
      );
    } finally {
      setLoading(null);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Push Notification Sandbox</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Local dev tool for testing OneSignal on{" "}
          <code className="rounded bg-neutral-100 px-1">localhost:3000</code>.
          Paste a Supabase <code className="rounded bg-neutral-100 px-1">users.id</code>{" "}
          (internal profile ID), link this browser, then trigger a backend push.
        </p>
      </div>

      <label className="flex flex-col gap-2 text-sm font-medium">
        Supabase User ID
        <input
          type="text"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          placeholder="e.g. 8f3c2a1b-..."
          className="rounded-md border border-neutral-300 px-3 py-2 font-normal"
        />
      </label>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={handleInitAndLink}
          disabled={!scriptReady || loading !== null}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading === "init" ? "Linking..." : "1. Initialize & Link Device"}
        </button>

        <button
          type="button"
          onClick={handleFirePush}
          disabled={loading !== null}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading === "push" ? "Sending..." : "2. Fire Server Action"}
        </button>
      </div>

      {status ? (
        <p className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
          {status}
        </p>
      ) : null}

      {ONESIGNAL_APP_ID ? (
        <Script
          src={ONESIGNAL_SCRIPT_SRC}
          strategy="afterInteractive"
          onLoad={() => setScriptReady(true)}
        />
      ) : (
        <p className="text-sm text-amber-700">
          Set <code>NEXT_PUBLIC_ONESIGNAL_APP_ID</code> in{" "}
          <code>.env.local</code> to load OneSignal.
        </p>
      )}
    </main>
  );
}
