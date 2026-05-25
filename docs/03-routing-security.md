# Subdomain Routing & Security Gatekeeper

This document details the routing and security architecture for the application, specifically focusing on how subdomains map to Next.js route groups and the authentication/authorization gatekeeper logic implemented in `src/middleware.ts`.

## 1. Subdomain Routing Mapping

The application relies on subdomain-based routing to seamlessly serve different portals from a single unified Next.js application.

The `middleware.ts` intercepts incoming requests, analyzes the `host` header, and identifies the target subdomain. It then silently rewrites the request to the corresponding internal path under `src/app`.

### Mapping Table

| Subdomain Prefix      | Internal Route Group Path | Description |
| :---                  | :---                      | :---        |
| `customer.`           | `/customer`               | Default portal for customers to view and purchase meals, and manage subscriptions. |
| `deliverypartner.`    | `/rider`                  | Portal for riders/delivery partners to manage shifts, routes, and tracking. |
| `admin.`              | `/admin`                  | Administrative portal for managing operations, customers, meals, and riders. |
| `master.`             | `/master`                 | Master/super-admin dashboard portal. |

*Note: If the application is hosted on `vercel.app` (meaning the hostname contains `vercel.app`), it defaults to the `customer` portal.*

**How it works under the hood:**
If a request comes to `admin.example.com/dashboard`, the middleware identifies the `admin` subdomain, looks up the target (`/admin`), and rewrites the internal request URL to `/admin/dashboard` while keeping the user's browser URL unchanged.

## 2. Authentication Rules (Unauthenticated Users)

The application implements a strict by default authentication gatekeeper in `src/middleware.ts` using Supabase SSR authentication.

*   **Public Assets Excluded:** Static files (`/_next/*`), API routes (`/api/*`), and files with extensions (e.g., `.svg`, `.png`) bypass auth checks.
*   **Default Redirect for Unauthenticated Users:** If a user does not have an active session, any request to protected pages is intercepted. The user is automatically redirected to `/login`.
*   **Whitelisted Auth Pages:** The following paths are explicitly whitelisted for unauthenticated users so they can authenticate or register:
    *   `/login`
    *   `/signup`
    *   `/auth` (for callbacks)
    *   `/forgot-password`
    *   `/update-password`

*   **Logged-In Redirections:** If a user is already authenticated and attempts to visit the root index (`/`), `/login`, or `/signup`, they are automatically redirected to the portal's `/dashboard`.

## 3. Authorization Rules (Role-Based Gatekeeper)

Once a user is authenticated, the middleware performs a secondary authorization check to ensure the user has the correct role permissions to access their specific subdomain portal. 

The middleware fetches the user's assigned role from the `users` table via `roles(code)`.

### Role Enforcement Checks

*   **Admin Portal (`admin.` subdomain):**
    *   The user must have a `roleCode` equal to `"ADMIN"`.
    *   If a non-admin user attempts to access the admin portal, they are immediately redirected to `/unauthorized`.

*   **Rider Portal (`deliverypartner.` subdomain):**
    *   The user must have a `roleCode` equal to `"RIDER"`.
    *   If a non-rider user attempts to access the delivery partner portal, they are immediately redirected to `/unauthorized`.

*   **Unauthorized Route:**
    *   The `/unauthorized` route acts as a fallback page to inform users they lack the required permissions for the portal they are attempting to access. It bypasses strict role checks so it can be rendered safely.
