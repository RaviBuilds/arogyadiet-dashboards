"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import {
  Menu,
  LayoutDashboard,
  Users,
  CreditCard,
  Truck,
  Settings2,
  ShoppingBag,
  Building2,
  ClipboardList,
  User,
} from "lucide-react";
import Image from "next/image";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/shared/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";
import { NotificationBell } from "@/components/shared/NotificationBell";
import { FranchiseRequestNavBadge } from "@/shared/components/admin/FranchiseRequestNavBadge";
import {
  hasGroupAccess,
  isDietitianLevel,
  landingRouteFor,
  type AccessConfiguration,
  type OperationsGroup,
} from "@/lib/auth/adminAccessCore";

interface AdminNavbarProps {
  userProfile: {
    id: string;
    fullName: string;
    avatarUrl: string;
    roleCode: string;
  };
  email: string;
  // Nav items are filtered by this configuration. When absent, only neutral
  // items show.
  config?: AccessConfiguration;
}

const NAV_ITEMS: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  // Operations group this item belongs to; undefined => neutral (always shown
  // to admins who reach the layout, e.g. Dashboard).
  group?: OperationsGroup;
}[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/customers", label: "Customers", icon: Users, group: "customers" },
  { href: "/subscriptions", label: "Subscriptions", icon: CreditCard, group: "subscriptions" },
  { href: "/riders", label: "Riders", icon: Truck, group: "riders" },
  { href: "/operations", label: "Operations", icon: Settings2, group: "operations" },
  { href: "/kitchen-shop", label: "Shop Products", icon: ShoppingBag, group: "shop_products" },
  { href: "/franchises", label: "Franchises", icon: Building2, group: "franchises" },
];

/**
 * The only items a Dietitian may reach (Req 5.4) — the same three prefixes the
 * middleware allow-list permits. Rendered instead of NAV_ITEMS, never merged
 * with it, so no operations item can leak into a Dietitian's navbar.
 */
const DIETITIAN_NAV_ITEMS: typeof NAV_ITEMS = [
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/log-customer", label: "Log Customer", icon: ClipboardList },
  { href: "/profile", label: "Profile", icon: User },
];

export default function AdminNavbar({
  userProfile,
  email,
  config,
}: AdminNavbarProps) {
  const supabase = createClient();
  const pathname = usePathname();

  const isDietitian = config != null && isDietitianLevel(config);

  // UI-only gating (server guards are the real barrier): a Dietitian gets the
  // three allow-listed items; everyone else keeps the previous behavior — show
  // neutral items and any group the configuration permits; when config is
  // absent, show neutral only.
  const visibleNavItems = isDietitian
    ? DIETITIAN_NAV_ITEMS
    : NAV_ITEMS.filter(
        (item) =>
          item.group == null ||
          (config != null && hasGroupAccess(config, item.group)),
      );

  // The brand link must not point at a route the Dietitian cannot reach; every
  // other level keeps /dashboard exactly as before.
  const homeHref = isDietitian ? landingRouteFor("dietitian") : "/dashboard";

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const isActive = (path: string) => pathname.startsWith(path);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/95 backdrop-blur-sm shadow-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Left: Brand + Admin Badge */}
        <Link href={homeHref} className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="ArogyaDiet"
            width={90}
            height={24}
            className="h-auto w-auto"
          />
          <span className="hidden sm:inline-block text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/5 px-2 py-0.5 rounded-full border border-primary/20">
            {isDietitian ? "Dietitian" : "Admin"}
          </span>
        </Link>

        {/* Center: Desktop Navigation */}
        <nav className="hidden items-center gap-1 text-sm lg:flex">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-all duration-200 ${
                  active
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="font-medium text-xs">{item.label}</span>
                {item.href === "/franchises" && (
                  <FranchiseRequestNavBadge className="ml-0.5" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Right: Notification Bell, Avatar & Mobile Menu */}
        <div className="flex items-center space-x-3">
          {userProfile.id ? (
            <NotificationBell userId={userProfile.id} />
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative h-9 w-9 rounded-full ring-1 ring-slate-200"
              >
                <Avatar className="h-9 w-9">
                  <AvatarImage src={userProfile.avatarUrl || ""} />
                  <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
                    {userProfile.fullName?.charAt(0) || "A"}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">
                    {userProfile.fullName}
                  </p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {email}
                  </p>
                  {userProfile.roleCode ? (
                    <Badge variant="outline" className="w-fit mt-1 text-[10px]">
                      {userProfile.roleCode}
                    </Badge>
                  ) : null}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/profile">Profile & Settings</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleLogout}
                className="text-red-600 font-medium"
              >
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="shrink-0 lg:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle navigation menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="flex flex-col w-[280px]">
              <SheetHeader className="text-left pb-4 border-b">
                <SheetTitle>Admin Menu</SheetTitle>
              </SheetHeader>
              <nav className="grid gap-1 text-sm mt-4">
                {visibleNavItems.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                        active
                          ? "bg-slate-900 text-white"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                      {item.href === "/franchises" && (
                        <FranchiseRequestNavBadge className="ml-auto" />
                      )}
                    </Link>
                  );
                })}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
