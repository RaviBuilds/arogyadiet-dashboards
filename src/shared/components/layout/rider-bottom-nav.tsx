"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map, LayoutDashboard, Wallet, User } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { name: "Home", href: "/dashboard", icon: LayoutDashboard },
  { name: "Route", href: "/route", icon: Map },
  { name: "Earnings", href: "/payout", icon: Wallet },
  { name: "Profile", href: "/profile", icon: User },
];

export function RiderBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-200 bg-white/95 px-2 pt-1.5 pb-safe backdrop-blur-md shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.12)]">
      <div className="mx-auto flex max-w-md items-center justify-between lg:max-w-2xl">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");

          return (
            <Link
              key={item.name}
              href={item.href}
              // Native-app-sized tap target (min 48px tall) instead of a
              // link that merely looks like a button.
              className={cn(
                "flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl transition-colors active:scale-95",
                isActive ? "text-primary" : "text-zinc-400",
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-center rounded-full p-1.5 transition-colors",
                  isActive ? "bg-primary/10" : "bg-transparent",
                )}
              >
                <Icon
                  className={cn("h-5 w-5", isActive ? "fill-primary/20" : "")}
                />
              </div>
              <span
                className={cn(
                  "text-[10px] font-bold tracking-wide",
                  isActive ? "text-primary" : "font-medium text-zinc-500",
                )}
              >
                {item.name}
              </span>
              {/* Active indicator dot — a small, familiar native-tab-bar
                  affordance instead of relying on color alone. */}
              <span
                aria-hidden="true"
                className={cn(
                  "h-1 w-1 rounded-full transition-opacity",
                  isActive ? "bg-primary opacity-100" : "opacity-0",
                )}
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
