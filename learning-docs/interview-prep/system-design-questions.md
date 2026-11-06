# System Design Questions (grounded in this project)

**1. Design a subscription meal delivery system.**
Use this project: plans → subscriptions → per-day calendar → nightly order generation → per-clinic dispatch with route optimisation → rider app → delivery statuses → payouts. Discuss cutoffs (17:00 IST), idempotent jobs, and per-day overrides.

**2. How would you make the nightly pipeline reliable at 10× scale?**
Split work per clinic into queued jobs (one message per clinic), idempotency keys per (clinic, date), retries with backoff, dead-letter alerting, chunked inserts, a UNIQUE constraint on (customer, date, meal category). Today it's one HTTP call doing all clinics.

**3. Payment flow with unreliable mobile clients?**
Persist intent before payment (pending checkout with server-computed amount), Razorpay order with intent id in notes, verify by client HMAC or webhook, single idempotent activation RPC keyed on payment id, reconciliation job for stuck intents. Shop flow already follows the first half.

**4. Real-time rider tracking design?**
Native service → durable queue → upsert latest location (one row per rider) → Supabase Realtime to customers; heartbeat for liveness; staleness sweep; optional history table for analytics. Trade-off: anon-key RPC vs authenticated device tokens.

**5. Multi-tenant SaaS: options?**
Column (`franchise_id`) vs schema vs database per tenant. Chosen: column + app-level scope + RPC checks. Improvement: JWT-claim RLS so the DB enforces it too.

**6. Inventory with batches and expiry?**
Lots with FIFO by expiry, append-only ledger, transfers as a state machine, atomic RPCs with row locks, parity checks between ledger and stock.

**7. Rate limiting and abuse prevention?**
PIN throttle table per mobile; APK download per hashed IP after Turnstile; would add IP-level limits on login actions and webhook replay protection.

**8. Notification system at scale?**
Outbox table written in the same transaction as the business change, worker sends push/email with retries, user preferences, dedupe topics (`web_push_topic`).

**9. Reporting/BI without hurting OLTP?**
Materialised views refreshed by cron, or a read replica; today BI aggregates in Node from service-role reads.

**10. Zero-downtime schema changes?**
Additive nullable columns, backfill, then constraints; code tolerant to missing columns; flags to enable features — exactly the pattern in `scripts/`.

**11. How to support iOS later?**
Capacitor iOS target; background location needs Significant-Change or region monitoring and `UIBackgroundModes`; same RPC upload.

**12. Offline support for riders?**
Status updates queued locally (like the GPS queue) with conflict rules; currently only GPS is offline-tolerant.

**13. Feature flags?**
Env flag resolved once (`resolveFranchiseFeatureFlag`); for gradual rollout use a DB-backed flag table per tenant.

**14. How would you split this into services if needed?**
Natural seams: payments, dispatch/routing engine, inventory, notifications. Start by extracting the routing engine into a worker since it's CPU/IO heavy and scheduled.

**15. Disaster scenario: Google Routes outage at 23:55.**
Fallback to Haversine route keeps batches flowing; payouts approximate; flagged in `routingFallbacks`; admin can re-run routing later.

**16. Disaster scenario: Supabase down.**
App unusable (single dependency); mitigate with status page, retries, and read-only cached pages for customers; native GPS queue keeps data until recovery.

**17. How would you design the cutoff rule to be tamper-proof?**
Enforce in the DB: a trigger on `subscription_daily_preferences` rejecting edits for locked dates (today only enforced in actions).

**18. Cost control?**
Field-masked Routes requests, ≤20 stops per call, pincode geocode cache per run, PIN instead of SMS OTP, push via OneSignal free tier (UNVERIFIED plan).
