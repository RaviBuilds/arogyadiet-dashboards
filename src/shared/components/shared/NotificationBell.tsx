"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { createClient } from "@/lib/supabase/client";
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
  userId: string;
}

export function NotificationBell({ userId }: NotificationBellProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [notifications, setNotifications] = useState<NotificationRecord[]>(
    [],
  );
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchNotifications() {
      setLoading(true);

      const { data, error } = await supabase
        .from("notifications")
        .select(
          "id, user_id, title, message, action_url, is_read, created_at, type",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (cancelled) return;

      if (error) {
        console.error("NotificationBell fetch error:", error);
        setNotifications([]);
        setUnreadCount(0);
      } else {
        const rows = (data ?? []) as NotificationRecord[];
        setNotifications(rows);
        setUnreadCount(rows.filter((n) => !n.is_read).length);
      }

      setLoading(false);
    }

    void fetchNotifications();

    return () => {
      cancelled = true;
    };
  }, [userId, supabase]);

  const handleNotificationClick = useCallback(
    (notification: NotificationRecord) => {
      if (!notification.is_read) {
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notification.id ? { ...n, is_read: true } : n,
          ),
        );
        setUnreadCount((c) => Math.max(0, c - 1));

        void supabase
          .from("notifications")
          .update({ is_read: true })
          .eq("id", notification.id)
          .eq("user_id", userId)
          .then(({ error }) => {
            if (error) {
              console.error("NotificationBell mark read error:", error);
            }
          });
      }

      if (notification.action_url) {
        router.push(notification.action_url);
      }
    },
    [router, supabase, userId],
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
