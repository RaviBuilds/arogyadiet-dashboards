import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  resolveAccessLevel,
  isAdminPathAllowed,
  landingRouteFor,
  type AdminAccessLevel,
} from "@/lib/auth/adminAccessCore";

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

  const portalPath = currentSubdomain ? portals[currentSubdomain] : "";

  let response = NextResponse.next({ request });

  if (portalPath) {
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
  let accessLevel: AdminAccessLevel = "inventory_operations";
  if (user) {
    const { data: userProfile } = await supabase
      .from("users")
      .select("admin_access_level, roles(code)")
      .eq("auth_user_id", user.id)
      .single();

    const rolesData = userProfile?.roles as
      | { code: string }[]
      | { code: string }
      | null
      | undefined;
    roleCode = Array.isArray(rolesData) ? rolesData[0]?.code : rolesData?.code;
    accessLevel = resolveAccessLevel(userProfile?.admin_access_level);
  }

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
      const loginUrl = new URL("/login", request.url);
      return NextResponse.redirect(loginUrl);
    }

    // --- NEW STRICT GATEKEEPER LOGIC ---
    if (user && !url.pathname.startsWith("/unauthorized")) {
      if (currentSubdomain === "admin" && roleCode !== "ADMIN") {
        // FRANCHISE_ADMIN trying to access admin portal → redirect to franchise portal
        if (roleCode === "FRANCHISE_ADMIN") {
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
        if (!isAdminPathAllowed(accessLevel, adminPath)) {
          return NextResponse.redirect(
            new URL(landingRouteFor(accessLevel), request.url),
          );
        }
      }
      if (currentSubdomain === "deliverypartner" && roleCode !== "RIDER") {
        return NextResponse.redirect(new URL("/unauthorized", request.url));
      }
      if (currentSubdomain === "master" && roleCode !== "MASTER_ADMIN") {
        // FRANCHISE_ADMIN trying to access master portal → redirect
        if (roleCode === "FRANCHISE_ADMIN") {
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
    const home = landingRouteFor(accessLevel);
    return NextResponse.redirect(new URL(home, request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
