"use client";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/shared/components/ui/button";
import {
  CreditCard,
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
    <nav className="grid items-start px-4 text-sm font-medium gap-2">
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
              "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all",
              isActive
                ? "bg-primary text-white shadow-sm"
                : "text-zinc-400 hover:text-white hover:bg-white/5",
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
}: {
  pathname: string;
  onNavigate?: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-4 pb-4 md:pb-0">
      <div className="flex h-14 items-center border-b border-white/10 px-6 lg:h-[60px]">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 font-bold text-xl text-white"
          onClick={() => onNavigate && onNavigate()}
        >
          <div className="flex items-center justify-center w-full h-full">
            <img
              src="/logo.png"
              alt="ArogyaDiet"
              className="h-17 w-auto object-contain px-2 py-1 rounded-md"
            />
          </div>
        </Link>
      </div>

      <div className="flex-1 overflow-auto py-2 space-y-6">
        <NavGroup
          items={mainNavItems}
          pathname={pathname}
          onNavigate={onNavigate}
        />

        <div>
          <div className="px-7 mb-2 text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
            <ShoppingBag className="h-3 w-3" /> Shop
          </div>
          <NavGroup
            items={shopNavItems}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        </div>

        <div>
          <div className="px-7 mb-2 text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
            <Settings2 className="h-3 w-3" /> Manage Meals
          </div>
          <NavGroup
            items={manageMealItems}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        </div>

        <NavGroup
          items={bottomNavItems}
          pathname={pathname}
          onNavigate={onNavigate}
        />
      </div>

      <div className="mt-auto p-4 border-t border-white/10">
        <Button
          variant="ghost"
          className="w-full justify-start text-zinc-400 hover:text-red-400 hover:bg-red-400/10"
          onClick={onLogout}
        >
          <LogOut className="mr-2 h-4 w-4" /> Logout
        </Button>
      </div>
    </div>
  );
}

export function CustomerSidebar({
  isMobile = false,
  onNavigate,
}: {
  isMobile?: boolean;
  onNavigate?: () => void;
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
        "border-r border-white/10 bg-zinc-950 sticky top-0 shrink-0 rounded-tr-3xl print:hidden",
        isMobile
          ? "w-full h-[80vh]"
          : "hidden md:block md:w-64 lg:w-72 h-[100dvh]",
      )}
    >
      <SidebarContent
        pathname={pathname}
        onNavigate={onNavigate}
        onLogout={handleLogout}
      />
    </div>
  );
}
