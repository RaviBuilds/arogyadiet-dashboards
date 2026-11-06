# Project Pitches — ArogyaDiet

Numbers you can quote (verified from the repo on 2026-11-02): 5 portals on one Next.js 16 app; ~1,350 files in `src/`; ~130 SQL migration/RPC scripts; `SECURITY DEFINER` functions defined across 42 of those scripts; 318 test files, 196 of them property-based; 10 cron routes (8 scheduled by Supabase pg_cron); 29 Kiro feature specs; a native Android GPS plugin of 19 Java files. Do not quote user counts or revenue — they are not in the repo.

---

## 30-second pitch
"ArogyaDiet is a real client project: a health-food business that sells meal subscriptions, diet kits and wellness stays. I built and now maintain the platform that runs it — one Next.js 16 and Supabase app serving five portals by subdomain: customers, delivery riders, admins, franchise partners and a master super-admin. It handles subscriptions with a pause calendar and a 5 PM cutoff, Razorpay payments with a webhook backstop, a nightly pipeline that generates orders and builds Google-optimised rider routes per clinic, distance-based rider payouts, multi-tenant franchises with their own stock, and an Android rider app whose GPS keeps working with the screen locked."

## 2-minute pitch
"The business has three product lines — daily meal subscriptions, shipped diet kits, and clinic stays — plus add-on shop products. Operations are run by a core team and by franchise partners in other cities.

Architecturally it's one Next.js 16 App Router app on Vercel. Middleware reads the subdomain, rewrites to the right portal folder, refreshes the Supabase session and enforces the role for that portal. Pages are Server Components that read from Postgres; client components call Server Actions; heavier multi-table writes go into Postgres functions so they're atomic — for example, franchise stock transfers deplete warehouse lots FIFO inside one transaction with row locks.

Access control is layered: role per portal, then access levels and per-section manage/view permissions for admins and franchise users, and every write re-checks tenancy so a franchise can only touch its own `franchise_id` rows.

Every evening a Supabase pg_cron job calls our API to turn the meal calendar into tomorrow's delivery orders; at night it links paid add-ons, assigns riders by pincode and calls the Google Routes API for an optimised two-wheeler route per clinic, falling back to Haversine distance if Google fails. Riders' payouts are computed per stop from that distance.

The rider app is a Capacitor shell that loads the web portal. The tricky part was GPS: Android throttles WebView JavaScript, so I moved uploads into a native foreground service with an SQLite queue and a heartbeat — it survived forced Doze testing.

I used AI agents heavily, but with specs, tests — about 200 property-based tests — and code review; and recently I did a full audit of the system, which surfaced security issues I'm now fixing."

## 10-minute pitch (structure + talking points)

1. **Business and users (1 min)** — three product lines, five user types, why subdomains (separate trust zones, separate logins, one codebase). Show `01-big-picture.md` diagram.
2. **Request lifecycle (1.5 min)** — middleware → layout → RSC → client → Server Action → zod → service → RPC → `revalidatePath` + `router.refresh()`. Use the franchise "Confirm Received" example (`04`).
3. **Auth (1 min)** — staff email/password with role check; customers mobile + PIN (bcrypt, throttle) mapped onto a Supabase session; why PIN replaced OTP (cost, reliability).
4. **RBAC + multi-tenancy (1.5 min)** — `adminAccessCore.ts` pure rules shared by middleware and layouts; manage/view groups; franchise owner override; tenancy enforced in app code with service role; honest note that session-variable RLS doesn't survive PostgREST's per-request transactions, so I'd move to JWT-claim policies.
5. **Data model highlights (1 min)** — materialised per-day subscription calendar; immutable clinic stamps; ledgers with derived balances; triggers for KIT end dates.
6. **Daily automation (1.5 min)** — pg_cron → GET routes with secret → `after()` follow-ups; idempotent re-runs; Google Routes with field masks, 20-stop cap, fallback; manual recovery in the operations console.
7. **Payments (1 min)** — server-side price authority, HMAC verification, reconcile via Razorpay API on app resume, webhook for shop orders; known gap for subscriptions and the planned fix (pending-checkout record + idempotent RPC).
8. **Native GPS (1 min)** — root cause, foreground service, durable queue, heartbeat, boot/restart paths, OEM battery killers and the in-app onboarding.
9. **Quality and what I'd improve (0.5 min)** — property tests, DB integration tests, architecture test; next: gate every action with a static check, revoke RPC execute, atomic subscription activation.

## Talking about AI-assisted development (honest and confident)

Short version:
"Most of the code was generated with AI agents (Kiro), but I drove it like a tech lead: I wrote or approved a spec for each feature — requirements, design and a task list — reviewed the output, insisted on tests for the business rules, and verified behaviour on real devices and data. The specs are in the repo, and the code comments reference requirement numbers, so every decision is traceable."

When pushed ("So did you write it?"):
"I didn't type most lines, the same way a lead doesn't type every line on a team. My work was deciding the architecture — subdomain portals, Server Actions plus Postgres functions for atomic writes, pg_cron for scheduling, native GPS upload — breaking work into specs, reviewing diffs, and debugging production issues like the GPS dying in Doze or nightly routing failing because a permission gate ran inside a cron. Recently I audited the whole codebase end to end; that's how I found an unauthenticated password-reset route and several Server Actions without permission checks. Owning a system means knowing its weak spots too, and I can walk you through any part of it."

What to avoid: claiming you hand-wrote everything; being apologetic. What to emphasise: decisions, verification, debugging, and the audit.

## Phrases to have ready
- "Server Actions are public POST endpoints, so each one owns its authorization."
- "Anything multi-row that must be all-or-nothing is a Postgres function."
- "Tenancy comes from the session, never from the request."
- "Re-running any nightly job is safe by design: skip-existing or reset-then-rebuild."
- "Derive balances from ledgers; never store a second source of truth."
