"use client";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/shared/components/ui/button";
import {
  CalendarCheck,
  CreditCard,
  History,
  LogOut,
  MapPin,
  User,
  Utensils,
  Settings2,
  LayoutDashboard,
  ShoppingCart,
  ShoppingBag,
  PackageSearch,
  ClipboardList,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type NavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
};

const mainNavItems: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "My Profile", href: "/profile", icon: User },
  { name: "My Meals", href: "/meals", icon: PackageSearch },
  { name: "New Subscription", href: "/subscription", icon: ShoppingCart },
];

const shopNavItems: NavItem[] = [
  { name: "Browse Shop", href: "/shop", icon: ShoppingBag },
  { name: "My Orders", href: "/shop/orders", icon: ClipboardList },
];

const manageMealItems: NavItem[] = [
  {
    name: "Meal Planner",
    href: "/subscription/manage/planner",
    icon: Utensils,
  },
  {
    name: "Delivery Address",
    href: "/subscription/manage/address",
    icon: MapPin,
  },
];

const kitNavItems: NavItem[] = [
  { name: "KIT Tracker", href: "/kit-tracker", icon: CalendarCheck },
  { name: "KIT History", href: "/kit-history", icon: History },
];

const bottomNavItems: NavItem[] = [
  { name: "Billing", href: "/subscription/manage/billing", icon: CreditCard },
];

function NavGroup({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="grid items-start gap-1.5 px-3 text-sm font-medium">
      {items.map((item) => {
        const Icon = item.icon;
        let isActive = false;
        if (item.href === "/subscription") {
          isActive =
            pathname === "/subscription" ||
            pathname.startsWith("/subscription/checkout");
        } else if (item.href === "/shop") {
          isActive =
            pathname === "/shop" || pathname === "/shop/checkout";
        } else {
          isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
        }
        return (
          <Link
            key={item.name}
            href={item.href}
            onClick={() => onNavigate && onNavigate()}
            className={cn(
              "flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-200",
              isActive
                ? "bg-primary font-semibold text-primary-foreground shadow-sm ring-1 ring-primary/30"
                : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100",
            )}
          >
            <Icon className="h-4 w-4" />
            {item.name}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarContent({
  pathname,
  onNavigate,
  onLogout,
  customerCategory,
}: {
  pathname: string;
  onNavigate?: () => void;
  onLogout: () => void;
  customerCategory?: string | null;
}) {
  const isKit = customerCategory === "KIT";

  // Filter nav items for KIT customers — hide meal/shop-related items
  const filteredMainNavItems = isKit
    ? mainNavItems.filter((item) => !["New Subscription", "My Meals"].includes(item.name))
    : mainNavItems;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center border-b border-white/[0.08] px-6 py-5 lg:h-[60px]">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 font-bold text-xl text-white"
          onClick={() => onNavigate && onNavigate()}
        >
          <div className="flex h-full w-full items-center justify-center">
            <img
              src="/logo.png"
              alt="ArogyaDiet"
              className="h-12 w-auto rounded-md object-contain px-2 py-1"
            />
          </div>
        </Link>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain py-4">
        <NavGroup
          items={filteredMainNavItems}
          pathname={pathname}
          onNavigate={onNavigate}
        />

        {isKit && (
          <div>
            <div className="mb-2 flex items-center gap-2 px-5 text-xs font-medium uppercase tracking-wider text-zinc-500">
              <CalendarCheck className="h-3 w-3" /> KIT Tracker
            </div>
            <NavGroup
              items={kitNavItems}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          </div>
        )}

        {!isKit && (
          <div>
            <div className="mb-2 flex items-center gap-2 px-5 text-xs font-medium uppercase tracking-wider text-zinc-500">
              <ShoppingBag className="h-3 w-3" /> Shop
            </div>
            <NavGroup
              items={shopNavItems}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          </div>
        )}

        {!isKit && (
          <div>
            <div className="mb-2 flex items-center gap-2 px-5 text-xs font-medium uppercase tracking-wider text-zinc-500">
              <Settings2 className="h-3 w-3" /> Manage Meals
            </div>
            <NavGroup
              items={manageMealItems}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          </div>
        )}

        <NavGroup
          items={bottomNavItems}
          pathname={pathname}
          onNavigate={onNavigate}
        />
      </div>

      <div className="z-10 mt-auto shrink-0 border-t border-white/[0.08] bg-zinc-950 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 rounded-xl text-zinc-400 transition-all duration-200 hover:bg-red-500/10 hover:text-red-400"
          onClick={onLogout}
        >
          <LogOut className="h-4 w-4" /> Logout
        </Button>
      </div>
    </div>
  );
}

export function CustomerSidebar({
  isMobile = false,
  onNavigate,
  customerCategory,
}: {
  isMobile?: boolean;
  onNavigate?: () => void;
  customerCategory?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <div
      className={cn(
        "sticky top-0 shrink-0 rounded-tr-3xl border-r border-white/[0.08] bg-zinc-950 shadow-xl shadow-black/20 print:hidden",
        isMobile
          ? "flex h-full min-h-0 w-full flex-col overflow-hidden"
          : "hidden h-[100dvh] md:block md:w-64 lg:w-72",
      )}
    >
      <SidebarContent
        pathname={pathname}
        onNavigate={onNavigate}
        onLogout={handleLogout}
        customerCategory={customerCategory}
      />
    </div>
  );
}
