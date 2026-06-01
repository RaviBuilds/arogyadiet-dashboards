-- One-time migration: use PENDING as the only upcoming subscription status.
-- Run in Supabase SQL Editor before or immediately after deploying PENDING-only app code.

UPDATE subscriptions
SET status = 'PENDING'
WHERE status = 'QUEUED';
