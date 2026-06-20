-- ============================================================
-- Fix: Mark expired subscriptions that are still ACTIVE as EXPIRED
-- 
-- Root Cause: The daily cron job uses exact date equality (.eq("effective_end_on", today))
-- to transition ACTIVE → STOPPED. If the cron missed running on a particular day,
-- those subscriptions remain ACTIVE forever.
--
-- This script catches all subscriptions where effective_end_on has already passed
-- but status is still ACTIVE.
--
-- Status Taxonomy:
--   ACTIVE    → Currently running subscription
--   PENDING   → Upcoming, not yet started
--   STOPPED   → Manually stopped mid-tenure by admin
--   EXPIRED   → Naturally concluded (end date passed) ← CORRECT status for this fix
--   CANCELLED → Manually cancelled by admin
--
-- The "Expired / Stopped" admin tab shows: STOPPED, CANCELLED, EXPIRED
-- ============================================================

-- Step 1: PREVIEW — See which subscriptions will be affected (RUN THIS FIRST)
SELECT 
  s.id,
  s.status,
  s.starts_on,
  s.effective_end_on,
  s.ends_on,
  u.full_name,
  u.email,
  sp.name AS plan_name
FROM subscriptions s
LEFT JOIN customer_profiles cp ON cp.id = s.customer_profile_id
LEFT JOIN users u ON u.id = cp.user_id
LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
WHERE s.status = 'ACTIVE'
  AND s.effective_end_on < CURRENT_DATE
ORDER BY s.effective_end_on ASC;

-- Step 2: UPDATE — Mark them as EXPIRED (Run after confirming Step 1 results)
UPDATE subscriptions
SET status = 'EXPIRED',
    updated_at = NOW()
WHERE status = 'ACTIVE'
  AND effective_end_on < CURRENT_DATE;
