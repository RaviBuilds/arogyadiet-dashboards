import { RiderBottomNav } from "@/shared/components/layout/rider-bottom-nav";
import { OneSignalProvider } from "@/shared/components/notifications/OneSignalProvider";
import { NotificationBell } from "@/components/shared/NotificationBell";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function RiderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col relative">
      <OneSignalProvider userId={profile?.id ?? null} />
      {/* 
        The top header can be very minimal for the rider, 
        just showing the brand or connection status.
      */}
      <header className=" border-b border-zinc-200 h-14 flex items-center justify-between px-4 sticky top-0 z-40">
        <img
          src="/logo.png"
          alt="ArogyaDiet"
          className="h-13 w-auto object-contain"
        />
        <NotificationBell userId={profile?.id ?? null} />
      </header>

      {/* Main Content Area: padding bottom to account for the fixed nav bar */}
      <main className="flex-1 w-full max-w-md mx-auto pb-24">{children}</main>

      {/* Mobile Bottom Navigation */}
      <RiderBottomNav />
    </div>
  );
}
