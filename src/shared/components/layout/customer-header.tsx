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

import { CartSheet } from "@/shared/components/customer/cart-sheet";

import { Avatar, AvatarFallback } from "@/shared/components/ui/avatar";

import { buttonVariants } from "@/shared/components/ui/button";

import { Menu } from "lucide-react";

import { cn } from "@/lib/utils";

import { NotificationBell } from "@/components/shared/NotificationBell";



interface CustomerHeaderProps {

  userEmail: string;

  userName?: string | null;

  userId?: string | null;

}



export function CustomerHeader({

  userEmail,

  userName,

  userId,

}: CustomerHeaderProps) {

  const displayString = userName || userEmail || "U";

  const initial = displayString.charAt(0).toUpperCase();



  // ADDED: State to control the mobile menu sheet

  const [isSheetOpen, setIsSheetOpen] = useState(false);



  return (

    <header className="sticky top-0 z-40 flex h-14 w-full items-center gap-4 overflow-hidden border-b border-slate-200/80 bg-white/95 px-4 shadow-sm backdrop-blur-md supports-backdrop-filter:bg-white/80 lg:h-16 lg:px-6 print:hidden">

      {/* WIRED UP: open and onOpenChange state */}

      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>

        <SheetTrigger

          className={cn(

            buttonVariants({ variant: "outline", size: "icon" }),

            "shrink-0 border-slate-200 bg-white shadow-sm transition-all duration-200 hover:bg-slate-50 md:hidden",

          )}

        >

          <span className="sr-only">Toggle navigation menu</span>

          <Menu className="h-5 w-5 text-slate-700" />

        </SheetTrigger>



        <SheetContent

          side="left"

          className="flex h-full max-h-[100dvh] w-72 flex-col gap-0 overflow-hidden border-r border-slate-200 bg-zinc-950 p-0"

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

            />

          </div>

        </SheetContent>

      </Sheet>



      {/* THE FIX: Removed w-full, added min-w-0 to allow proper truncation */}

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">

        <h1 className="truncate text-base font-semibold tracking-tight text-slate-900 sm:text-lg">

          Welcome back{userName ? `, ${userName}` : ""}

        </h1>

        <p className="hidden text-sm text-slate-500 sm:block">

          Your meal dashboard

        </p>

      </div>



      {/* THE FIX: Added shrink-0 so the avatar never gets pushed off screen */}

      <div className="flex shrink-0 items-center gap-3 sm:gap-4">

        <CartSheet />

        <div className="hidden flex-col items-end sm:flex">

          <span className="mb-1 text-sm font-semibold leading-none tracking-tight text-slate-900">

            {userName || "Customer"}

          </span>

          <span className="max-w-[150px] truncate text-xs text-slate-500">

            {userEmail}

          </span>

        </div>

        {userId ? <NotificationBell userId={userId} /> : null}

        <Avatar className="h-9 w-9 shrink-0 border shadow-sm ring-2 ring-slate-100 transition-all duration-200">

          <AvatarFallback className="bg-primary/10 font-semibold text-primary">

            {initial}

          </AvatarFallback>

        </Avatar>

      </div>

    </header>

  );

}


