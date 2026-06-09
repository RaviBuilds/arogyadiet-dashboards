"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface CustomerLogoutButtonProps {
  className?: string;
}

export function CustomerLogoutButton({ className }: CustomerLogoutButtonProps) {
  const router = useRouter();
  const supabase = createClient();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <Button
      onClick={handleLogout}
      variant="outline"
      disabled={isLoggingOut}
      className={cn(
        "shrink-0 border-red-200 text-red-600 transition-all duration-200 hover:bg-red-50 hover:text-red-700",
        className,
      )}
    >
      <LogOut className="mr-2 h-4 w-4" />
      {isLoggingOut ? "Logging out..." : "Logout"}
    </Button>
  );
}
