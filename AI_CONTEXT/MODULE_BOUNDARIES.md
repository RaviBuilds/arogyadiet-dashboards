# Module Boundaries & Safety Rules

## Strict Portal Isolation
The portals (`admin`, `customer`, `rider`) are considered highly isolated environments. 
- **Rule 1:** Code in `src/app/admin` must **NEVER** import components or layouts from `src/app/customer` or `src/app/rider`.
- **Rule 2:** Actions in `src/actions/admin-actions` must **NEVER** be called by the `customer` or `rider` client interfaces.

## Allowed Cross-Module Imports
- `src/shared/components/*`: Generic UI (Shadcn components, layout primitives).
- `src/lib/*`: Utility functions (e.g., logger, Supabase clients, formatters).
- `src/types/*`: TypeScript definitions and schemas.
- `src/validations/*`: Zod schemas for forms.

## Forbidden Import Patterns
- ❌ Do NOT import a specific module's component into another portal directly (e.g., importing `src/modules/rider/components/LiveLocationTracker.tsx` into `src/app/admin/dashboard/page.tsx` is forbidden; use a shared admin component instead or move it to shared if truly necessary).
- ❌ Do NOT import Next.js router hooks (`useRouter`, `usePathname`) in server actions.
- ❌ Do NOT mix up Supabase clients. Never import `createBrowserClient` in a Server Component or Server Action.

## Shared Module Strategy
If a component must be shared across the Admin and Customer portals (e.g., a specific Order Status Badge), it MUST be placed in `src/shared/components/ui/` and must NOT contain any portal-specific routing or data fetching logic.
