# Project Structure & Organization

## Root Directory Layout
```
├── src/                    # Main source code
├── docs/                   # System documentation
├── AI_CONTEXT/            # AI assistant context files
├── scripts/               # Database migration scripts
├── public/                # Static assets and templates
└── .kiro/                 # Kiro configuration and steering
```

## Portal-Based Architecture (src/app/)
The application uses subdomain-based routing with isolated portals:

```
src/app/
├── admin/          # Admin Portal (admin.domain.com) - Desktop-first operations
├── customer/       # Customer Portal (customer.domain.com) - Responsive subscription management
├── rider/          # Rider Portal (deliverypartner.domain.com) - Mobile-first delivery interface
├── master/         # Master Portal (master.domain.com) - Super-admin configuration
├── sandbox/        # Development testing environment
├── unauthorized/   # Access denied pages
└── api/           # API routes
```

## Source Code Organization (src/)
```
src/
├── actions/           # Next.js Server Actions (mutations)
│   ├── admin-actions/ # Admin-only operations
│   ├── rider-actions/ # Rider portal actions
│   └── *.ts          # Shared actions
├── shared/            # Cross-portal shared code
│   ├── components/    # Reusable UI components
│   ├── hooks/         # Custom React hooks
│   ├── stores/        # Zustand state stores
│   └── utils/         # Utility functions
├── lib/              # Core utilities and configurations
├── types/            # TypeScript type definitions
├── validations/      # Zod validation schemas
├── repositories/     # Data access layer
├── services/         # Business logic services
├── config/           # Application configuration
├── emails/           # Email templates
└── middleware.ts     # Portal routing and auth middleware
```

## Critical Import Rules

### ✅ Allowed Cross-Portal Imports
- `src/shared/components/*` - Generic UI components
- `src/lib/*` - Utility functions and clients
- `src/types/*` - TypeScript definitions
- `src/validations/*` - Zod schemas

### ❌ Forbidden Import Patterns
- Never import between portal directories (admin ↔ customer ↔ rider)
- Never import admin-actions in customer/rider portals
- Never mix Supabase clients (browser client in server components)
- Never import Next.js router hooks in server actions

## Component Hierarchy
- **Server Components**: Default for all pages and layouts
- **Client Components**: Only for interactive leaves (forms, maps, toggles)
- **Shared Components**: Portal-agnostic UI in `src/shared/components/`
- **Portal-Specific**: Components tied to specific business logic

## Database Integration
- **Server Components**: Use `createServerClient` for data fetching
- **Server Actions**: Use `createAdminClient` for admin operations, regular client for user-scoped operations
- **Client Components**: Receive data as props, use React Query for client-side fetching

## File Naming Conventions
- **Actions**: `*Actions.ts` (e.g., `subscriptionActions.ts`)
- **Components**: PascalCase (e.g., `CustomerProfile.tsx`)
- **Pages**: `page.tsx` (Next.js App Router convention)
- **Layouts**: `layout.tsx` (Next.js App Router convention)
- **Types**: `types.ts` or `index.ts` in type directories