"use client";

import { cn } from "@/lib/utils";
import {
  CalendarCheck,
  CreditCard,
  History,
  MapPin,
  User,
  Utensils,
  Settings2,
  LayoutDashboard,
  ShoppingCart,
  ShoppingBag,
  PackageSearch,
  ClipboardList,
  Droplet,
  FileText,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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

const accommodationNavItems: NavItem[] = [
  { name: "Stay Tracker", href: "/stay-tracker", icon: CalendarCheck },
  { name: "Stay History", href: "/stay-history", icon: History },
];

const accommodationStandaloneNavItems: NavItem[] = [
  { name: "My Health Logs", href: "/health-logs", icon: Droplet },
  { name: "Health Report", href: "/health-report", icon: FileText },
  { name: "Add-on Services", href: "/addon-services", icon: Sparkles },
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
    <nav className="grid items-start gap-1 px-3 text-sm font-medium">
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
              "group relative flex items-center gap-3 rounded-2xl px-3.5 py-2.5 transition-all duration-200",
              isActive
                ? "bg-white text-emerald-950 shadow-md shadow-emerald-950/20"
                : "text-emerald-100/60 hover:bg-white/[0.05] hover:text-white",
            )}
          >
            {/* Active-state accent bar — kept alongside the solid white fill
                below (rather than as the only signal) so the current page is
                unmistakable at a glance, not just a subtle tint shift. */}
            <span
              className={cn(
                "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary transition-all duration-200",
                isActive ? "opacity-100" : "opacity-0",
              )}
            />
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-200",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "bg-white/[0.04] text-emerald-100/50 group-hover:bg-white/[0.08] group-hover:text-emerald-100",
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span className={cn("truncate", isActive && "font-semibold")}>
              {item.name}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarContent({
  pathname,
  onNavigate,
  customerCategory,
}: {
  pathname: string;
  onNavigate?: () => void;
  customerCategory?: string | null;
}) {
  const isKit = customerCategory === "KIT";
  const isAccommodation = customerCategory === "ACCOMMODATION";

  // Filter nav items for KIT/ACCOMMODATION customers — hide meal/shop-related items
  const filteredMainNavItems =
    isKit || isAccommodation
      ? mainNavItems.filter((item) => !["New Subscription", "My Meals"].includes(item.name))
      : mainNavItems;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {/* Ambient depth layers — same technique as LoginBrandPanel / dashboard
          hero, so the sidebar reads as part of the same brand world instead
          of a plain black admin-panel nav. Fixed/absolute, purely
          decorative, sits behind all real content. */}
      <div className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full bg-emerald-400/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-64 w-64 translate-x-1/3 translate-y-1/3 rounded-full bg-lime-300/10 blur-3xl" />

      <div className="relative flex shrink-0 items-center border-b border-white/[0.08] px-6 py-5 lg:h-[60px]">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 font-bold text-xl text-white"
          onClick={() => onNavigate && onNavigate()}
        >
          <div className="flex h-full w-full items-center justify-center rounded-xl bg-white/95 px-2 py-1 shadow-sm">
            <img
              src="/logo.png"
              alt="ArogyaDiet"
              className="h-11 w-auto object-contain"
            />
          </div>
        </Link>
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="relative flex min-h-full flex-col gap-6 py-4">
          <NavGroup
            items={filteredMainNavItems}
            pathname={pathname}
            onNavigate={onNavigate}
          />

          {isKit && (
            <div>
              <div className="mb-2 flex items-center gap-2 px-6 text-[0.65rem] font-semibold uppercase tracking-wider text-emerald-200/50">
                <CalendarCheck className="h-3 w-3" /> KIT Tracker
              </div>
              <NavGroup
                items={kitNavItems}
                pathname={pathname}
                onNavigate={onNavigate}
              />
            </div>
          )}

          {isAccommodation && (
            <div>
              <div className="mb-2 flex items-center gap-2 px-6 text-[0.65rem] font-semibold uppercase tracking-wider text-emerald-200/50">
                <CalendarCheck className="h-3 w-3" /> Stay Tracker
              </div>
              <NavGroup
                items={accommodationNavItems}
                pathname={pathname}
                onNavigate={onNavigate}
              />
            </div>
          )}

          {isAccommodation && (
            <NavGroup
              items={accommodationStandaloneNavItems}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          )}

          {!isKit && !isAccommodation && (
            <div>
              <div className="mb-2 flex items-center gap-2 px-6 text-[0.65rem] font-semibold uppercase tracking-wider text-emerald-200/50">
                <ShoppingBag className="h-3 w-3" /> Shop
              </div>
              <NavGroup
                items={shopNavItems}
                pathname={pathname}
                onNavigate={onNavigate}
              />
            </div>
          )}

          {!isKit && !isAccommodation && (
            <div>
              <div className="mb-2 flex items-center gap-2 px-6 text-[0.65rem] font-semibold uppercase tracking-wider text-emerald-200/50">
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

          {/* Spacer that only ever occupies genuinely LEFTOVER space below
              the nav (flex-1, normal flow — never absolute/fixed), so the
              botanical art inside it can never overlap a real nav row
              regardless of viewport height. On short viewports this
              collapses toward zero height and the art simply doesn't show,
              rather than forcing scroll or bleeding into content above it. */}
          <div className="pointer-events-none relative min-h-[24px] flex-1">
            <SidebarBotanicalArt />
          </div>

          {/* pb-14 keeps this line clear of the bottom-left corner where a
              fixed page-level element (dev/extension indicator) can sit —
              this footer stays fully in normal document flow and never
              overlaps anything outside the sidebar. */}
          <div className="shrink-0 border-t border-white/[0.08] px-6 pb-14 pt-4">
            <p className="text-[0.65rem] leading-relaxed text-emerald-100/40">
              ArogyaDiet — nourishing everyday life.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * SidebarBotanicalArt — the same calm leaf/vine line-art technique used on
 * the login brand panel (LoginBrandPanel.tsx), scaled down for the sidebar's
 * narrower column. Purely decorative → aria-hidden. Gives the empty space
 * below the nav on tall viewports the same textured depth as the rest of the
 * app's dark-green surfaces, instead of a flat, unfinished-looking void.
 */
function SidebarBotanicalArt() {
  return (
    <svg
      aria-hidden="true"
      // Using the plain `opacity-*` utility on the whole element instead of
      // a text-color/[value] slash modifier — the slash-opacity arbitrary
      // value syntax was rendering as fully opaque (a solid dark shape
      // overlapping nav rows) rather than the faint texture intended.
      // `opacity-10` is unambiguous and matches the intended low-opacity
      // "barely there" texture look used on the login brand panel.
      className="pointer-events-none absolute inset-0 h-full w-full text-emerald-200 opacity-10"
      viewBox="0 0 240 300"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
    >
      {/* trailing vine, upper-left of the empty band */}
      <path d="M-10 40 C 40 20, 70 60, 120 30" />
      <path
        d="M40 33c-5-5-13-4-16 2 7 3 13 1 16-2Z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M75 44c6-5 7-13 2-18-6 5-6 13-2 18Z"
        fill="currentColor"
        stroke="none"
      />

      {/* wheat stalk, center */}
      <path d="M150 220 C 145 180, 145 150, 150 120" />
      <path
        d="M150 150c7-4 10-11 8-18-6 3-9 11-8 18Z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M150 164c-7-4-10-11-8-18 6 3 9 11 8 18Z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M150 178c7-4 10-11 8-18-6 3-9 11-8 18Z"
        fill="currentColor"
        stroke="none"
      />

      {/* large calm leaf, bleeding off the bottom-right */}
      <path d="M90 280 C 120 230, 175 218, 215 240" />
      <path
        d="M150 232c15-11 19-30 8-43-14 13-15 32-8 43Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
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

  return (
    <div
      className={cn(
        // Same forest-green gradient as LoginBrandPanel / dashboard hero —
        // the sidebar now visibly belongs to the same brand instead of a
        // generic black admin nav.
        "sticky top-0 shrink-0 overflow-hidden rounded-tr-3xl border-r border-white/[0.08] bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-800 shadow-xl shadow-emerald-950/30 print:hidden",
        isMobile
          ? "flex h-full min-h-0 w-full flex-col overflow-hidden"
          : "hidden h-[100dvh] md:block md:w-64 lg:w-72",
      )}
    >
      <SidebarContent
        pathname={pathname}
        onNavigate={onNavigate}
        customerCategory={customerCategory}
      />
    </div>
  );
}
