-- Migration: Set default temporary PIN (002200) for all existing customer accounts
-- that do NOT already have a pin_hash set.
--
-- Context: After migrating customer auth from password to 6-digit PIN, existing
-- customers had no PIN and could not log in. This sets a known default temporary
-- PIN so existing customers can log in and then change it to their own permanent PIN.
--
-- Default PIN: 002200
-- Hash method: bcrypt via pgcrypto crypt() + gen_salt('bf', 10) — same format as
--              the app's bcryptjs library (produces $2a$10$... hashes).
-- is_temp_pin: true — forces customer to set a permanent PIN on first login.
--
-- IMPORTANT: Run this ONCE. It only affects rows where pin_hash IS NULL.

UPDATE public.users
SET
  pin_hash     = crypt('002200', gen_salt('bf', 10)),
  is_temp_pin  = true,
  pin_set_at   = now()
WHERE
  pin_hash IS NULL
  AND id IN (SELECT user_id FROM public.customer_profiles);
