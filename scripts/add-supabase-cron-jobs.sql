-- ============================================================================
-- Supabase pg_cron jobs — canonical, complete reference for ALL scheduled
-- automations. Run this in the Supabase SQL Editor to (re)create every cron
-- job in a known-good state.
--
-- IMPORTANT: The API routes under src/app/api/cron/* export ONLY a GET handler.
-- Therefore every job MUST call net.http_get (NOT net.http_post). Using
-- http_post causes the endpoint to return HTTP 405 Method Not Allowed, which
-- silently skips the automation while cron.job_run_details still shows
-- "succeeded" (that only means pg_net queued the request).
--
-- The `secret` query param is validated against the CRON_SECRET env var in each
-- route. All schedules are in UTC. IST = UTC + 5:30.
--
-- TIMEOUT: net.http_get defaults to a 5000ms timeout. Endpoints now return HTTP
-- 200 as soon as their MAIN task finishes (order creation, product linking)
-- and run follow-up work (notifications, dispatch) AFTER the response via
-- Next's after(). Even so, we pass timeout_milliseconds := 30000 on the heavier
-- jobs so a slow cold start / main task never records a false pg_net timeout.
--
-- cron.schedule(jobname, ...) is idempotent by name: re-running this script
-- UPDATES the existing job of the same name rather than creating duplicates.
-- ============================================================================

-- auto-off-duty-sweep: every 5 minutes.
-- Sweeps riders off-duty when idle.
SELECT cron.schedule(
  'auto-off-duty-sweep',
  '*/5 * * * *',
  $$ SELECT net.http_get('https://admin.arogyadiet.com/api/cron/auto-off-duty?secret=arogyadietcron-123') AS request_id; $$
);

-- activate-subscriptions: daily at 08:30 UTC (2:00 PM IST).
-- Activates due subscriptions and cleans up concluded plans.
SELECT cron.schedule(
  'activate-subscriptions',
  '30 8 * * *',
  $$ SELECT net.http_get('https://admin.arogyadiet.com/api/cron/activate-subscriptions?secret=arogyadietcron-123') AS request_id; $$
);

-- generate-orders: daily at 11:45 UTC (5:15 PM IST).
-- Generates tomorrow's delivery_orders from active subscriptions.
SELECT cron.schedule(
  'generate-orders',
  '45 11 * * *',
  $$ SELECT net.http_get(
       url := 'https://admin.arogyadiet.com/api/cron/generate-orders?secret=arogyadietcron-123',
       timeout_milliseconds := 30000
     ) AS request_id; $$
);

-- expire-kits: daily at 18:00 UTC (11:30 PM IST).
-- Expires eligible kits.
SELECT cron.schedule(
  'expire-kits',
  '0 18 * * *',
  $$ SELECT net.http_get('https://admin.arogyadiet.com/api/cron/expire-kits?secret=arogyadietcron-123') AS request_id; $$
);

-- link-products: daily at 18:25 UTC (11:55 PM IST).
-- Links paid addon shop products to delivery_orders, then internally triggers
-- the dispatch/routing step (creates batches + assigns riders).
SELECT cron.schedule(
  'link-products',
  '25 18 * * *',
  $$ SELECT net.http_get(
       url := 'https://admin.arogyadiet.com/api/cron/link-products?secret=arogyadietcron-123',
       timeout_milliseconds := 30000
     ) AS request_id; $$
);

-- transition-stays: daily at 19:30 UTC (1:00 AM IST next day).
-- Transitions accommodation stays: PENDING -> ACTIVE, ACTIVE -> FINISHED.
SELECT cron.schedule(
  'transition-stays',
  '30 19 * * *',
  $$ SELECT net.http_get('https://admin.arogyadiet.com/api/cron/transition-stays?secret=arogyadietcron-123') AS request_id; $$
);

-- cleanup-dispatch-images: daily at 03:00 UTC (8:30 AM IST).
-- Removes expired dispatch proof images.
SELECT cron.schedule(
  'cleanup-dispatch-images',
  '0 3 * * *',
  $$ SELECT net.http_get('https://admin.arogyadiet.com/api/cron/cleanup-dispatch-images?secret=arogyadietcron-123') AS request_id; $$
);

-- cleanup-old-po: monthly on the 1st at 22:30 UTC (4:00 AM IST on the 2nd).
-- Cleans up purchase order files older than 3 months.
SELECT cron.schedule(
  'cleanup-old-po',
  '30 22 1 * *',
  $$ SELECT net.http_get('https://admin.arogyadiet.com/api/cron/cleanup-old-po?secret=arogyadietcron-123') AS request_id; $$
);

-- ============================================================================
-- Verification helpers (run individually after scheduling):
--
--   -- List all jobs and confirm they use http_get:
--   SELECT jobid, jobname, schedule, active, command FROM cron.job ORDER BY jobname;
--
--   -- Confirm recent HTTP responses are 200 (not 405):
--   SELECT status_code, created FROM net._http_response ORDER BY created DESC LIMIT 10;
-- ============================================================================
