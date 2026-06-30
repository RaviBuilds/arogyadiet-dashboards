"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { NotificationBell } from "@/components/shared/NotificationBell";

const NAV_ITEMS = [
  { label: "Master Catalog", href: "/admin/inventory" },
  { label: "Manufacturing Hub", href: "/admin/inventory/manufacturing" },
  { label: "Product Mapping", href: "/admin/inventory/mappings" },
  { label: "Audit Ledger", href: "/admin/inventory/ledger" },
] as const;

interface InventoryHeaderProps {
  /** Signed-in admin's user id. When present, a NotificationBell is rendered. */
  userId?: string;
}

export default function InventoryHeader({ userId }: InventoryHeaderProps = {}) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (
      href === "/admin/inventory/manufacturing" ||
      href === "/admin/inventory/ledger" ||
      href === "/admin/inventory/mappings"
    ) {
      return pathname.startsWith(href);
    }
    return pathname === href;
  }

  return (
    <header className="sticky top-0 z-50 flex h-16 w-full items-center justify-between border-b bg-white/95 px-6 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="flex items-center">
        <Link href="/admin/inventory" className="flex items-center">
          <Image
            src="/logo.png"
            alt="ArogyaDiet Logo"
            width={140}
            height={40}
            className="object-contain"
            priority
          />
        </Link>
        <div className="mx-4 hidden h-6 w-px bg-slate-200 md:block" />
        <span className="text-sm font-semibold tracking-tight text-slate-700">
          Warehouse System
        </span>
      </div>

      <nav className="hidden items-center space-x-1 md:flex">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-4 py-2 text-sm font-medium transition-colors",
              isActive(item.href)
                ? "bg-slate-100 text-slate-900"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-2">
        {userId ? <NotificationBell userId={userId} /> : null}
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/dashboard">Admin Dashboard</Link>
        </Button>
      </div>
    </header>
  );
}
