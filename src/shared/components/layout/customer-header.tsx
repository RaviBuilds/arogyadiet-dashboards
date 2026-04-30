"use client";

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

  return (
    <header className="flex h-14 items-center gap-4 border-b bg-background px-4 lg:h-[60px] lg:px-6 sticky top-0 z-10 w-full">
      <Sheet>
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
            <CustomerSidebar isMobile />
          </div>
        </SheetContent>
      </Sheet>

      <div className="w-full flex-1">
        <h1 className="text-xl md:text-xl text font-medium truncate">
          Welcome back{userName ? `, ${userName}` : ""}
        </h1>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden sm:flex flex-col items-end text-sm">
          <span className="font-medium leading-none mb-1">
            {userName || "Customer"}
          </span>
          <span className="text-xs text-muted-foreground">{userEmail}</span>
        </div>
        <Avatar className="h-9 w-9 border shadow-sm">
          <AvatarFallback className="bg-primary/10 text-primary font-semibold">
            {initial}
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
