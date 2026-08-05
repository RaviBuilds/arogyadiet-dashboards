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
import {
  Menu,
  LayoutDashboard,
  Users,
  Truck,
  User,
  CreditCard,
  Settings2,
  ShoppingBag,
  Package,
  ClipboardList,
  Activity,
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
import { Badge } from "@/shared/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { NotificationBell } from "@/components/shared/NotificationBell";
import {
  isDietitianLevel,
  landingRouteFor,
  hasGroupAccess,
  type AccessConfiguration,
} from "@/lib/auth/adminAccessCore";

interface FranchiseNavbarProps {
  userProfile: {
    id: string;
    fullName: string;
    avatarUrl: string;
    roleCode: string;
    franchiseId: string;
    franchiseName: string;
  };
  email: string;
  /**
   * Resolved Access_Level configuration of the signed-in franchise user, with
   * the Franchise_Owner override already applied by the layout (Req 21.6). Only
   * the `dietitian` level changes what is rendered; every other level (and an
   * absent config) keeps the full item list exactly as before.
   */
  config?: AccessConfiguration;
}

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/riders", label: "Riders", icon: Truck },
  { href: "/operations", label: "Operations", icon: Settings2 },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/shop-products", label: "Shop Products", icon: ShoppingBag },
  { href: "/profile", label: "Profile", icon: User },
];

/**
 * The only items a Franchise Dietitian may reach (Req 5.4, 23.1) — the same
 * three prefixes the middleware allow-list permits.
 */
const DIETITIAN_NAV_ITEMS: typeof NAV_ITEMS = [
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/log-customer", label: "Log Customer", icon: ClipboardList },
  { href: "/profile", label: "Profile", icon: User },
];

export default function FranchiseNavbar({
  userProfile,
  email,
  config,
}: FranchiseNavbarProps) {
  const supabase = createClient();
  const pathname = usePathname();

  const isDietitian = config != null && isDietitianLevel(config);
  // Req 24.1, 24.3: the Dietitian Activity link is shown to any franchise
  // user whose Access_Level grants the customers group (including the
  // Franchise_Owner, whose resolved config is always full access) — never to
  // a Franchise Dietitian, who has no group access at all.
  const canViewDietitianActivity =
    !isDietitian && config != null && hasGroupAccess(config, "customers");
  const baseNavItems = canViewDietitianActivity
    ? [
        ...NAV_ITEMS.slice(0, 2),
        { href: "/dietitian-activity", label: "Dietitian Activity", icon: Activity },
        ...NAV_ITEMS.slice(2),
      ]
    : NAV_ITEMS;
  const visibleNavItems = isDietitian ? DIETITIAN_NAV_ITEMS : baseNavItems;
  // A Dietitian cannot reach /dashboard, so the brand link points at their
  // landing route; every other level keeps /dashboard.
  const homeHref = isDietitian ? landingRouteFor("dietitian") : "/dashboard";

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const isActive = (path: string) => pathname.startsWith(path);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/40 bg-white/70 shadow-[0_4px_30px_rgb(0,0,0,0.03)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Left: Brand + Franchise Name */}
        <Link href={homeHref} className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="ArogyaDiet"
            width={90}
            height={24}
            className="h-auto w-auto"
          />
          <Badge variant="outline" className="hidden sm:inline-flex text-[10px] font-semibold border-primary/30 text-primary bg-primary/5">
            {userProfile.franchiseName}
          </Badge>
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
              </Link>
            );
          })}
        </nav>

        {/* Right: Notifications + Avatar + Mobile Menu */}
        <div className="flex items-center space-x-3">
          {userProfile.id ? (
            <NotificationBell userId={userProfile.id} showPopupToggle />
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
                    {userProfile.fullName?.charAt(0) || "F"}
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
                  <Badge variant="outline" className="w-fit mt-1 text-[10px]">
                    {userProfile.franchiseName}
                  </Badge>
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
                <span className="sr-only">Toggle navigation</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="flex flex-col w-[280px]">
              <SheetHeader className="text-left pb-4 border-b">
                <SheetTitle>{userProfile.franchiseName}</SheetTitle>
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
