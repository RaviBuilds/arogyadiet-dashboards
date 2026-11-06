# Weak Spots and Honest Answers

Rule: state the issue plainly, explain why it exists, give the fix and its priority. Interviewers trust candidates who know their system's flaws.

| Weak spot | Honest answer | What I'm doing about it |
|---|---|---|
| Some Server Actions and two API routes lack auth | "My audit found temporary ops routes and actions where the gate was missing. They were written as one-offs or assumed the page was protected, which isn't enough for Server Actions." | Delete ops routes, add gates, add a static test that fails if an exported action has no gate (`16` items 1–3). |
| Temp-PIN set without proof | "The set-new-PIN step trusts the mobile number; it should require a token from the verify step." | Short-lived token + `is_temp_pin` check. |
| Shared customer password | "It was the fastest way to make PIN login produce a normal Supabase session without touching RLS." | Per-user credentials or server-minted sessions. |
| Tenancy enforced in app, not DB | "RLS policies exist, but session variables don't persist across PostgREST requests, so we enforce scope in code with the service role." | JWT-claim RLS as the long-term fix. |
| Subscription payment not webhook-backed | "Shop orders have a webhook backstop; subscriptions don't, because checkout data isn't saved before payment." | Pending-checkout record + idempotent activation RPC. |
| Non-atomic multi-step writes | "Checkout activation, pause reconciliation and warehouse dispatch are sequences of queries." | Move each to a Postgres function, like the franchise transfer RPCs. |
| Payout column mismatch | "Leaderboard reads a column nobody writes." | Generated column or switch readers. |
| Cron secret in SQL file | "Committed to the repo for convenience." | Rotate, store in Vault, send as header. |
| No end-to-end tests for payments | "Strong property tests on rules; weak on integration with Razorpay." | Mocked Razorpay tests + webhook tests. |
| Native GPS tested on one device | "Proven on a Vivo under forced Doze; OEM killers remain outside our control." | Pilot data across brands; in-app battery onboarding. |
| Docs/checklists drift | "AI-written docs aged as code changed." | This learning-docs set; trust code over old docs. |
| Heavy reliance on AI agents | "Yes — and that's why I built verification habits: specs, property tests, reviews, and a full audit." | Continue spec-first, add CI checks. |

Answer template:
1. "Here's the issue: …" (one sentence, concrete file)
2. "It happened because …" (trade-off, not excuse)
3. "The impact is …" (realistic)
4. "The fix is … and I'd prioritise it as …"

Example: "The rider leaderboard reads `net_payable`, but our monthly job writes `total_earnings`. It came from two features built at different times. Riders see zero on the leaderboard, not wrong pay. Fix is a generated column `net_payable = total_earnings + adjustments`, half a day."
