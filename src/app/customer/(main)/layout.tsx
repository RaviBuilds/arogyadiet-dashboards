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

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("users")
    .select("full_name")
    .eq("auth_user_id", user?.id)
    .maybeSingle();

  const userName = profile?.full_name || user?.user_metadata?.full_name || null;

  return (
    // ADDED max-w-full and overflow-x-hidden to kill horizontal scroll
    <div className="flex min-h-screen w-full max-w-full bg-slate-50/50">
      <CustomerSidebar isMobile={false} />

      {/* Added min-w-0 to allow text truncation inside flex children */}
      <div className="flex flex-col w-full min-w-0 flex-1 overflow-x-hidden">
        <CustomerHeader userEmail={user?.email || ""} userName={userName} />
        <main className="flex-1 p-4 md:p-6 lg:p-8 w-full min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
