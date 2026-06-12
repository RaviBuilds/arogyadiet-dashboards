import { RiderBottomNav } from "@/shared/components/layout/rider-bottom-nav";
import { getCachedRiderAuth } from "@/lib/supabase/cached-auth";
import { redirect } from "next/navigation";
import Image from "next/image";
import {
  RiderOneSignal,
  RiderNotificationBell,
  RiderNativeShell,
} from "./rider-layout-client";

export default async function RiderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await getCachedRiderAuth();

  if (!user) {
    redirect("/login");
  }

  return (
    <RiderNativeShell>
      <div className="min-h-screen bg-zinc-50 flex flex-col relative">
        <RiderOneSignal userId={profile?.id ?? null} />
        <header className="border-b border-zinc-200 h-14 flex items-center justify-between px-4 sticky top-0 z-40 bg-zinc-50">
          <Image
            src="/logo.png"
            alt="ArogyaDiet"
            width={120}
            height={40}
            priority
            className="h-10 w-auto object-contain"
          />
          <RiderNotificationBell userId={profile?.id ?? null} />
        </header>

        <main className="flex-1 w-full max-w-md mx-auto pb-24">
          {children}
        </main>

        <RiderBottomNav />
      </div>
    </RiderNativeShell>
  );
}
