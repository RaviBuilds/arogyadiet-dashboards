"use client";

/**
 * Keep Awake utility for native platforms.
 *
 * Prevents the screen from sleeping while the rider is on an active delivery route.
 * Uses @capacitor-community/keep-awake which is already in package.json.
 *
 * This module uses the stub pattern (see next.config.ts turbopack resolveAlias)
 * so it compiles cleanly on web and only executes real native code on Android.
 */

import { Capacitor } from "@capacitor/core";
import { KeepAwake } from "@capacitor-community/keep-awake";

let isKeptAwake = false;

export async function enableKeepAwake(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (isKeptAwake) return;

  try {
    await KeepAwake.keepAwake();
    isKeptAwake = true;
  } catch (err) {
    console.error("Failed to enable keep awake:", err);
  }
}

export async function disableKeepAwake(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (!isKeptAwake) return;

  try {
    await KeepAwake.allowSleep();
    isKeptAwake = false;
  } catch (err) {
    console.error("Failed to disable keep awake:", err);
  }
}
