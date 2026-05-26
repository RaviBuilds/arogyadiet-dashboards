# Core Project Architecture

This document outlines the core architecture and technical stack conventions for the Arogyadiet application.

## 1. Primary Frameworks & Tech Stack

The application is built on a modern React ecosystem, utilizing the following primary frameworks and libraries:

*   **Framework:** Next.js (App Router)
*   **UI Library:** React
*   **Styling:** Tailwind CSS
*   **Component Library:** Shadcn UI (built on top of Radix UI primitives and Tailwind)
*   **State Management:** Zustand (Client state), React Query (Server state/caching)
*   **Database & Backend as a Service (BaaS):** Supabase (Authentication, PostgreSQL Database)
*   **Forms & Validation:** React Hook Form + Zod

## 2. Folder Structure Conventions

The project follows a structured approach within the `src/` directory to separate concerns:

*   **`src/app/`**: Contains the Next.js App Router routing logic. The application is divided into distinct sections based on user roles and features (e.g., `/admin`, `/customer`, `/rider`, `/master`). It also includes `/api` for dedicated API routes (e.g., webhooks, auth callbacks, cron jobs).
*   **`src/actions/`**: Houses all Next.js Server Actions. This is where business logic and direct database interactions (via Supabase) occur. It's organized by domain/feature (e.g., `admin-actions`, `authActions.ts`).
*   **`src/shared/`**: Contains globally reusable elements.
    *   **`src/shared/components/`**: Reusable UI components, including base UI elements (like Shadcn components), forms, and layout structures. This is aliased as `@/components/*` in `tsconfig.json`.
    *   **`src/shared/hooks/`**: Custom React hooks (aliased as `@/hooks/*`).
    *   **`src/shared/utils/`**: Utility functions and helpers (aliased as `@/utils/*`).
*   **`src/lib/`**: Core library configurations and initializations (e.g., Supabase client/server setup, logging).
*   **`src/modules/`**: Contains feature-specific or domain-specific components and logic that are not globally shared (e.g., `customer`, `admin`, `rider`, `meals`).
*   **`src/validations/`**: Zod schemas used for form validation and API payload verification.

## 3. Client vs. Server Components

The project strictly adheres to Next.js App Router conventions regarding Server and Client Components to optimize performance and security:

*   **Server Components (Default):** All components inside `src/app/` are Server Components by default. They are used for fetching data, accessing backend resources securely (without exposing secrets), and rendering static UI. They do not support interactivity (e.g., `onClick`, `useState`).
*   **Client Components (`"use client"`):** Used exclusively for components that require browser interactivity, access to browser APIs (like `window` or `localStorage`), or client-side state management (React hooks). They must explicitly declare `"use client"` at the very top of the file. To maximize performance, Client Components are pushed as far down the component tree as possible (leaves).

## 4. Data Fetching Conventions

Data fetching and mutations are primarily handled through the following patterns:

*   **Supabase Server Actions (Primary):** Next.js Server Actions (located in `src/actions/`) are the preferred method for mutating data and fetching data from the Supabase database. They provide a secure way to execute server-side code directly from Client Components or Server Components without needing to create separate API endpoints.
*   **API Routes (Secondary):** Next.js Route Handlers (`src/app/api/`) are reserved for specific use cases where Server Actions are not suitable, such as:
    *   Webhooks (e.g., Payment gateways).
    *   Third-party API integrations that require a dedicated endpoint.
    *   Authentication callbacks (e.g., OAuth redirects).
    *   Cron jobs or background tasks.
*   **Client-Side Fetching:** When data needs to be fetched or mutated from the client (e.g., for highly interactive UI elements), React Query is often used in combination with Server Actions or API routes to handle caching, loading states, and background updates.
