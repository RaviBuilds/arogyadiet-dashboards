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
      {/* `.rider-app-shell` (see globals.css) turns off browser-page
          affordances — tap-highlight flash, pull-to-refresh/overscroll
          bounce, text-selection on chrome — so the webview reads as a
          native Android app rather than a website, inside Capacitor and
          in a mobile browser alike. Desktop/tablet widths are unaffected. */}
      <div className="rider-app-shell relative flex min-h-svh flex-col bg-gradient-to-b from-red-50/40 via-zinc-50 to-amber-50/30">
        <RiderOneSignal userId={profile?.id ?? null} />
        {/* Ambient brand wash — same red/amber wellness language as the
            rider login screen, so the dashboard feels like a continuation
            of that experience rather than a different app. Fixed, behind
            everything, purely decorative. */}
        <div className="pointer-events-none fixed -right-24 -top-24 -z-10 h-72 w-72 rounded-full bg-red-200/25 blur-3xl" />
        <div className="pointer-events-none fixed -bottom-24 -left-20 -z-10 h-72 w-72 rounded-full bg-amber-100/35 blur-3xl" />

        {/* pt-safe (globals.css) adds env(safe-area-inset-top) so the app
            bar clears a status bar / notch on native builds; resolves to 0
            and is a no-op everywhere else (incl. current Android config). */}
        <header className="pt-safe sticky top-0 z-40 border-b border-zinc-200/80 bg-white/80 backdrop-blur-md select-none">
          <div className="mx-auto flex h-14 w-full max-w-md items-center justify-between px-4 lg:max-w-2xl">
            <Image
              src="/logo.png"
              alt="ArogyaDiet"
              width={120}
              height={40}
              priority
              className="h-10 w-auto object-contain"
            />
            <RiderNotificationBell userId={profile?.id ?? null} />
          </div>
        </header>

        <main className="relative mx-auto w-full max-w-md flex-1 pb-24 lg:max-w-2xl">
          {children}
        </main>

        <RiderBottomNav />
      </div>
    </RiderNativeShell>
  );
}
