import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api")) {
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
    const rewriteUrl = new URL(
      `${portalPath}${url.pathname}${url.search}`,
      request.url,
    );
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
  if (user) {
    const { data: userProfile } = await supabase
      .from("users")
      .select("roles(code)")
      .eq("auth_user_id", user.id)
      .single();

    const rolesData: any = userProfile?.roles;
    roleCode = Array.isArray(rolesData) ? rolesData[0]?.code : rolesData?.code;
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
        return NextResponse.redirect(new URL("/unauthorized", request.url));
      }
      if (currentSubdomain === "deliverypartner" && roleCode !== "RIDER") {
        return NextResponse.redirect(new URL("/unauthorized", request.url));
      }
      if (currentSubdomain === "master" && roleCode !== "MASTER_ADMIN") {
        return NextResponse.redirect(new URL("/unauthorized", request.url));
      }
    }
  }

  // If logged in and trying to go to root or auth pages, send to dashboard
  if (
    user &&
    (url.pathname === "/" ||
      url.pathname.startsWith("/login") ||
      url.pathname.startsWith("/signup")) &&
    !url.pathname.startsWith("/update-password")
  ) {
    const dashboardUrl = new URL("/dashboard", request.url);
    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
