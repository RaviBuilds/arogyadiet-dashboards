# Tricky Questions

**1. "Server Actions are secure because they run on the server, right?"**
No. Running on the server protects secrets, not access. Each action is a POST endpoint any client can call with its id; it must authenticate and authorise. This project has examples of both done right (`franchiseInventoryActions.ts`) and missing (`master-actions/adminActions.ts`).

**2. "If middleware checks roles, why check again in actions?"**
Middleware doesn't run for `/api`, may not cover a path, and actions can be invoked from any page that bundles them (shared components). Defense in depth.

**3. "You bypass RLS with the service role everywhere. Isn't that bad?"**
It's a deliberate trade-off for cross-tenant admin work; the cost is that the app must enforce scope consistently. I'd move tenant policies to JWT claims so the DB enforces it even for service-like flows that use user tokens.

**4. "Why does franchise RLS not work with `set_config`?"**
`set_config(..., true)` is transaction-local; PostgREST runs each request in its own transaction, so a context set by one RPC is gone by the next query.

**5. "What if two admins dispatch the same stock at once?"**
Franchise dispatch: safe (`FOR UPDATE` in one transaction). Central warehouse dispatch: not safe (JS loop without locks) — a known fix.

**6. "What happens if the 17:15 cron runs twice?"**
Second run inserts nothing: existing (customer, meal category) keys are skipped. A UNIQUE constraint would make it race-proof.

**7. "A customer pauses tomorrow at 17:05. What happens?"**
Rejected by `isPastNextDayCutoff` (after 17:00 the earliest editable day is the day after tomorrow); orders at 17:15 use the existing calendar.

**8. "How can a customer have two subscriptions?"**
Buying while active creates PENDING; `cascadePendingSubscriptionDates` starts it after the current one ends; 14:00 cron activates it.

**9. "How do you know a rider's app is still running?"**
30-second native heartbeat updates `rider_live_locations.updated_at`; sweep flips riders off after the stale window unless mid-delivery.

**10. "Why not WebSockets from the rider app?"**
The WebView is throttled in the background; a native HTTP uploader with a durable queue is simpler and survives process death.

**11. "Is the anon key in the APK a problem?"**
No by itself — it's public. The problem is what it can do: it can call the GPS RPC for any rider and possibly other SECURITY DEFINER functions if EXECUTE isn't revoked.

**12. "Your payout leaderboard — where does the number come from?"**
Honest answer: it reads `net_payable`, which nothing in the codebase writes; history uses `total_earnings`. It's on my fix list.

**13. "Why is the middleware file still called middleware.ts in Next 16?"**
The project predates the rename; it's deprecated but supported. There is an official codemod to `proxy.ts`.

**14. "What does `after()` guarantee?"**
It runs after the response is sent within the same invocation (bounded by `maxDuration`); not a durable queue — if it crashes, the sub-task is logged failed and admins re-run manually.

**15. "How do you test code that depends on the current time?"**
Pure helpers that take `now` as input (`istHourOf`, `isPastNextDayCutoff(now, date)`) and property tests over generated instants.

**16. "How do you avoid floating-point money bugs?"**
Accommodation uses paise integers (`toPaise`/`fromPaise`); Razorpay amounts are `Math.round(total * 100)`. Meal subscription code uses floats then rounds — a consistency gap.

**17. "What's the most surprising bug you fixed?"**
Nightly product linking failed because a permission gate ran during cron (no session) → routing never ran → riders unassigned. Fix: gate only manual runs (comment in `systemActions.ts`). Lesson: and then the gate placement itself became a security gap (default `source = "cron"`), so the proper fix is a private function plus a gated wrapper.

**18. "Why both `customer_profiles.clinic_id` and `addresses.clinic_id` and `delivery_orders.clinic_id`?"**
Profile = aligned clinic for shop; address = clinic resolved from pincode for each address; order = immutable stamp at creation so history doesn't change when addresses or clinics change.

**19. "What breaks if FRANCHISE_FEATURES_ENABLED is unset in production?"**
All franchise scope resolution returns unresolved; franchise inventory/disputes actions refuse; routing only does core clinics; middleware franchise-only branches inert. Core keeps working.

**20. "How much of this did you actually write?"**
See `pitch.md`: AI-generated under specs I directed and reviewed; I own architecture decisions, debugging and the audit; I can trace any flow file by file.
