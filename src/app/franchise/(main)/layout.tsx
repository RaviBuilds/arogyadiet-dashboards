import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import FranchiseNavbar from "./FranchiseNavbar";

export default async function FranchiseLayout({
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
    .select("id, full_name, avatar_url, franchise_id, roles(code)")
    .eq("auth_user_id", user.id)
    .single();

  const roles = userProfileData?.roles as
    | { code: string }[]
    | { code: string }
    | null
    | undefined;
  const roleCode = Array.isArray(roles) ? roles[0]?.code : roles?.code;

  if (roleCode !== "FRANCHISE_ADMIN") return redirect("/unauthorized");

  const franchiseId = userProfileData?.franchise_id;
  if (!franchiseId) return redirect("/unauthorized");

  // Fetch franchise name for display
  const { data: franchise } = await supabase
    .from("franchises")
    .select("name, status")
    .eq("id", franchiseId)
    .single();

  if (franchise?.status === "suspended") return redirect("/unauthorized");

  const userProfile = {
    id: userProfileData?.id ?? "",
    fullName: userProfileData?.full_name || "Franchise Admin",
    avatarUrl: userProfileData?.avatar_url || "",
    roleCode: roleCode,
    franchiseId,
    franchiseName: franchise?.name ?? "Franchise",
  };

  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      <FranchiseNavbar userProfile={userProfile} email={user.email!} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
