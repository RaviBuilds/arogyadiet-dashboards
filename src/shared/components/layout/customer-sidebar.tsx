"use client";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { CalendarDays, CreditCard, LogOut, MapPin, User } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const navItems = [
  { name: "My Profile", href: "/profile", icon: User },
  { name: "Subscriptions", href: "/subscriptions", icon: CalendarDays },
  { name: "Billing", href: "/billing", icon: CreditCard },
];

// Added '?' to isMobile to make it optional, fixing the TS error in layout.tsx
export function CustomerSidebar({ isMobile = false }: { isMobile?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

 const SidebarContent = () => (
   <div className="flex h-full flex-col gap-4">
     {/* 1. Header with White text for dark background */}
     <div className="flex h-14 items-center border-b border-white/10 px-6 lg:h-[60px]">
       <Link
         href="/"
         className="flex items-center gap-2 font-bold text-xl text-white"
       >
         <MapPin className="h-6 w-6 text-primary" />
         <span>ArogyaDiet</span>
       </Link>
     </div>

     <div className="flex-1 overflow-auto py-2">
       <nav className="grid items-start px-4 text-sm font-medium gap-2">
         {navItems.map((item) => {
           const Icon = item.icon;
           const isActive =
             pathname === item.href || pathname.startsWith(item.href + "/");
           return (
             <Link
               key={item.name}
               href={item.href}
               className={cn(
                 "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all",
                 isActive
                   ? "bg-primary text-white shadow-sm" // Active remains Red
                   : "text-zinc-400 hover:text-white hover:bg-white/5", // Inactive is muted gray
               )}
             >
               <Icon className="h-4 w-4" />
               {item.name}
             </Link>
           );
         })}
       </nav>
     </div>

     <div className="mt-auto p-4 border-t border-white/10">
       <Button
         variant="ghost"
         className="w-full justify-start text-zinc-400 hover:text-red-400 hover:bg-red-400/10"
         onClick={handleLogout}
       >
         <LogOut className="mr-2 h-4 w-4" />
         Logout
       </Button>
     </div>
   </div>
 );

  return (
    <div
      className={cn(
        "border-r border-white/10 bg-zinc-950 h-screen sticky top-0 shrink-0 rounded-tr-3xl", // Dark Background
        isMobile ? "w-full" : "hidden md:block md:w-64 lg:w-72",
      )}
    >
      <SidebarContent />
    </div>
  );
}
