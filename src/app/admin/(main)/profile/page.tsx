import { redirect } from "next/navigation";

import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import AdminProfileClient from "@/shared/components/admin/profile/AdminProfileClient";
import { createClient } from "@/lib/supabase/server";

export const revalidate = 0;

export default async function AdminProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: dbUser, error } = await supabase
    .from("users")
    .select("id, full_name, email, avatar_url, roles(code)")
    .eq("auth_user_id", user.id)
    .single();

  if (error || !dbUser) redirect("/login");

  const roles = dbUser.roles as
    | { code: string }[]
    | { code: string }
    | null
    | undefined;
  const roleCode = Array.isArray(roles) ? roles[0]?.code : roles?.code;

  if (roleCode !== "ADMIN") redirect("/unauthorized");

  return (
    <div className="flex animate-in fade-in flex-col gap-6 pb-2 duration-500">
      <AdminPageHeader
        title="My Profile"
        description="Manage your display name and account password."
      />
      <AdminProfileClient
        initialData={{
          fullName: dbUser.full_name,
          email: dbUser.email,
        }}
      />
    </div>
  );
}
