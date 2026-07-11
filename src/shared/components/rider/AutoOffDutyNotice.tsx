"use client";

/**
 * AutoOffDutyNotice
 *
 * Shows a one-time, non-blocking toast when the rider opens the app and
 * discovers they were automatically marked off duty (e.g., by the auto
 * off-duty cron after all deliveries completed).
 *
 * Detection logic:
 * - When the rider is online, a sessionStorage flag is set.
 * - When the rider is offline and the flag exists, a toast is shown once
 *   per session, then the flag is cleared.
 *
 * This adds no new screen and does not alter the On_Duty_Toggle position,
 * labels, or behavior.
 */

import { useEffect, useRef } from "react";
import { toast } from "sonner";

const SESSION_KEY_WAS_ONLINE = "rider_was_online";
const SESSION_KEY_NOTICE_SHOWN = "rider_auto_off_duty_notice_shown";

interface AutoOffDutyNoticeProps {
  isOnline: boolean;
}

export function AutoOffDutyNotice({ isOnline }: AutoOffDutyNoticeProps) {
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    if (typeof window === "undefined") return;

    if (isOnline) {
      // Rider is currently online — record this so we can detect auto off-duty later
      sessionStorage.setItem(SESSION_KEY_WAS_ONLINE, "true");
      // Clear any previously shown notice flag so it can fire again next time
      sessionStorage.removeItem(SESSION_KEY_NOTICE_SHOWN);
      return;
    }

    // Rider is offline — check if they were previously online in this session
    const wasOnline = sessionStorage.getItem(SESSION_KEY_WAS_ONLINE);
    const alreadyShown = sessionStorage.getItem(SESSION_KEY_NOTICE_SHOWN);

    if (wasOnline && !alreadyShown) {
      toast.info(
        "You were automatically marked off duty because all deliveries were completed.",
        { duration: 6000 },
      );
      // Prevent repeated shows this session
      sessionStorage.setItem(SESSION_KEY_NOTICE_SHOWN, "true");
      sessionStorage.removeItem(SESSION_KEY_WAS_ONLINE);
    }
  }, [isOnline]);

  // Renders nothing — purely side-effect driven
  return null;
}
