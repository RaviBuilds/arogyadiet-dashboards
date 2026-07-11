"use client";

/**
 * useOffDutyReconcile
 *
 * On app foreground (Capacitor `appStateChange`), reads the authoritative
 * `is_online` from Supabase. If the rider has been flipped off-duty server-side
 * (e.g. by auto-off-duty cron or admin action) while a local watcher exists,
 * calls `removeWatcher` (→ native `ACTION_STOP_TRACKING`) to stop native tracking.
 *
 * Treats an already-cleared watcher or already-off state as a no-op (Req 15.7).
 *
 * Requirements: 12.4, 12.5, 15.7
 */

import { useEffect, useRef, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { BackgroundGeolocation } from "@capacitor-community/background-geolocation";
import { createClient } from "@/lib/supabase/client";

interface UseOffDutyReconcileOptions {
  /** The rider's profile ID (rider_profiles.id) */
  riderId: string | null;
  /** Ref or getter for the current local watcher ID */
  getWatcherId: () => string | null;
  /** Callback to clear the local watcher reference after removal */
  onWatcherCleared?: () => void;
}

/**
 * Hook that reconciles native tracking state with the server's `is_online`
 * flag whenever the app returns to the foreground.
 */
export function useOffDutyReconcile({
  riderId,
  getWatcherId,
  onWatcherCleared,
}: UseOffDutyReconcileOptions) {
  // Prevent concurrent reconcile runs from overlapping
  const isReconcilingRef = useRef(false);

  const reconcile = useCallback(async () => {
    // Guard: no rider ID means we can't check anything
    if (!riderId) return;

    // Guard: no local watcher → already stopped, no-op (Req 15.7)
    const watcherId = getWatcherId();
    if (!watcherId) return;

    // Guard: prevent concurrent reconcile attempts
    if (isReconcilingRef.current) return;
    isReconcilingRef.current = true;

    try {
      const supabase = createClient();

      // Read authoritative is_online from server
      const { data, error } = await supabase
        .from("rider_profiles")
        .select("is_online")
        .eq("id", riderId)
        .maybeSingle();

      if (error) {
        console.error("[useOffDutyReconcile] Failed to read is_online:", error.message);
        return;
      }

      // If server says rider is off-duty, stop native tracking
      if (data && data.is_online === false) {
        try {
          await BackgroundGeolocation.removeWatcher({ id: watcherId });
          onWatcherCleared?.();
          console.log(
            "[useOffDutyReconcile] Stopped native tracking — server is_online=false",
          );
        } catch (err) {
          console.error(
            "[useOffDutyReconcile] Failed to removeWatcher:",
            err,
          );
        }
      }
      // If is_online=true or data is null, no-op — tracking stays as-is
    } finally {
      isReconcilingRef.current = false;
    }
  }, [riderId, getWatcherId, onWatcherCleared]);

  useEffect(() => {
    // Only run on native platforms (web stubs are no-ops anyway)
    if (!Capacitor.isNativePlatform()) return;
    if (!riderId) return;

    let listenerHandle: { remove: () => Promise<void> } | null = null;

    async function setup() {
      listenerHandle = await App.addListener(
        "appStateChange",
        ({ isActive }) => {
          // isActive=true means the app just came to the foreground
          if (isActive) {
            reconcile();
          }
        },
      );
    }

    setup();

    return () => {
      listenerHandle?.remove();
    };
  }, [riderId, reconcile]);
}
