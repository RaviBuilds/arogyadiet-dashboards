import { createAdminClient } from "@/lib/supabase/admin";

function readUserName(
  users: { full_name?: string | null } | { full_name?: string | null }[] | null | undefined,
): string {
  const user = Array.isArray(users) ? users[0] : users;
  return user?.full_name?.trim() || "Customer";
}

export async function getCustomerNameByUserId(userId: string): Promise<string> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("users")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();

  return data?.full_name?.trim() || "Customer";
}

export async function getCustomerNameByProfileId(
  profileId: string,
): Promise<string> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("customer_profiles")
    .select("users(full_name)")
    .eq("id", profileId)
    .maybeSingle();

  return readUserName(
    data?.users as { full_name?: string | null } | { full_name?: string | null }[] | null,
  );
}

export async function getCustomerNameBySubscriptionId(
  subscriptionId: string,
): Promise<string> {
  const supabase = createAdminClient();
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("customer_profile_id")
    .eq("id", subscriptionId)
    .maybeSingle();

  if (!sub?.customer_profile_id) return "Customer";
  return getCustomerNameByProfileId(sub.customer_profile_id);
}

export async function getRiderNameByProfileId(
  riderProfileId: string,
): Promise<string> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("rider_profiles")
    .select("users(full_name)")
    .eq("id", riderProfileId)
    .maybeSingle();

  const user = Array.isArray(data?.users) ? data.users[0] : data?.users;
  return (user as { full_name?: string | null })?.full_name?.trim() || "Rider";
}
