"use client";

import { useCallback, useEffect, useState } from "react";
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

  useEffect(() => {
    let cancelled = false;

    async function fetchNotifications() {
      setLoading(true);

      try {
        const response = await fetch("/api/notifications", {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
        });

        if (cancelled) return;

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
          setNotifications([]);
          setUnreadCount(0);
          setLoading(false);
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
      } catch (err) {
        if (cancelled) return;
        console.error(
          "NotificationBell fetch error:",
          err instanceof Error ? err.message : formatFetchError(err),
        );
        setNotifications([]);
        setUnreadCount(0);
      }

      if (!cancelled) {
        setLoading(false);
      }
    }

    void fetchNotifications();

    return () => {
      cancelled = true;
    };
  }, [userId]);

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
    <Popover>
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
