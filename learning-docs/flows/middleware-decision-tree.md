# Flow: Middleware Decision Tree (`src/middleware.ts`)

Matcher: every path except `_next/static`, `_next/image`, `favicon.ico` and image extensions. Runs before every page. Note: Next.js 16 deprecated the `middleware` file name in favour of `proxy.ts` (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`); this project still uses `middleware.ts`.

```mermaid
flowchart TD
  S["request"] --> A{"/api/* or /sandbox or OneSignal worker?"}
  A -- yes --> PASS["NextResponse.next()"]
  A -- no --> B["resolve subdomain from host<br/>customer / deliverypartner / admin / master / franchies<br/>*.vercel.app -> customer"]
  B --> C{"flag on & unknown named subdomain?"}
  C -- yes --> UN["redirect /unauthorized"]
  C -- no --> D["rewrite to /portal + path"]
  D --> E["createServerClient(cookies) -> auth.getUser()"]
  E --> F["users + roles + customer_profiles query -> roleCode, access config, onboarding statuses"]
  F --> G{"/architecture?"}
  G -- yes --> PASS2["return (public viewer)"]
  G -- no --> H{"no user and not /login,/signup,/auth,/forgot-password,/update-password, not public /app?"}
  H -- yes --> LOGIN["redirect /login (same host)"]
  H -- no --> I{"user logged in?"}
  I -- no --> OUT["return response"]
  I -- yes --> J{"subdomain"}
  J -- customer --> K{"public /app path?"}
  K -- yes --> OUT
  K -- no --> K2{"role CUSTOMER and exactly 1 IN_PROGRESS/COMPLETED record?"}
  K2 -- no --> UN
  K2 -- yes --> K3["set x-auth-user-id, x-customer-profile-id;<br/>resolve category (ACTIVE/PENDING, KIT fallback) -> x-customer-category"]
  K3 --> K4{"MEAL customer on KIT/stay route?"}
  K4 -- yes --> DASH["redirect /dashboard?msg=category-unavailable"]
  K4 -- no --> R
  J -- admin --> L{"role ADMIN?"}
  L -- "FRANCHISE_ADMIN" --> FR["flag on: redirect franchies.<host>/ else /unauthorized"]
  L -- other --> UN
  L -- yes --> L2{"isPortalPathAllowed(config, /admin path)?"}
  L2 -- no --> LAND["redirect landingRouteFor(level)"]
  L2 -- yes --> R
  J -- deliverypartner --> M{"role RIDER?"}
  M -- no --> UN
  M -- yes --> R
  J -- master --> N{"role MASTER_ADMIN?"}
  N -- "FRANCHISE_ADMIN" --> FR
  N -- other --> UN
  N -- yes --> R
  J -- franchies --> O{"role FRANCHISE_ADMIN?"}
  O -- no --> UN
  O -- yes --> O2{"has franchise_id and franchise not suspended?"}
  O2 -- no --> UN
  O2 -- yes --> O3["set cookie x-franchise-id, header x-portal-pathname;<br/>owner -> full access"]
  O3 --> O4{"isPortalPathAllowed(config, /franchise path)?"}
  O4 -- no --> LAND
  O4 -- yes --> R
  R{"path is / or /login or /signup?"} -- yes --> HOME["redirect landingRouteFor(level)"]
  R -- no --> OUT
```

Notes:
- `landingRouteFor`: inventory → `/inventory`, dietitian → `/customers`, others → `/dashboard`.
- Queries per request: 1 auth call + 1 users query; +1–2 subscriptions queries (customer); +2 (franchise: users.franchise_id, franchises).
- Middleware deliberately does not call `set_franchise_context` (transaction-local setting would not persist; see the comment block in the file).
- Dead code: `isTempPin` is never assigned.
