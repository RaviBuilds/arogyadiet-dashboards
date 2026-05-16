"use client";

import Link from "next/link";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/shared/components/ui/sheet";
import { Button } from "@/shared/components/ui/button";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";

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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background shadow-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        
        {/* Left: Brand Logo */}
        <Link href="/dashboard" className="flex items-center gap-2 text-lg font-semibold md:text-base">
          <Image src="/logo.png" alt="ArogyaDiet" width={100} height={28} className="h-auto w-auto" />
          <span className="hidden sm:inline-block">Admin</span>
        </Link>

        {/* Center: Desktop Navigation */}
        <nav className="hidden items-center gap-6 text-sm font-medium md:flex lg:gap-8">
          <Link href="/dashboard" className="text-muted-foreground transition-colors hover:text-foreground">Dashboard</Link>
          <Link href="/customers" className="text-muted-foreground transition-colors hover:text-foreground">Customers</Link>
          <Link href="/riders" className="text-muted-foreground transition-colors hover:text-foreground">Riders</Link>
          <Link href="/operations" className="text-muted-foreground transition-colors hover:text-foreground">Operations</Link>
          <Link href="/catalog" className="text-muted-foreground transition-colors hover:text-foreground">Kitchen & Shop</Link>
          <Link href="/finance" className="text-muted-foreground transition-colors hover:text-foreground">Finance</Link>
        </nav>

        {/* Right: Mobile Menu & Avatar */}
        <div className="flex items-center space-x-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative h-9 w-9 rounded-full ring-1 ring-border">
                <Avatar className="h-9 w-9">
                  <AvatarImage src={userProfile.avatarUrl || ""} />
                  <AvatarFallback className="bg-primary/10 text-primary font-medium">
                    {userProfile.fullName?.charAt(0) || "A"}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{userProfile.fullName}</p>
                  <p className="text-xs leading-none text-muted-foreground">{email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Profile</DropdownMenuItem>
              <DropdownMenuItem>Settings</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-red-600 font-medium">Log out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="shrink-0 md:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle navigation menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="flex flex-col w-[280px]">
              <SheetHeader className="text-left pb-4 border-b">
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <nav className="grid gap-2 text-base font-medium mt-4">
                <Link href="/dashboard" className="flex items-center gap-4 rounded-md px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground">Dashboard</Link>
                <Link href="/customers" className="flex items-center gap-4 rounded-md px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground">Customers</Link>
                <Link href="/riders" className="flex items-center gap-4 rounded-md px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground">Riders</Link>
                <Link href="/operations" className="flex items-center gap-4 rounded-md px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground">Operations</Link>
                <Link href="/catalog" className="flex items-center gap-4 rounded-md px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground">Kitchen & Shop</Link>
                <Link href="/finance" className="flex items-center gap-4 rounded-md px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground">Finance</Link>
              </nav>
            </SheetContent>
          </Sheet>
        </div>

      </div>
    </header>
  );
}