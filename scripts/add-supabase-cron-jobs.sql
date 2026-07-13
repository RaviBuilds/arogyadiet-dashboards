-- ============================================================================
-- Additional Supabase pg_cron jobs
-- Run this in the Supabase SQL Editor to add missing cron schedules.
-- ============================================================================

-- transition-stays: Runs daily at 1:00 AM IST (7:30 PM UTC previous day)
-- Transitions accommodation stays: PENDING → ACTIVE, ACTIVE → FINISHED
SELECT cron.schedule(
  'transition-stays',
  '30 19 * * *',
  $$
  SELECT net.http_post(
    url := 'https://admin.arogyadiet.com/api/cron/transition-stays?secret=arogyadietcron-123',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- cleanup-old-po: Runs on 1st of every month at 4:00 AM IST (10:30 PM UTC previous day)
-- Cleans up purchase order files older than 3 months
SELECT cron.schedule(
  'cleanup-old-po',
  '30 22 1 * *',
  $$
  SELECT net.http_post(
    url := 'https://admin.arogyadiet.com/api/cron/cleanup-old-po?secret=arogyadietcron-123',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
