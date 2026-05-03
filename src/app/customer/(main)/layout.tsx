import { createClient } from "@/lib/supabase/server";
import { CustomerHeader } from "@/shared/components/layout/customer-header";
import { CustomerSidebar } from "@/shared/components/layout/customer-sidebar";
import { redirect } from "next/navigation";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // 1. Secure the entire customer route
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  // 2. Fetch profile data for the greeting
  const { data: profile } = await supabase
    .from("users")
    .select("full_name")
    .eq("auth_user_id", user?.id)
    .maybeSingle();

  const userName = profile?.full_name || user?.user_metadata?.full_name || null;

  return (
    <div className="flex min-h-screen w-full bg-slate-50/50">
      {/* Sidebar for Desktop */}
      <CustomerSidebar isMobile={false} />

      <div className="flex flex-col w-full min-w-0 flex-1">
        <CustomerHeader userEmail={user?.email || ""} userName={userName} />
        <main className="flex-1 p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
