"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { NotificationBell } from "@/components/shared/NotificationBell";

/**
 * Builds the navigation items by resolving sub-routes from the given base path.
 * The "Master Catalog" link points to the base path itself; others are sub-paths.
 */
function buildNavItems(basePath: string) {
  return [
    { label: "Master Catalog", href: basePath },
    { label: "Manufacturing Hub", href: `${basePath}/manufacturing` },
    { label: "Product Mapping", href: `${basePath}/mappings` },
    { label: "Audit Ledger", href: `${basePath}/ledger` },
    { label: "Shop Products", href: `${basePath}/shop-products` },
  ];
}

interface InventoryHeaderProps {
  /** Signed-in admin's user id. When present, a NotificationBell is rendered. */
  userId?: string;
  /**
   * Base path for all warehouse navigation links.
   * Defaults to `/admin/inventory` for backward compatibility with Admin portal.
   */
  basePath?: string;
  /**
   * Href for the logo link (home of the warehouse section).
   * Defaults to the resolved `basePath`.
   */
  homeHref?: string;
  /**
   * Optional ReactNode rendered on the right side of the header.
   * When provided, replaces the default "Admin Dashboard" button.
   * Use this to supply portal-specific controls (e.g. "Back to Inventory BI").
   */
  endSlot?: ReactNode;
}

export default function InventoryHeader({
  userId,
  basePath = "/admin/inventory",
  homeHref,
  endSlot,
}: InventoryHeaderProps) {
  const pathname = usePathname();
  const navItems = buildNavItems(basePath);
  const resolvedHomeHref = homeHref ?? basePath;

  function isActive(href: string) {
    // For sub-routes (manufacturing, mappings, ledger), match with startsWith.
    // For the base path (Master Catalog), exact match only.
    if (href !== basePath) {
      return pathname.startsWith(href);
    }
    return pathname === href;
  }

  return (
    <header className="sticky top-0 z-50 flex h-16 w-full items-center justify-between border-b bg-white/95 px-6 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="flex items-center">
        <Link href={resolvedHomeHref} className="flex items-center">
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
        {navItems.map((item) => (
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
        {endSlot ?? (
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/dashboard">Admin Dashboard</Link>
          </Button>
        )}
      </div>
    </header>
  );
}
