import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Request-scoped cached auth helper.
 * React's `cache()` deduplicates calls within a single server request,
 * so layout + page can both call this without extra DB roundtrips.
 */
export const getCachedRiderAuth = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { user: null, profile: null, riderProfile: null };

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id, full_name")
    .eq("auth_user_id", user.id)
    .single();

  if (profileError || !profile) {
    return { user, profile: null, riderProfile: null };
  }

  const { data: riderProfile, error: riderProfileError } = await supabase
    .from("rider_profiles")
    .select("id, is_online")
    .eq("user_id", profile.id)
    .single();

  return {
    user,
    profile,
    riderProfile: riderProfileError ? null : riderProfile,
    riderProfileError,
  };
});
