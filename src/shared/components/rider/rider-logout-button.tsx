"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { useState } from "react";

export function RiderLogoutButton() {
  const router = useRouter();
  const supabase = createClient();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await supabase.auth.signOut();
    router.push("/rider/login");
    router.refresh();
  };

  return (
    <Button
      onClick={handleLogout}
      variant="destructive"
      disabled={isLoggingOut}
      className="w-fit sm:w-auto font-bold rounded-xl"
    >
      <LogOut className="mr-2 h-4 w-4" />
      {isLoggingOut ? "Logging out..." : "Logout"}
    </Button>
  );
}
