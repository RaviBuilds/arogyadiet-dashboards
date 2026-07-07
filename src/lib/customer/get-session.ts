import { cache } from "react";
import { headers } from "next/headers";
import type { AuthError, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServerTimer } from "@/lib/perf/server-timing";

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
  const timer = createServerTimer("getCustomerSession");
  const supabase = await createClient();

  // [Req 9.4, 9.5, 9.6] Trust the identity Middleware already verified via
  // its own auth.getUser() call, when propagated via Identity_Headers. This
  // is the Node-runtime side of the Edge->Node identity handoff — it does
  // NOT weaken RLS: the `supabase` client returned below is still
  // constructed from the request's own cookies in both branches (Req 9.8),
  // so all downstream queries remain subject to the JWT actually present in
  // cookies regardless of which branch resolved `user`.
  const headerStore = await headers();
  const trustedAuthUserId = headerStore.get("x-auth-user-id");
  const trustedCustomerProfileId = headerStore.get("x-customer-profile-id");

  let user: User | null;
  let userError: AuthError | null = null;

  if (trustedAuthUserId) {
    timer.mark("trusted x-auth-user-id header present — skipping auth.getUser()");
    // Minimal User-shaped object — only `.id` is relied on by any current
    // consumer of getCustomerSession().user (the null-check + user.id itself).
    user = { id: trustedAuthUserId } as User;
  } else {
    let authResult: any;
    await timer.measure("auth.getUser()", async () => {
      authResult = await supabase.auth.getUser();
    });
    user = authResult.data.user;
    userError = authResult.error;
  }

  if (userError || !user) {
    timer.done();
    return {
      supabase,
      user: null,
      profile: null,
      customerProfileId: null,
      error: userError,
    };
  }

  let profileResult: any;
  await timer.measure("users table query", async () => {
    profileResult = await supabase
      .from("users")
      .select("id, full_name, mobile")
      .eq("auth_user_id", user.id)
      .maybeSingle();
  });
  const { data: profile } = profileResult;

  // Resolve customer profile ID — trust the header when present (Req 9.5),
  // otherwise fall back to the original customer_profiles query (Req 9.6).
  let customerProfileId: string | null = null;
  if (trustedAuthUserId && trustedCustomerProfileId) {
    customerProfileId = trustedCustomerProfileId;
  } else if (profile?.id) {
    await timer.measure("customer_profiles query", async () => {
      const { data: cp } = await supabase
        .from("customer_profiles")
        .select("id")
        .eq("user_id", profile.id)
        .maybeSingle();
      customerProfileId = cp?.id ?? null;
    });
  }

  timer.done();

  return {
    supabase,
    user,
    profile: profile ?? null,
    customerProfileId,
    error: null,
  };
});
