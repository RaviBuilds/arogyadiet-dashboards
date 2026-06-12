"use client";

/**
 * Native Android Back Button Handler
 *
 * Uses @capacitor/app to intercept the hardware back button on Android.
 * Navigates backward through Next.js router history instead of exiting the app.
 * On the last page in history, exits the app cleanly.
 *
 * This module uses the stub pattern (see next.config.ts turbopack resolveAlias)
 * so it compiles cleanly on web and only executes real native code on Android.
 */

import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

let listenerRegistered = false;

export async function registerNativeBackButton(
  routerBack: () => void,
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};
  if (listenerRegistered) return () => {};

  const handler = await App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) {
      routerBack();
    } else {
      App.exitApp();
    }
  });

  listenerRegistered = true;

  return () => {
    handler.remove();
    listenerRegistered = false;
  };
}
