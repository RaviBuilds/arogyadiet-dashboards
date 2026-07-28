import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import FranchiseNavbar from "./FranchiseNavbar";
import { AmbientBackground } from "@/shared/components/franchise/ui/AmbientBackground";
// The pure core module keeps the franchise portal's module graph free of the
// server-only guard helpers it does not need (Req 23.7 — shared code only).
import {
  resolveAccessConfiguration,
  isPortalPathAllowed,
  landingRouteFor,
  type AccessConfiguration,
} from "@/lib/auth/adminAccessCore";

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
    .select(
      "id, full_name, avatar_url, franchise_id, admin_access_level, admin_operations_access, roles(code)",
    )
    .eq("auth_user_id", user.id)
    .single();

  const roles = userProfileData?.roles as
    | { code: string }[]
    | { code: string }
    | null
    | undefined;
  const roleCode = Array.isArray(roles) ? roles[0]?.code : roles?.code;

  if (roleCode !== "FRANCHISE_ADMIN") return redirect("/unauthorized");

  // [Req 21.9] A franchise user with no franchise cannot see anything.
  const franchiseId = userProfileData?.franchise_id;
  if (!franchiseId) return redirect("/unauthorized");

  // Fetch franchise name for display. `owner_user_id` is additive and resolves
  // the Franchise_Owner override below (Req 21.6).
  const { data: franchise } = await supabase
    .from("franchises")
    .select("name, status, owner_user_id")
    .eq("id", franchiseId)
    .single();

  // [Req 21.10]
  if (franchise?.status === "suspended") return redirect("/unauthorized");

  // [Req 21.5, 21.6, 21.7] Access_Level gate — the same gate the admin portal
  // applies, on the `/franchise` base. The Franchise_Owner is treated as
  // `inventory_operations`; every other franchise user resolves to their stored
  // level (NULL / unrecognised still coerces to `inventory_operations`, so
  // pre-existing franchise users are unaffected).
  //
  // The requested path arrives via the `x-portal-pathname` header the
  // middleware sets for this portal (the same propagation the customer portal
  // uses for `x-customer-*`). When the header is absent the gate is skipped —
  // the middleware has already decided reachability, and this layer is only
  // defense in depth, so a missing header must never lock a user out.
  const isFranchiseOwner =
    typeof franchise?.owner_user_id === "string" &&
    franchise.owner_user_id === userProfileData?.id;
  const config: AccessConfiguration = isFranchiseOwner
    ? { level: "inventory_operations", groups: {} }
    : resolveAccessConfiguration(
        userProfileData?.admin_access_level,
        userProfileData?.admin_operations_access,
      );

  const portalPathname = (await headers()).get("x-portal-pathname");
  if (portalPathname && !isPortalPathAllowed(config, portalPathname, "/franchise")) {
    return redirect(landingRouteFor(config.level));
  }

  const userProfile = {
    id: userProfileData?.id ?? "",
    fullName: userProfileData?.full_name || "Franchise Admin",
    avatarUrl: userProfileData?.avatar_url || "",
    roleCode: roleCode,
    franchiseId,
    franchiseName: franchise?.name ?? "Franchise",
  };

  return (
    <div className="relative flex min-h-screen flex-col">
      <AmbientBackground />
      <FranchiseNavbar
        userProfile={userProfile}
        email={user.email!}
        config={config}
      />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
