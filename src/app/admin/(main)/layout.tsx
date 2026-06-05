import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import AdminNavbar from "./AdminNavbar";
import { OneSignalProvider } from "@/shared/components/notifications/OneSignalProvider";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: object) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: object) {
          cookieStore.set({ name, value: "", ...options });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return redirect("/login");

  const { data: userProfileData } = await supabase
    .from("users")
    .select("id, full_name, avatar_url, roles(code)")
    .eq("auth_user_id", user.id)
    .single();

  // Explicitly tell TypeScript that roles can be an array or a single object
  const roles = userProfileData?.roles as
    | { code: string }[]
    | { code: string }
    | null
    | undefined;
  const roleCode = Array.isArray(roles) ? roles[0]?.code : roles?.code;

  if (roleCode !== "ADMIN") return redirect("/unauthorized");

  const userProfile = {
    id: userProfileData?.id ?? "",
    fullName: userProfileData?.full_name || "Admin",
    avatarUrl: userProfileData?.avatar_url || "",
    roleCode: roleCode,
  };

  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      <OneSignalProvider userId={userProfile.id || null} />
      <AdminNavbar userProfile={userProfile} email={user.email!} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
