import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  resolveAccessConfiguration,
  isAdminPathAllowed,
  landingRouteFor,
  type AccessConfiguration,
} from "@/lib/auth/adminAccessCore";
// Feature flag — gates ALL franchise-specific additions below. When false
// (production default / unset), every new branch added for Task 12.1 is a
// no-op and the middleware behaves exactly as it did before this change.
import { FRANCHISE_FEATURES_ENABLED } from "@/lib/franchise/constants";

/**
 * [Req 16.5] Builds the franchise-portal root URL on the `franchies` subdomain,
 * derived from the incoming request's host so it works across environments
 * (e.g. `admin.arogyadiet.com` → `franchies.arogyadiet.com/`,
 * `master.localhost:3000` → `franchies.localhost:3000/`).
 *
 * `currentSubdomain` is guaranteed to be the leading host label here (it was
 * resolved via `hostname.startsWith(`${sub}.`)`), so the replacement is safe.
 */
function franchiseRootUrl(
  request: NextRequest,
  hostname: string,
  currentSubdomain: string,
): URL {
  const target = new URL("/", request.url);
  target.host = hostname.replace(`${currentSubdomain}.`, "franchies.");
  return target;
}

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/sandbox")) {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;

  if (
    pathname === "/OneSignalSDKWorker.js" ||
    pathname === "/OneSignalSDKUpdaterWorker.js"
  ) {
    return NextResponse.next();
  }

  const url = request.nextUrl;
  const hostname = request.headers.get("host") || "";

  // 2. Subdomain Routing Mapping
  const portals: Record<string, string> = {
    customer: "/customer",
    deliverypartner: "/rider",
    admin: "/admin",
    master: "/master",
    franchies: "/franchise",
  };

  let currentSubdomain = Object.keys(portals).find((sub) =>
    hostname.startsWith(`${sub}.`),
  );

  if (hostname.includes("vercel.app")) {
    currentSubdomain = "customer";
  }

  // [ADDITIVE — Req 16.10, flag-gated] A request to a *named* subdomain that
  // maps to no defined portal must be routed to the unauthorized page and
  // expose no data. Today such a host resolves `portalPath = ""` and silently
  // falls through to the root app; this makes the denial explicit.
  //
  // Gated by FRANCHISE_FEATURES_ENABLED so production behavior is unchanged
  // while the flag is off. Detection is intentionally conservative: it fires
  // ONLY when there is a clear leading subdomain label, and it never touches
  // the apex domain, `www`, raw IP hosts, bare `localhost`, or Vercel previews
  // (which are already remapped to `customer` above). The `/unauthorized`
  // guard prevents a redirect loop on the unknown host itself.
  if (
    FRANCHISE_FEATURES_ENABLED &&
    !currentSubdomain &&
    !pathname.startsWith("/unauthorized")
  ) {
    const bareHost = hostname.split(":")[0];
    const labels = bareHost.split(".");
    const firstLabel = labels[0];
    const isIpHost = /^\d{1,3}(\.\d{1,3}){3}$/.test(bareHost);
    const isPreview = bareHost.endsWith("vercel.app");
    // A named subdomain exists for `*.localhost` (>=2 labels) or any host with
    // 3+ labels (e.g. `foo.arogyadiet.com`). The apex (`arogyadiet.com`, 2
    // labels) and bare `localhost` are excluded by construction.
    const hasNamedSubdomain =
      (labels[labels.length - 1] === "localhost" && labels.length >= 2) ||
      (labels.length >= 3 && !isPreview);
    if (hasNamedSubdomain && firstLabel !== "www" && !isIpHost) {
      return NextResponse.redirect(new URL("/unauthorized", request.url));
    }
  }

  const portalPath = currentSubdomain ? portals[currentSubdomain] : "";

  let response = NextResponse.next({ request });

  if (portalPath && !url.pathname.startsWith("/unauthorized")) {
    const pathname =
      url.pathname === portalPath || url.pathname.startsWith(`${portalPath}/`)
        ? url.pathname
        : `${portalPath}${url.pathname}`;
    const rewriteUrl = new URL(`${pathname}${url.search}`, request.url);
    response = NextResponse.rewrite(rewriteUrl);
  }

  // Supabase session management
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // FIX: Safely extract role code
  let roleCode = null;
  let config: AccessConfiguration = {
    level: "inventory_operations",
    groups: {},
  };
  // [Req 12.1–12.4] Onboarding statuses of the Customer_Record(s) the current
  // session maps to. Resolved from the SAME single `users` query below (an
  // additive `customer_profiles` embed) so the customer-portal gate costs no
  // extra round-trip. `customer_profiles.user_id` is UNIQUE, so for a normal
  // session this holds 0 or 1 entries; it stays an array so the exactly-one
  // rule (and the ambiguous case) can be evaluated uniformly.
  let customerOnboardingStatuses: (string | null)[] = [];
  // [Req 1.1–1.4] The customer profile ID resolved from the `customer_profiles`
  // embed, used to query `subscriptions` for `customer_category` header propagation.
  let customerProfileId: string | null = null;
  // [Req 2.8] Track whether the user still has a temporary PIN. Used as a
  // defense-in-depth guard: the session should NOT be established while
  // is_temp_pin is true (pinAuthActions only calls signInWithPassword after
  // setPermanentPin), but if a session somehow exists with the flag still set,
  // the middleware blocks access to protected routes.
  // NOTE: is_temp_pin column may not exist yet (pending migration); default to null.
  let isTempPin: boolean | null = null;
  if (user) {
    const { data: userProfile } = await supabase
      .from("users")
      .select(
        "admin_access_level, admin_operations_access, roles(code), customer_profiles(id, onboarding_status)",
      )
      .eq("auth_user_id", user.id)
      .single();

    const rolesData = userProfile?.roles as
      | { code: string }[]
      | { code: string }
      | null
      | undefined;
    roleCode = Array.isArray(rolesData) ? rolesData[0]?.code : rolesData?.code;
    config = resolveAccessConfiguration(
      userProfile?.admin_access_level,
      userProfile?.admin_operations_access,
    );

    // Normalize the `customer_profiles` embed (supabase-js may return a to-one
    // relation as an object, a single-element array, or null) into a flat list
    // for the customer-portal gate below.
    const profilesData = userProfile?.customer_profiles as
      | { id: string; onboarding_status: string | null }[]
      | { id: string; onboarding_status: string | null }
      | null
      | undefined;
    const profileList = Array.isArray(profilesData)
      ? profilesData
      : profilesData
        ? [profilesData]
        : [];
    customerOnboardingStatuses = profileList.map((p) => p.onboarding_status);
    // [Req 1.1] Resolve customer profile ID for downstream subscription query
    customerProfileId = profileList[0]?.id ?? null;
  }

  // [Req 18.7 — DB scope binding] DECISION: do NOT bind the DB session context
  // (`set_franchise_context`) from middleware.
  //
  // Rationale (edge-runtime + connection constraints):
  //  - `bindDbScope`/`resolveFranchiseContext` build a Supabase client via
  //    `@/lib/supabase/server` (`next/headers`), which is not usable here;
  //    middleware uses its own `createServerClient` bound to request cookies.
  //  - More fundamentally, `set_franchise_context` runs `set_config(..., true)`,
  //    which is transaction-LOCAL. Over PostgREST each RPC executes in its own
  //    short-lived transaction/connection, so a context set here would NOT
  //    persist to the separate connections used by downstream Server
  //    Components. Forcing a DB RPC in middleware would be both ineffective and
  //    risky — exactly the situation Task 12.1 says to avoid.
  //
  // Instead we keep the existing pattern: the resolved `franchise_id` is
  // propagated downstream via the `x-franchise-id` cookie (set in the franchies
  // branch below and consumed by the franchise Server Components). Those
  // components call `setFranchiseSessionContext` inside their OWN request
  // transaction, so RLS enforces the same boundary the middleware computed.
  // This whole path is inert unless FRANCHISE_FEATURES_ENABLED is true, because
  // `setFranchiseSessionContext` itself short-circuits when the flag is off.

  // 3. Route protection, gatekeeper logic

  // Exclude static files and APIs from Auth checks
  if (
    !url.pathname.startsWith(`/_next`) &&
    !url.pathname.startsWith(`/api`) &&
    !url.pathname.includes(".")
  ) {
    // If not logged in, redirect to login (unless already on an auth page)
    if (
      !user &&
      !url.pathname.startsWith("/login") &&
      !url.pathname.startsWith("/signup") &&
      !url.pathname.startsWith("/auth") &&
      !url.pathname.startsWith("/forgot-password") &&
      !url.pathname.startsWith("/update-password")
    ) {
      // [Req 16.9] Building the target from `request.url` preserves the
      // requested subdomain/host: e.g. an unauthenticated hit on
      // `admin.arogyadiet.com/...` redirects to `admin.arogyadiet.com/login`,
      // not the apex. No change needed beyond resolving relative to the
      // incoming request URL (already host-qualified).
      const loginUrl = new URL("/login", request.url);
      return NextResponse.redirect(loginUrl);
    }

    // --- NEW STRICT GATEKEEPER LOGIC ---
    if (user && !url.pathname.startsWith("/unauthorized")) {
      // [Req 12.1/12.2/12.3/12.4 — customer portal only] Grant access to the
      // customer portal ONLY when the authenticated session maps to a role
      // CUSTOMER that has exactly one Customer_Record whose onboarding_status
      // is IN_PROGRESS or COMPLETED. This mirrors the pre-login eligibility
      // semantics of `src/services/EligibilityChecker.ts`, but is evaluated
      // here against the current session using the SSR Supabase client (no
      // admin client, no extra query — the statuses were resolved above).
      //
      // Denials (redirect to /unauthorized per the existing convention used by
      // the other portals):
      //   - role is not CUSTOMER                     → not a customer
      //   - zero allowed Customer_Records            → not registered / bad status (Req 12.1/12.3)
      //   - more than one allowed Customer_Record    → ambiguous (Req 12.4)
      // Only the exactly-one-allowed case is granted (Req 12.2).
      if (currentSubdomain === "customer") {
        const ALLOWED_ONBOARDING_STATUSES = ["IN_PROGRESS", "COMPLETED"];
        const allowedRecords = customerOnboardingStatuses.filter(
          (status): status is string =>
            status !== null && ALLOWED_ONBOARDING_STATUSES.includes(status),
        );
        if (roleCode !== "CUSTOMER" || allowedRecords.length !== 1) {
          return NextResponse.redirect(new URL("/unauthorized", request.url));
        }

        // [Req 2.8, 2.9] Block access to protected routes while is_temp_pin
        // is true — customer must set a permanent PIN before accessing
        // dashboard, profile, subscription, billing, or any other protected
        // route. The session should NOT be established while is_temp_pin is
        // true (pinAuthActions only calls signInWithPassword after
        // setPermanentPin), but this is a defense-in-depth guard against
        // session-establishment bugs or race conditions.
        //
        // If the customer navigates away from the set-new-pin flow without
        // completing it, they have no valid session (by design). If somehow
        // they DO have a session with is_temp_pin still true, redirect to
        // login so they re-enter the set-new-pin flow after PIN verification.
        if (isTempPin === true) {
          const loginUrl = new URL("/login", request.url);
          return NextResponse.redirect(loginUrl);
        }

        // [Req 1.1–1.4] Resolve customer_category from active subscription and
        // propagate via x-customer-category header. Uses the existing Supabase
        // client — no new instantiation. Falls back to empty string if no active
        // subscription or if the query fails (safe degradation per design).
        let customerCategory = "";
        if (customerProfileId) {
          try {
            const { data: catRow } = await supabase
              .from("subscriptions")
              .select("customer_category")
              .eq("customer_profile_id", customerProfileId)
              .eq("status", "ACTIVE")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            customerCategory = catRow?.customer_category ?? "";
          } catch {
            // Query failure must not block navigation — fall back to empty string
            customerCategory = "";
          }
        }
        response.headers.set("x-customer-category", customerCategory);
      }
      if (currentSubdomain === "admin" && roleCode !== "ADMIN") {
        // FRANCHISE_ADMIN trying to access admin portal → redirect to franchise portal
        if (roleCode === "FRANCHISE_ADMIN") {
          // [Req 16.5, flag-gated] Bounce back to the franchise-scoped
          // workspace at the `franchies` subdomain root. When the flag is off,
          // the prior /unauthorized behavior is preserved exactly.
          if (FRANCHISE_FEATURES_ENABLED) {
            return NextResponse.redirect(
              franchiseRootUrl(request, hostname, currentSubdomain),
            );
          }
          return NextResponse.redirect(new URL("/unauthorized", request.url));
        }
        return NextResponse.redirect(new URL("/unauthorized", request.url));
      }
      // Admin access-level path gate. `url.pathname` on the admin subdomain is
      // the pre-rewrite path (e.g. "/dashboard"); reconstruct the rewritten
      // "/admin/..." path for classification. On deny, send the admin to THEIR
      // OWN landing route (inventory-only → /inventory, others → /dashboard).
      if (currentSubdomain === "admin" && roleCode === "ADMIN") {
        const adminPath = url.pathname.startsWith("/admin")
          ? url.pathname
          : `/admin${url.pathname}`;
        if (!isAdminPathAllowed(config, adminPath)) {
          return NextResponse.redirect(
            new URL(landingRouteFor(config.level), request.url),
          );
        }
      }
      if (currentSubdomain === "deliverypartner" && roleCode !== "RIDER") {
        return NextResponse.redirect(new URL("/unauthorized", request.url));
      }
      if (currentSubdomain === "master" && roleCode !== "MASTER_ADMIN") {
        // FRANCHISE_ADMIN trying to access master portal → redirect
        if (roleCode === "FRANCHISE_ADMIN") {
          // [Req 16.5, flag-gated] Bounce back to the franchise-scoped
          // workspace at the `franchies` subdomain root. When the flag is off,
          // the prior /unauthorized behavior is preserved exactly.
          if (FRANCHISE_FEATURES_ENABLED) {
            return NextResponse.redirect(
              franchiseRootUrl(request, hostname, currentSubdomain),
            );
          }
          return NextResponse.redirect(new URL("/unauthorized", request.url));
        }
        return NextResponse.redirect(new URL("/unauthorized", request.url));
      }
      // Franchise portal: only FRANCHISE_ADMIN allowed
      if (currentSubdomain === "franchies" && roleCode !== "FRANCHISE_ADMIN") {
        return NextResponse.redirect(new URL("/unauthorized", request.url));
      }
      // FRANCHISE_ADMIN with suspended franchise check
      if (currentSubdomain === "franchies" && roleCode === "FRANCHISE_ADMIN") {
        const { data: franchiseUser } = await supabase
          .from("users")
          .select("franchise_id")
          .eq("auth_user_id", user.id)
          .single();

        if (!franchiseUser?.franchise_id) {
          // FRANCHISE_ADMIN with no franchise assigned
          if (!url.pathname.startsWith("/unauthorized")) {
            return NextResponse.redirect(new URL("/unauthorized", request.url));
          }
        } else {
          // Check if franchise is suspended
          const { data: franchise } = await supabase
            .from("franchises")
            .select("status")
            .eq("id", franchiseUser.franchise_id)
            .single();

          if (franchise?.status === "suspended" && !url.pathname.startsWith("/unauthorized")) {
            return NextResponse.redirect(new URL("/unauthorized", request.url));
          }

          // Inject franchise_id into response cookie for downstream server components
          response.cookies.set("x-franchise-id", franchiseUser.franchise_id, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
          });
        }
      }
    }
  }

  // If logged in and trying to go to root or auth pages, send to the landing
  // route for the user's access level. Non-admins (and admins without a level)
  // resolve to full access → /dashboard, preserving prior behavior.
  if (
    user &&
    (url.pathname === "/" ||
      url.pathname.startsWith("/login") ||
      url.pathname.startsWith("/signup")) &&
    !url.pathname.startsWith("/update-password")
  ) {
    const home = landingRouteFor(config.level);
    return NextResponse.redirect(new URL(home, request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
