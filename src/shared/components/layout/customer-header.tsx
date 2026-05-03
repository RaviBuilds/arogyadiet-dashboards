"use client";

import { useState } from "react";
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
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";

interface CustomerHeaderProps {
  userEmail: string;
  userName?: string | null;
}

export function CustomerHeader({ userEmail, userName }: CustomerHeaderProps) {
  const displayString = userName || userEmail || "U";
  const initial = displayString.charAt(0).toUpperCase();
  
  // ADDED: State to control the mobile menu sheet
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  return (
    <header className="flex h-14 items-center gap-3 sm:gap-4 border-b bg-background px-4 lg:h-[60px] lg:px-6 sticky top-0 z-10 w-full overflow-hidden">
      
      {/* WIRED UP: open and onOpenChange state */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetTrigger
          className={cn(
            buttonVariants({ variant: "outline", size: "icon" }),
            "shrink-0 md:hidden",
          )}
        >
          <span className="sr-only">Toggle navigation menu</span>
          <Menu className="h-5 w-5" />
        </SheetTrigger>

        <SheetContent side="left" className="flex flex-col p-0 w-72">
          {/* Accessibility requirements */}
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation Menu</SheetTitle>
            <SheetDescription>
              Quick access to profile, billing, and subscriptions.
            </SheetDescription>
          </SheetHeader>

          <div className="w-full h-full">
            {/* WIRED UP: onNavigate closes the sheet when a link is clicked */}
            <CustomerSidebar isMobile onNavigate={() => setIsSheetOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      {/* THE FIX: Removed w-full, added min-w-0 to allow proper truncation */}
      <div className="flex-1 min-w-0">
        <h1 className="text-base sm:text-xl font-medium truncate">
          Welcome back{userName ? `, ${userName}` : ""}
        </h1>
      </div>

      {/* THE FIX: Added shrink-0 so the avatar never gets pushed off screen */}
      <div className="flex items-center gap-4 shrink-0">
        <div className="hidden sm:flex flex-col items-end text-sm">
          <span className="font-medium leading-none mb-1">
            {userName || "Customer"}
          </span>
          <span className="text-xs text-muted-foreground truncate max-w-[150px]">
            {userEmail}
          </span>
        </div>
        <Avatar className="h-9 w-9 border shadow-sm shrink-0">
          <AvatarFallback className="bg-primary/10 text-primary font-semibold">
            {initial}
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
