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
import { Menu } from "lucide-react";
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

interface AdminNavbarProps {
  userProfile: {
    id: string;
    fullName: string;
    avatarUrl: string;
    roleCode: string;
  };
  email: string;
}

export default function AdminNavbar({ userProfile, email }: AdminNavbarProps) {
  const supabase = createClient();
  const pathname = usePathname();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  // Helper to check if a path is active
  const isActive = (path: string) => pathname.startsWith(path);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200/80 bg-white/95 shadow-sm backdrop-blur-md supports-backdrop-filter:bg-white/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        {/* Left: Brand Logo */}
        <Link
          href="/dashboard"
          className="flex items-center gap-3 transition-all duration-200 hover:opacity-90"
        >
          <Image
            src="/logo.png"
            alt="ArogyaDiet"
            width={100}
            height={28}
            className="h-auto w-auto"
          />
          <span className="hidden text-sm font-semibold tracking-tight text-slate-900 sm:inline-block">
            Admin
          </span>
        </Link>

        {/* Center: Desktop Navigation */}
        <nav className="hidden items-center gap-1 rounded-xl border border-slate-200/60 bg-slate-50/50 p-1 md:flex">
          <Link
            href="/dashboard"
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${isActive("/dashboard") ? "bg-white font-semibold tracking-tight text-primary shadow-sm ring-1 ring-slate-200/80" : "text-slate-500 hover:bg-white/70 hover:text-slate-900"}`}
          >
            Dashboard
          </Link>
          <Link
            href="/customers"
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${isActive("/customers") ? "bg-white font-semibold tracking-tight text-primary shadow-sm ring-1 ring-slate-200/80" : "text-slate-500 hover:bg-white/70 hover:text-slate-900"}`}
          >
            Customers
          </Link>
          <Link
            href="/subscriptions"
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${isActive("/subscriptions") ? "bg-white font-semibold tracking-tight text-primary shadow-sm ring-1 ring-slate-200/80" : "text-slate-500 hover:bg-white/70 hover:text-slate-900"}`}
          >
            Subscriptions
          </Link>
          <Link
            href="/riders"
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${isActive("/riders") ? "bg-white font-semibold tracking-tight text-primary shadow-sm ring-1 ring-slate-200/80" : "text-slate-500 hover:bg-white/70 hover:text-slate-900"}`}
          >
            Riders
          </Link>
          <Link
            href="/operations"
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${isActive("/operations") ? "bg-white font-semibold tracking-tight text-primary shadow-sm ring-1 ring-slate-200/80" : "text-slate-500 hover:bg-white/70 hover:text-slate-900"}`}
          >
            Operations
          </Link>
          <Link
            href="/kitchen-shop"
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${isActive("/kitchen-shop") ? "bg-white font-semibold tracking-tight text-primary shadow-sm ring-1 ring-slate-200/80" : "text-slate-500 hover:bg-white/70 hover:text-slate-900"}`}
          >
            Kitchen & Shop
          </Link>
        </nav>

        {/* Right: Mobile Menu & Avatar */}
        <div className="flex items-center gap-4">
          {userProfile.id ? (
            <NotificationBell userId={userProfile.id} />
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative h-10 w-10 rounded-full border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 hover:shadow-md"
              >
                <Avatar className="h-9 w-9">
                  <AvatarImage src={userProfile.avatarUrl || ""} />
                  <AvatarFallback className="bg-primary/10 font-medium text-primary">
                    {userProfile.fullName?.charAt(0) || "A"}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-64 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
              align="end"
              forceMount
            >
              <DropdownMenuLabel className="px-3 py-3 font-normal">
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-semibold leading-none tracking-tight text-slate-900">
                    {userProfile.fullName}
                  </p>
                  <p className="text-sm leading-none text-slate-500">
                    {email}
                  </p>
                  {userProfile.roleCode ? (
                    <Badge
                      variant="outline"
                      className="w-fit border-emerald-200 bg-emerald-50 text-emerald-700"
                    >
                      {userProfile.roleCode}
                    </Badge>
                  ) : null}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-slate-200/60" />
              <DropdownMenuItem className="cursor-pointer rounded-lg px-3 py-2 transition-all duration-200">
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer rounded-lg px-3 py-2 transition-all duration-200">
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-slate-200/60" />
              <DropdownMenuItem
                onClick={handleLogout}
                className="cursor-pointer rounded-lg px-3 py-2 font-medium text-red-600 transition-all duration-200 hover:bg-red-50 hover:text-red-700"
              >
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 border-slate-200 bg-white shadow-sm transition-all duration-200 hover:bg-slate-50 md:hidden"
              >
                <Menu className="h-5 w-5 text-slate-700" />
                <span className="sr-only">Toggle navigation menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="flex w-[300px] flex-col border-l border-slate-200 bg-white p-0"
            >
              <SheetHeader className="border-b border-slate-200 bg-slate-50/50 px-6 py-5 text-left">
                <SheetTitle className="font-semibold tracking-tight text-slate-900">
                  Menu
                </SheetTitle>
              </SheetHeader>
              <nav className="grid gap-2 p-6">
                <Link
                  href="/dashboard"
                  className={`flex items-center rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 ${isActive("/dashboard") ? "bg-primary/5 font-semibold tracking-tight text-primary ring-1 ring-primary/20" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
                >
                  Dashboard
                </Link>
                <Link
                  href="/customers"
                  className={`flex items-center rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 ${isActive("/customers") ? "bg-primary/5 font-semibold tracking-tight text-primary ring-1 ring-primary/20" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
                >
                  Customers
                </Link>
                <Link
                  href="/subscriptions"
                  className={`flex items-center rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 ${isActive("/subscriptions") ? "bg-primary/5 font-semibold tracking-tight text-primary ring-1 ring-primary/20" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
                >
                  Subscriptions
                </Link>
                <Link
                  href="/riders"
                  className={`flex items-center rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 ${isActive("/riders") ? "bg-primary/5 font-semibold tracking-tight text-primary ring-1 ring-primary/20" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
                >
                  Riders
                </Link>
                <Link
                  href="/operations"
                  className={`flex items-center rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 ${isActive("/operations") ? "bg-primary/5 font-semibold tracking-tight text-primary ring-1 ring-primary/20" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
                >
                  Operations
                </Link>
                <Link
                  href="/kitchen-shop"
                  className={`flex items-center rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 ${isActive("/kitchen-shop") ? "bg-primary/5 font-semibold tracking-tight text-primary ring-1 ring-primary/20" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
                >
                  Kitchen & Shop
                </Link>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
