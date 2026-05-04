import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { BillingClient } from "@/modules/subscription/components/manage/billing-client";

export const revalidate = 0;

export default async function ManageBillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) redirect("/login");

  const { data: appUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!appUser) redirect("/login");

  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", appUser.id)
    .single();

  if (!profile) redirect("/profile");

  const { data: activeSub } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("customer_profile_id", profile.id)
    .eq("status", "ACTIVE")
    .maybeSingle();

  const { data: payments } = await supabase
    .from("payments")
    .select("*")
    .eq("customer_profile_id", profile.id)
    .order("created_at", { ascending: false });

  return (
    <BillingClient payments={payments || []} activeSub={activeSub || null} />
  );
}
