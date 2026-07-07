"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { NOTIFICATIONS_REFRESH_EVENT } from "@/lib/notifications/refresh";

const POLL_INTERVAL_MS = 30_000;

type NotificationRecord = {
  id: string;
  user_id: string;
  title: string;
  message: string;
  action_url: string | null;
  is_read: boolean;
  created_at: string;
  type?: string;
};

export interface NotificationBellProps {
  userId?: string;
}

function formatFetchError(detail: unknown): string {
  if (detail == null) return "Unknown error";
  if (typeof detail === "string") return detail;
  if (detail instanceof Error) return detail.message;
  if (typeof detail === "object" && "error" in detail) {
    const err = (detail as { error?: unknown }).error;
    if (typeof err === "string") return err;
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return "Failed to load notifications";
  }
}

export function NotificationBell({ userId }: NotificationBellProps) {
  const router = useRouter();

  const [notifications, setNotifications] = useState<NotificationRecord[]>(
    [],
  );
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const hasLoadedOnceRef = useRef(false);
  // [Req 12.5, 12.6] Prevents concurrent/rapid duplicate fetches — e.g. the
  // mount effect and a near-simultaneous popover-open or refresh-event
  // trigger — from firing two overlapping requests to /api/notifications.
  // Legitimate distinct triggers (mount, refresh event, popover open, poll
  // interval) are preserved; only overlapping in-flight calls are collapsed.
  const inFlightRef = useRef(false);

  const fetchNotifications = useCallback(
    async (options?: { silent?: boolean }) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      const silent = options?.silent ?? false;

      if (!silent) {
        setLoading(true);
      }

      try {
        const response = await fetch("/api/notifications", {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          let detail: unknown = null;
          try {
            detail = await response.json();
          } catch {
            detail = { status: response.status, statusText: response.statusText };
          }
          console.error(
            "NotificationBell fetch error:",
            formatFetchError(detail),
          );
          if (!silent) {
            setNotifications([]);
            setUnreadCount(0);
          }
          return;
        }

        const payload = (await response.json()) as {
          notifications?: NotificationRecord[];
          unreadCount?: number;
        };

        const rows = payload.notifications ?? [];
        setNotifications(rows);
        setUnreadCount(
          payload.unreadCount ?? rows.filter((n) => !n.is_read).length,
        );
        hasLoadedOnceRef.current = true;
      } catch (err) {
        console.error(
          "NotificationBell fetch error:",
          err instanceof Error ? err.message : formatFetchError(err),
        );
        if (!silent) {
          setNotifications([]);
          setUnreadCount(0);
        }
      } finally {
        inFlightRef.current = false;
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void fetchNotifications();
  }, [userId, fetchNotifications]);

  useEffect(() => {
    const handleRefresh = () => {
      void fetchNotifications({ silent: hasLoadedOnceRef.current });
    };
    window.addEventListener(NOTIFICATIONS_REFRESH_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(NOTIFICATIONS_REFRESH_EVENT, handleRefresh);
    };
  }, [fetchNotifications]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void fetchNotifications({ silent: true });
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [fetchNotifications]);

  const handlePopoverOpenChange = useCallback(
    (open: boolean) => {
      setPopoverOpen(open);
      if (open) {
        void fetchNotifications({ silent: hasLoadedOnceRef.current });
      }
    },
    [fetchNotifications],
  );

  const handleNotificationClick = useCallback(
    (notification: NotificationRecord) => {
      if (!notification.is_read) {
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notification.id ? { ...n, is_read: true } : n,
          ),
        );
        setUnreadCount((c) => Math.max(0, c - 1));

        void fetch("/api/notifications", {
          method: "PATCH",
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ id: notification.id }),
        }).then(async (response) => {
          if (!response.ok) {
            let detail: unknown = null;
            try {
              detail = await response.json();
            } catch {
              detail = {
                status: response.status,
                statusText: response.statusText,
              };
            }
            console.error(
              "NotificationBell mark read error:",
              formatFetchError(detail),
            );
          }
        });
      }

      if (notification.action_url) {
        router.push(notification.action_url);
      }
    },
    [router],
  );

  const badgeLabel = unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <Popover open={popoverOpen} onOpenChange={handlePopoverOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none"
            >
              {badgeLabel}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Notifications</h2>
        </div>
        <ScrollArea className="h-[300px]">
          {loading ? (
            <p className="text-muted-foreground px-4 py-8 text-center text-sm">
              Loading...
            </p>
          ) : notifications.length === 0 ? (
            <p className="text-muted-foreground px-4 py-8 text-center text-sm">
              No new notifications
            </p>
          ) : (
            <div className="flex flex-col">
              {notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => handleNotificationClick(notification)}
                  className={cn(
                    "flex w-full gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/50",
                    !notification.is_read &&
                      "bg-blue-50/50 dark:bg-blue-950/30",
                  )}
                >
                  {!notification.is_read && (
                    <span
                      className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-500"
                      aria-hidden
                    />
                  )}
                  <div
                    className={cn(
                      "min-w-0 flex-1",
                      notification.is_read && "pl-5",
                    )}
                  >
                    <p className="font-semibold text-sm leading-snug">
                      {notification.title}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-sm line-clamp-2">
                      {notification.message}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {formatDistanceToNow(new Date(notification.created_at), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
