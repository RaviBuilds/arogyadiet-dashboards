# 00 — Start Here

These docs explain how the ArogyaDiet codebase is wired: which file calls which, where data comes from and goes, and why. They were written by reading the code on 2026-11-02 (commit `0e3fadd`). Where the code and the older docs disagree, the code wins and the disagreement is noted. "UNVERIFIED" marks claims that depend on things outside the repo (live database settings, the separate Android repo, Vercel config).

## How to use them
1. Read in the order below; each doc assumes the previous ones.
2. Keep the repo open beside the doc and open every file path mentioned — the "Trace it yourself" sections tell you which ones.
3. Draw the Mermaid diagrams yourself once from memory; that is the fastest way to remember flows.
4. Use `17-self-quiz-and-exercises.md` and `interview-prep/` to test yourself.

## Reading order
| # | Doc | Why |
|---|---|---|
| 1 | `01-big-picture.md` | Product, portals, tenancy, architecture |
| 2 | `04-request-lifecycle.md` | One request end to end, file by file |
| 3 | `05-auth-and-single-login.md` | Logins and sessions |
| 4 | `06-rbac-and-multitenancy.md` | Who can do what, and where it is checked |
| 5 | `07-database-for-a-frontend-dev.md` | DB concepts using this schema |
| 6 | `08-server-actions-services-repositories.md` | Layering + action map |
| 7 | `flows/*` | Eleven end-to-end traces (10 files; KIT and stay share one) |
| 8 | `modules/*` | 25 module deep-dives |
| 9 | `10-cron-and-automation.md`, `09-integrations.md`, `11-native-mobile-capacitor.md` | Automation, third parties, Android |
| 10 | `12`, `13`, `14` | Front-end patterns, sources of truth, tests |
| 11 | `15`, `16` | Specs digest, known issues (your client to-do list) |
| 12 | `interview-prep/*`, `17` | Practice |
| ref | `02-glossary.md`, `03-folder-and-file-map.md` | Look things up any time |

## 5-day study plan (Feb 2–6)
Assumption: Feb 2–6, 2027, about 6 focused hours per day. Adjust times freely.

### Day 1 (Feb 2) — The map
| Time | Task |
|---|---|
| 09:00–10:30 | `01-big-picture.md`; redraw the architecture diagram from memory |
| 10:45–12:15 | `03-folder-and-file-map.md` sections 1–3; open each portal's `(main)/layout.tsx` |
| 13:15–14:45 | `04-request-lifecycle.md`; follow Example A in the code |
| 15:00–16:30 | `flows/middleware-decision-tree.md` + read `src/middleware.ts` top to bottom |
**Checkpoint**: explain without notes how `franchies.arogyadiet.com/inventory` reaches `receive_franchise_transfer`. Answer quiz A2, B1, D6.

### Day 2 (Feb 3) — Auth, RBAC, tenancy
| Time | Task |
|---|---|
| 09:00–10:30 | `05-auth-and-single-login.md` + `flows/customer-login.md`; read `pinAuthActions.ts` |
| 10:45–12:15 | `06-rbac-and-multitenancy.md`; read `src/lib/auth/adminAccessCore.ts` fully |
| 13:15–14:30 | `flows/franchise-permission-check.md`; read `adminAccess.ts` franchise guards |
| 14:45–16:30 | `modules/master-users-and-access.md`, `modules/franchise-portal-operations.md`; `interview-prep/security-rbac-questions.md` 1–10 |
**Checkpoint**: list the five layers of checks with file names; explain why NULL access level = full access; explain why session-variable RLS doesn't work over PostgREST.

### Day 3 (Feb 4) — Database and money
| Time | Task |
|---|---|
| 09:00–11:00 | `07-database-for-a-frontend-dev.md`; read `create-dispatch-to-franchise-rpc.sql` and the KIT trigger |
| 11:15–12:30 | `08-server-actions-services-repositories.md` |
| 13:30–15:00 | `modules/customer-subscription-checkout.md`, `flows/subscription-purchase-razorpay.md`, `modules/shop-and-addons.md`, `flows/shop-order-with-webhook.md` |
| 15:15–16:30 | `modules/partial-payments-and-billing.md`, `09-integrations.md` Razorpay section; `interview-prep/backend-database-questions.md` |
**Checkpoint**: explain HMAC verification, the webhook's idempotency, and why subscriptions lack a webhook (and the fix).

### Day 4 (Feb 5) — Operations, riders, native
| Time | Task |
|---|---|
| 09:00–10:30 | `10-cron-and-automation.md`, `flows/daily-order-generation-and-dispatch.md` |
| 10:45–12:15 | `modules/dispatch-and-routing.md`; read `routeEngine.ts` `dispatchScope` |
| 13:15–14:45 | `modules/rider-duty-and-gps.md`, `rider-route-and-delivery.md`, `rider-payouts.md`, `flows/rider-duty-delivery-payout.md` |
| 15:00–16:30 | `11-native-mobile-capacitor.md`; skim `LocationForegroundService.java` |
**Checkpoint**: describe the 24-hour timeline (14:00, 17:00, 17:15, 23:55, 01:00, every 5 min) and why GPS upload is native.

### Day 5 (Feb 6) — Remaining modules + interview drill
| Time | Task |
|---|---|
| 09:00–10:30 | Remaining modules: inventory (central, clinic, franchise), KIT, stay, dietitian, master hierarchy/BI, notifications, APK |
| 10:45–12:00 | `12`, `13`, `14`, `15` |
| 13:00–14:00 | `16-known-issues-and-tech-debt.md` (know the top 10 by heart) |
| 14:15–15:30 | `interview-prep/pitch.md` — say the 30 s, 2 min, 10 min pitches aloud, record yourself |
| 15:45–17:00 | `17-self-quiz-and-exercises.md` all sections; `tricky-questions.md`; `weak-spots-and-honest-answers.md` |
**Checkpoint**: score ≥ 80% on the quiz without looking; deliver the 2-minute pitch without notes.

## The first three files to read
1. `01-big-picture.md`
2. `04-request-lifecycle.md`
3. `06-rbac-and-multitenancy.md`

## Important before client work
Read `16-known-issues-and-tech-debt.md` items 1–8 first: there are unauthenticated ops routes and ungated Server Actions that should be fixed before anything else.
