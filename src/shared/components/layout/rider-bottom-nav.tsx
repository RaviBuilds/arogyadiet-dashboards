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
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-zinc-200 pb-safe pt-2 px-4 shadow-[0_-5px_15px_-10px_rgba(0,0,0,0.1)] z-50">
      <div className="flex justify-between items-center max-w-md mx-auto mb-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center w-16 h-12 transition-colors rounded-xl",
                isActive ? "text-primary" : "text-zinc-400 hover:text-zinc-600",
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-center p-1.5 rounded-full mb-1 transition-colors",
                  isActive ? "bg-primary/10" : "bg-transparent",
                )}
              >
                <Icon
                  className={cn("h-6 w-6", isActive ? "fill-primary/20" : "")}
                />
              </div>
              <span
                className={cn(
                  "text-[10px] font-bold tracking-wide",
                  isActive ? "text-primary" : "text-zinc-500 font-medium",
                )}
              >
                {item.name}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
