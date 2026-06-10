import { getCustomerSession } from "@/lib/customer/get-session";
import { FloatingSupportMenu } from "@/shared/components/customer/FloatingSupportMenu";
import { CustomerHeader } from "@/shared/components/layout/customer-header";
import { CustomerSidebar } from "@/shared/components/layout/customer-sidebar";
import { OneSignalProvider } from "@/shared/components/notifications/OneSignalProvider";
import { redirect } from "next/navigation";
import { Metadata } from "next";


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

  return (
    // ADDED max-w-full and overflow-x-hidden to kill horizontal scroll
    <div className="flex min-h-screen w-full max-w-full bg-slate-50/50 print:block print:min-h-0 print:bg-white">
      {/* Global Subtle Background Texture */}
      <div 
        className="fixed inset-0 z-0 pointer-events-none opacity-35" 
        style={{ 
          backgroundImage: "url('/customer-bg.jpg')", 
          backgroundRepeat: "repeat",
          backgroundSize: "350px" 
        }} 
      />
      <OneSignalProvider userId={profile?.id ?? null} />
      <CustomerSidebar isMobile={false} />

      {/* Added min-w-0 to allow text truncation inside flex children */}
      <div className="relative z-10 flex flex-col w-full min-w-0 flex-1 overflow-x-hidden print:block print:overflow-visible">
        <CustomerHeader
          userEmail={user.email || ""}
          userName={userName}
          userId={profile?.id ?? null}
        />
        <main className="flex-1 p-4 md:p-6 lg:p-8 w-full min-w-0 print:p-0">
          {children}
        </main>
      </div>

      <FloatingSupportMenu />
    </div>
  );
}
