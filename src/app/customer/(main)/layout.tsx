import { getCustomerSession } from "@/lib/customer/get-session";
import { CustomerHeader } from "@/shared/components/layout/customer-header";
import { CustomerSidebar } from "@/shared/components/layout/customer-sidebar";
import { RouteProgressBar } from "@/shared/components/layout/RouteProgressBar";
import { DeferredClientProviders } from "@/shared/components/customer/DeferredClientProviders";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Metadata } from "next";
import { Suspense } from "react";


export const metadata: Metadata = {
  title: "ArogyaDiet Customer Dashboard",
  description: "Manage Your Subscriptions.",
};

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile, error } = await getCustomerSession();

  if (error || !user) redirect("/login");

  const userName = profile?.full_name || user.user_metadata?.full_name || null;
  const userPhone = profile?.mobile || user.phone || null;

  // Read customer category from middleware-propagated header (no DB call needed)
  const headerStore = await headers();
  const customerCategory = headerStore.get("x-customer-category") || null;

  return (
    // ADDED max-w-full and overflow-x-hidden to kill horizontal scroll
    <div className="flex min-h-screen w-full max-w-full bg-slate-50/50 print:block print:min-h-0 print:bg-white">
      {/* Instant visual feedback the moment a nav link is clicked, before the
          new route's data even starts loading. */}
      <Suspense fallback={null}>
        <RouteProgressBar />
      </Suspense>
      {/* Global Subtle Background Texture */}
      <div 
        className="fixed inset-0 z-0 pointer-events-none opacity-35" 
        style={{ 
          backgroundImage: "url('/customer-bg.jpg')", 
          backgroundRepeat: "repeat",
          backgroundSize: "350px" 
        }} 
      />
      <DeferredClientProviders userId={profile?.id ?? null} />
      <CustomerSidebar isMobile={false} customerCategory={customerCategory} />

      {/* Added min-w-0 to allow text truncation inside flex children */}
      <div className="relative z-10 flex flex-col w-full min-w-0 flex-1 overflow-x-hidden print:block print:overflow-visible">
        <CustomerHeader
          userEmail={user.email || ""}
          userName={userName}
          userPhone={userPhone}
          userId={profile?.id ?? null}
          customerCategory={customerCategory}
        />
        <main className="flex-1 p-4 md:p-6 lg:p-8 w-full min-w-0 print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
