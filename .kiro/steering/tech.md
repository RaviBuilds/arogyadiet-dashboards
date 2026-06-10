# Technical Stack & Build System

## Core Technologies
- **Framework**: Next.js 16.2.6 (App Router, Server Components, Server Actions)
- **Language**: TypeScript 5
- **Runtime**: React 19.2.4
- **Database**: Supabase (PostgreSQL with Row Level Security)
- **Authentication**: Supabase Auth (Email/Password & OTP)
- **Styling**: Tailwind CSS 4, PostCSS
- **UI Components**: Shadcn UI, Radix UI primitives
- **State Management**: Zustand, React Query (TanStack Query)
- **Forms**: React Hook Form with Zod validation
- **Deployment**: Vercel

## Key Libraries
- **Maps & Geolocation**: Google Maps API, Capacitor Geolocation
- **Payments**: Razorpay integration
- **Notifications**: OneSignal
- **Data Visualization**: Recharts
- **File Handling**: React Dropzone, XLSX
- **Date Handling**: date-fns, React Day Picker
- **Email**: Resend

## Build Commands

### Development
```bash
npm run dev          # Start development server (includes memory optimization)
```

### Production
```bash
npm run build        # Build for production (includes memory optimization)
npm run start        # Start production server
```

### Code Quality
```bash
npm run lint         # Run ESLint
```

## Memory Optimization
The project uses `cross-env NODE_OPTIONS=--max-old-space-size=4096` for both dev and build commands to handle large bundle sizes.

## Architecture Patterns
- **Server-First Philosophy**: Default to React Server Components, minimize client components
- **Subdomain Routing**: Middleware-based portal routing via subdomains
- **Server Actions**: Mutations handled via Next.js Server Actions in `/src/actions/`
- **SSR Authentication**: Supabase SSR for server-side session management
- **RLS Security**: Database-level security via PostgreSQL Row Level Security

## Development Guidelines
- Always use TypeScript strict mode
- Prefer Server Components over Client Components
- Use Zod for all form validation and API schemas
- Follow Shadcn UI patterns for consistent styling
- Implement proper error boundaries and loading states