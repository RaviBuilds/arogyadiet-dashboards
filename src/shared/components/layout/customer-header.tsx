"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { CustomerSidebar } from "@/shared/components/layout/customer-sidebar";
import { Avatar, AvatarFallback } from "@/shared/components/ui/avatar";
import { buttonVariants } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Menu, LogOut, Leaf } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

// Dynamically import heavy interactive components that aren't needed for first paint
const CartSheet = dynamic(
  () => import("@/shared/components/customer/cart-sheet").then((m) => m.CartSheet),
  { ssr: false },
);

const NotificationBell = dynamic(
  () => import("@/shared/components/shared/NotificationBell").then((m) => m.NotificationBell),
  { ssr: false },
);

interface CustomerHeaderProps {
  userEmail: string;
  userName?: string | null;
  userPhone?: string | null;
  userId?: string | null;
  customerCategory?: string | null;
}

export function CustomerHeader({
  userEmail,
  userName,
  userPhone,
  userId,
  customerCategory,
}: CustomerHeaderProps) {
  const displayString = userName || userEmail || "U";
  const initial = displayString.charAt(0).toUpperCase();
  const router = useRouter();

  const isKit = customerCategory === "KIT";
  const isAccommodation = customerCategory === "ACCOMMODATION";

  // The wellness-essentials shop is a MEAL-only offering, so KIT and
  // ACCOMMODATION customers never see the cart entry point (matches the
  // sidebar, which already hides the Shop nav group for them).
  const showCart = !isKit && !isAccommodation;

  // ADDED: State to control the mobile menu sheet
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-40 flex h-14 w-full items-center gap-4 overflow-hidden border-b border-slate-200/80 bg-white/95 px-4 shadow-sm backdrop-blur-md supports-backdrop-filter:bg-white/80 lg:h-16 lg:px-6 print:hidden">
      {/* WIRED UP: open and onOpenChange state */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetTrigger
          className={cn(
            buttonVariants({ variant: "outline", size: "icon" }),
            "shrink-0 border-emerald-100 bg-emerald-50 text-emerald-700 shadow-sm transition-all duration-200 hover:bg-emerald-100 md:hidden",
          )}
        >
          <span className="sr-only">Toggle navigation menu</span>
          <Menu className="h-5 w-5" />
        </SheetTrigger>

        <SheetContent
          side="left"
          className="flex h-full max-h-[100dvh] w-72 flex-col gap-0 overflow-hidden border-r border-white/[0.08] bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-800 p-0"
        >
          {/* Accessibility requirements */}
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation Menu</SheetTitle>
            <SheetDescription>
              Quick access to profile, billing, and subscriptions.
            </SheetDescription>
          </SheetHeader>

          <div className="flex h-full min-h-0 flex-1 flex-col">
            {/* WIRED UP: onNavigate closes the sheet when a link is clicked */}
            <CustomerSidebar
              isMobile
              onNavigate={() => setIsSheetOpen(false)}
              customerCategory={customerCategory}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Welcome text section — same time-of-day-aware voice as the
          dashboard's JourneyHeader greeting, with a small leaf mark so the
          header reads as a continuation of that hero rather than a plain
          admin-panel title bar. */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h1 className="flex items-center gap-1.5 truncate text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
          <Leaf className="h-4 w-4 shrink-0 text-emerald-600" />
          Welcome back{userName ? `, ${userName}` : ""}
        </h1>
        <p className="hidden text-sm text-slate-500 sm:block">
          {isKit
            ? "Your KIT dashboard"
            : isAccommodation
              ? "Your stay dashboard"
              : "Your meal dashboard"}
        </p>
      </div>

      {/* Right side actions */}
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {showCart ? <CartSheet /> : null}

        <div className="hidden flex-col items-end sm:flex">
          <span className="mb-1 text-sm font-semibold leading-none tracking-tight text-slate-900">
            {userName || "Customer"}
          </span>
          <span className="max-w-[150px] truncate text-xs text-slate-500">
            {userPhone || userEmail}
          </span>
        </div>

        {userId ? <NotificationBell userId={userId} /> : null}

        {/* Avatar with logout dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2">
              <Avatar className="h-9 w-9 shrink-0 cursor-pointer border border-emerald-200/60 shadow-sm ring-2 ring-emerald-50 transition-all duration-200 hover:ring-emerald-200">
                <AvatarFallback className="bg-emerald-50 font-semibold text-emerald-700">
                  {initial}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              onClick={handleLogout}
              className="cursor-pointer gap-2 text-red-600 focus:bg-red-50 focus:text-red-700"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
