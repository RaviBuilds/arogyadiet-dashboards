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
import { Button } from "@/components/ui/button";
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

interface MasterNavbarProps {
  userProfile: {
    id: string;
    fullName: string;
    avatarUrl: string;
    roleCode: string;
  };
  email: string;
}

export default function MasterNavbar({ userProfile, email }: MasterNavbarProps) {
  const supabase = createClient();
  const pathname = usePathname();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const isActive = (path: string) => pathname.startsWith(path);

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background shadow-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Left: Brand Logo */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-lg font-semibold md:text-base"
        >
          <Image
            src="/logo.png"
            alt="ArogyaDiet"
            width={100}
            height={28}
            className="h-auto w-auto"
          />
          <span className="hidden sm:inline-block">Master</span>
        </Link>

        {/* Center: Desktop Navigation */}
        <nav className="hidden items-center gap-6 text-sm md:flex lg:gap-8">
          <Link
            href="/dashboard"
            className={`transition-colors hover:text-foreground ${isActive("/dashboard") ? "text-primary font-semibold" : "text-muted-foreground font-medium"}`}
          >
            Dashboard
          </Link>
          <Link
            href="/user-management"
            className={`transition-colors hover:text-foreground ${isActive("/user-management") ? "text-primary font-semibold" : "text-muted-foreground font-medium"}`}
          >
            User Management
          </Link>
          <Link
            href="/finance"
            className={`transition-colors hover:text-foreground ${isActive("/finance") ? "text-primary font-semibold" : "text-muted-foreground font-medium"}`}
          >
            Finance
          </Link>
          <Link
            href="/logs"
            className={`transition-colors hover:text-foreground ${isActive("/logs") ? "text-primary font-semibold" : "text-muted-foreground font-medium"}`}
          >
            Logs
          </Link>
        </nav>

        {/* Right: Mobile Menu & Avatar */}
        <div className="flex items-center space-x-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative h-9 w-9 rounded-full ring-1 ring-border"
              >
                <Avatar className="h-9 w-9">
                  <AvatarImage src={userProfile.avatarUrl || ""} />
                  <AvatarFallback className="bg-primary/10 text-primary font-medium">
                    {userProfile.fullName?.charAt(0) || "M"}
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
                </div>
              </DropdownMenuLabel>
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
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 md:hidden"
              >
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle navigation menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="flex flex-col w-[280px]">
              <SheetHeader className="text-left pb-4 border-b">
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <nav className="grid gap-2 text-base mt-4">
                <Link
                  href="/dashboard"
                  className={`flex items-center gap-4 rounded-md px-3 py-2 hover:bg-muted hover:text-foreground ${isActive("/dashboard") ? "text-primary font-semibold bg-primary/5" : "text-muted-foreground font-medium"}`}
                >
                  Dashboard
                </Link>
                <Link
                  href="/user-management"
                  className={`flex items-center gap-4 rounded-md px-3 py-2 hover:bg-muted hover:text-foreground ${isActive("/user-management") ? "text-primary font-semibold bg-primary/5" : "text-muted-foreground font-medium"}`}
                >
                  User Management
                </Link>
                <Link
                  href="/finance"
                  className={`flex items-center gap-4 rounded-md px-3 py-2 hover:bg-muted hover:text-foreground ${isActive("/finance") ? "text-primary font-semibold bg-primary/5" : "text-muted-foreground font-medium"}`}
                >
                  Finance
                </Link>
                <Link
                  href="/logs"
                  className={`flex items-center gap-4 rounded-md px-3 py-2 hover:bg-muted hover:text-foreground ${isActive("/logs") ? "text-primary font-semibold bg-primary/5" : "text-muted-foreground font-medium"}`}
                >
                  Logs
                </Link>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
