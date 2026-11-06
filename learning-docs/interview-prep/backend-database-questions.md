# Backend and Database Questions

**1. Walk me through the main tables.**
`users` (+ `roles`) → `customer_profiles`/`rider_profiles`; `subscriptions` → `subscription_daily_preferences` (one row per day); `delivery_orders` → `delivery_batches`; `payments` (= invoices) → `razorpay_transactions`; shop `addon_orders`; inventory lots + transactions; franchise and clinic hierarchy. See `07`.

**2. Why a row per day for subscriptions?**
Each day can differ (pause, meal type, address). Order generation becomes `WHERE preference_date = tomorrow AND NOT is_paused`. Cost: reconciling rows when pauses extend the end date.

**3. How does the pause engine keep data consistent?**
After updates it walks the calendar from `starts_on` counting non-paused days to `total_days`, inserts missing days, deletes extra, recounts paused rows into `pause_credits_used`. Weakness: multi-query, not atomic (`manageMealActions.ts`).

**4. When do you use an RPC?**
Multi-table atomic writes, read-then-write races (stock), anon-callable narrow writes (GPS), invariants for all clients. Examples: `onboard_customer`, `dispatch_to_franchise`, `clinic_shop_apply_sale`, `upsert_rider_live_location`.

**5. Explain SECURITY DEFINER and its risks.**
Runs with the owner's privileges, bypassing RLS. Must set `search_path`, validate inputs and restrict who may EXECUTE. Repo scripts set `search_path` but mostly don't revoke EXECUTE from `anon/authenticated` — a gap to fix.

**6. How do you prevent overselling?**
`UPDATE ... SET stock = stock - qty WHERE stock >= qty` under `FOR UPDATE` locks in a deterministic order (`clinic_shop_apply_sale`); `decrement_franchise_product_stock` returns false on shortfall; app flags `fulfillment_status`.

**7. How is FIFO implemented?**
`ORDER BY expiry_date, created_at FOR UPDATE`, deduct `LEAST(remaining, lot_qty)` per lot, mark DEPLETED at 0, one transfer line per lot (`create-dispatch-to-franchise-rpc.sql`). Central dispatch does the same loop in TS with manual rollback (weaker).

**8. Triggers you used and why.**
KIT tracker sync (recount skipped days → end date, row lock), received-date lock (raise 23514), category guards, clinic ledger immutability, clinic stock increase guard, admin clinic must be core.

**9. How do migrations work?**
Hand-run idempotent SQL in `scripts/` with documented ordering and rollback; a few in `supabase/migrations`. No runner → which ran in prod is unverified; code tolerates missing columns (42703 fallback).

**10. How are payments stored and reconciled?**
`payments` row per invoice with breakdown; `razorpay_transactions` audit; partial payments via append-only ledger and RPC returning `{ok, reason}`; balance derived. Razorpay HMAC verification; webhook idempotency on payment id.

**11. Idempotency examples?**
Order generation skip-existing keys; dispatch reset-then-rebuild; `receive_franchise_transfer` RECEIVED no-op; webhook checks existing transaction; snapshots upsert. Gap: subscription verify path.

**12. How does authentication integrate with Postgres?**
`users.auth_user_id` links to `auth.users`; RLS uses `auth.uid()`; dietitian helpers `current_dietitian()`/`dietitian_can_read_customer()` are SECURITY DEFINER to avoid recursive RLS.

**13. How do you query with joins in supabase-js?**
Nested selects (`roles(code)`), explicit FK hints (`customer_profiles!customer_profiles_user_id_fkey(...)`) when ambiguous, `!inner` for inner joins, `{ count: "exact", head: true }` for counts.

**14. Transactions across services?**
Not possible across Supabase Auth and Postgres; use compensation (delete auth user on RPC failure).

**15. How are notifications delivered?**
Insert `notifications` rows, OneSignal REST push by `external_id`, Resend email; fire-and-forget. See `modules/notifications.md`.

**16. What indexes matter?**
`customer_profile_id`, `delivery_date`, `franchise_id`, status columns; e.g. `idx_stay_entries_status`, `idx_groups_city`, `add-customer-profile-id-indexes.sql`. Missing UNIQUE on order generation key is a hardening idea.

**17. How do you handle schema drift in code?**
Lenient readers (`resolveAccessConfiguration`), retry without optional column on 42703 (`getCurrentAdminContext`), additive nullable columns.

**18. How does the cron authenticate?**
Shared secret query param compared to `CRON_SECRET`, failing closed when unset (except two routes with literal fallbacks — to fix).

**19. How are monthly rider payouts computed?**
Sum DELIVERED `payout_amount` for 27th→26th, skip dates covered by custom summaries, insert `rider_monthly_summaries` (GENERATED → PAID). Known mismatch with `net_payable`.

**20. Biggest backend bug you'd fix first?**
Ungated privileged actions and the unauthenticated password-reset route (`16`, items 1–3).

**21. How would you test SQL functions?**
`src/test/db` harness runs scripts with `psql` against a scratch DB (`TEST_DATABASE_URL`), plus property tests against TS reference models (`src/test/shop/clinicStockModel.ts`).
