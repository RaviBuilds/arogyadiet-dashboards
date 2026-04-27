import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const hostname = request.headers.get("host") || "";

  // 2. Subdomain Routing Mapping

  const portals: Record<string, string> = {
    customer: "/customer",
    deliverypartner: "/rider",
    admin: "/admin",
    master: "/master",
  };

  //Detect which subdomain is being accessed
  const currentSubdomain = Object.keys(portals).find((sub) =>
    hostname.startsWith(`${sub}.`),
  );
  const portalPath = currentSubdomain ? portals[currentSubdomain] : "";

  //Determine if we need to silently rewrite the URL to the mapped folder
  let response = NextResponse.next({ request });

  if (portalPath) {
    const rewriteUrl = new URL(
      `${portalPath}${url.pathname}${url.search}`,
      request.url,
    );
    response = NextResponse.rewrite(rewriteUrl);
  }

  // supabase session refresh cookies management

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Keep request and response cookies in sync for Supabase SSR
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

  //Calling getUser() to refresh the auth token if its expired
  const {
    data: { user },
  } = await supabase.auth.getUser();


  // 3. Route protection, gatekeeper logic

  if(
    !url.pathname.startsWith(`/_next`) &&
    !url.pathname.startsWith(`/api`) &&
    !url.pathname.includes('.')
  )
  {
    if(!user && !url.pathname.startsWith('/login') && !url.pathname.startsWith('/auth'))
    {
      const loginUrl = new URL('/login',request.url)
      return NextResponse.redirect(loginUrl)  
    }
  }

  return response

}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

// -> /customer/dashboard/
