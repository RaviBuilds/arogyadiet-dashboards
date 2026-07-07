import { cache } from "react";
import type { AuthError, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export type CustomerUserProfile = {
  id: string;
  full_name: string | null;
  mobile: string | null;
};

export type CustomerSession = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User | null;
  profile: CustomerUserProfile | null;
  customerProfileId: string | null;
  error: AuthError | null;
};

export const getCustomerSession = cache(async (): Promise<CustomerSession> => {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      supabase,
      user: null,
      profile: null,
      customerProfileId: null,
      error: userError,
    };
  }

  const { data: profile } = await supabase
    .from("users")
    .select("id, full_name, mobile")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  // Resolve customer profile ID
  let customerProfileId: string | null = null;
  if (profile?.id) {
    const { data: cp } = await supabase
      .from("customer_profiles")
      .select("id")
      .eq("user_id", profile.id)
      .maybeSingle();
    customerProfileId = cp?.id ?? null;
  }

  return {
    supabase,
    user,
    profile: profile ?? null,
    customerProfileId,
    error: null,
  };
});
