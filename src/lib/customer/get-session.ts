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
      error: userError,
    };
  }

  const { data: profile } = await supabase
    .from("users")
    .select("id, full_name, mobile")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  return {
    supabase,
    user,
    profile: profile ?? null,
    error: null,
  };
});
