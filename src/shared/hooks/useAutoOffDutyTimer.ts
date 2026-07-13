"use client";

/**
 * useAutoOffDutyTimer
 *
 * Client-side hook that automatically marks the rider Off Duty after 10 minutes
 * of inactivity when:
 *   - No delivery orders are assigned today, OR
 *   - All assigned delivery orders are in terminal status (DELIVERED/FAILED)
 *
 * The timer resets whenever the rider's delivery state changes (e.g., new orders
 * assigned, status changes). If the rider manually marks Off Duty before the
 * timer fires, this hook is a no-op.
 *
 * This provides a resource-saving mechanism so riders who forget to toggle off
 * after their last delivery (or who have no deliveries) are automatically
 * marked off-duty, stopping GPS tracking and saving battery/resources.
 */

import { useEffect, useRef, useCallback } from "react";
import { setRiderOnlineAction } from "@/actions/rider-actions/shiftActions";
import { toast } from "sonner";

const AUTO_OFF_DUTY_DELAY_MS = 10 * 60 * 1000; // 10 minutes

interface UseAutoOffDutyTimerOptions {
  /** Whether the rider is currently On Duty */
  isOnDuty: boolean;
  /** Whether the rider has active (non-terminal) orders today */
  hasActiveOrders: boolean;
  /** Callback when auto-off-duty fires (to sync UI state) */
  onAutoOffDuty: () => void;
}

export function useAutoOffDutyTimer({
  isOnDuty,
  hasActiveOrders,
  onAutoOffDuty,
}: UseAutoOffDutyTimerOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isExecutingRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const executeAutoOffDuty = useCallback(async () => {
    if (isExecutingRef.current) return;
    isExecutingRef.current = true;

    try {
      const result = await setRiderOnlineAction(false);
      if (!result.error) {
        onAutoOffDuty();
        toast.info(
          "You were automatically marked Off Duty due to inactivity. Toggle On Duty to resume.",
          { duration: 8000 },
        );
      }
    } catch (err) {
      console.error("[useAutoOffDutyTimer] Failed to auto off-duty:", err);
    } finally {
      isExecutingRef.current = false;
    }
  }, [onAutoOffDuty]);

  useEffect(() => {
    // Only run when rider is on duty AND has no active orders
    if (!isOnDuty || hasActiveOrders) {
      clearTimer();
      return;
    }

    // Rider is on duty with no active orders — start the 10-minute countdown
    clearTimer();
    timerRef.current = setTimeout(executeAutoOffDuty, AUTO_OFF_DUTY_DELAY_MS);

    return () => {
      clearTimer();
    };
  }, [isOnDuty, hasActiveOrders, clearTimer, executeAutoOffDuty]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);
}
