import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MasterNavbar from "./MasterNavbar";

export default async function MasterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return redirect("/login");

  const { data: userProfileData } = await supabase
    .from("users")
    .select("full_name, avatar_url, roles(code)")
    .eq("auth_user_id", user.id)
    .single();

  const roles = userProfileData?.roles as
    | { code: string }[]
    | { code: string }
    | null
    | undefined;
  const roleCode = Array.isArray(roles) ? roles[0]?.code : roles?.code;

  if (roleCode !== "MASTER_ADMIN") return redirect("/unauthorized");

  const userProfile = {
    id: user.id,
    fullName: userProfileData?.full_name || "Master Admin",
    avatarUrl: userProfileData?.avatar_url || "",
    roleCode: roleCode,
  };

  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      <MasterNavbar userProfile={userProfile} email={user.email!} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
