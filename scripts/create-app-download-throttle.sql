-- ============================================================================
-- APP APK DISTRIBUTION — Download throttle table for rate limiting APK downloads
-- ============================================================================
-- Spec: app-apk-distribution — Tasks 3.1, 3.2
-- Requirements: 7.1, 7.2, 7.4
--
-- Introduces the app_download_throttle table and the claim_app_download_grant
-- RPC function for tracking per-IP download grants within a time window.
-- Part of the APK distribution feature that serves customer and rider Android
-- apps with rate limiting to prevent abuse.
--
-- Key Features:
--   - Composite primary key (ip_hash, app_slug) for per-IP per-app throttling
--   - CHECK constraint limiting app_slug to 'customer' or 'rider'
--   - grant_count tracks downloads within the current window
--   - window_started_at defines the start of the fixed time window
--   - Row Level Security enabled with no policies (service-role only)
--   - Atomic check-and-increment RPC for race-condition-free rate limiting
--
-- Creates:
--   1. app_download_throttle table (new) — download grant tracking
--   2. claim_app_download_grant function (new) — atomic grant claim RPC
--
-- RLS: Row Level Security is ENABLED with NO policies. All access is through
-- the claim_app_download_grant RPC or Server Actions using the service-role
-- admin client, consistent with the RLS-on-every-table convention
-- (docs/02-database.md). This ensures the table is never accidentally exposed
-- via client-side Supabase queries.
--
-- ORDERING: This script has NO dependencies. The app_download_throttle table
-- is standalone and does not reference any other tables.
--
-- Safety: Brand new table and function; nothing existing is dropped or modified.
-- Idempotent (re-runnable) via IF NOT EXISTS and CREATE OR REPLACE guards.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.claim_app_download_grant(text, text, integer, integer);
--   DROP TABLE IF EXISTS public.app_download_throttle;
-- ============================================================================

-- ============================================================================
-- 1. APP_DOWNLOAD_THROTTLE TABLE (Req 7.1)
-- ============================================================================
-- Tracks download grants per IP hash per app within a rolling time window.
-- The composite primary key ensures one throttle record per IP per app.

CREATE TABLE IF NOT EXISTS public.app_download_throttle (
  ip_hash            text        not null,
  app_slug           text        not null check (app_slug in ('customer', 'rider')),
  grant_count        integer     not null default 0,
  window_started_at  timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (ip_hash, app_slug)
);

-- Enable Row Level Security (no policies — service-role access only)
ALTER TABLE public.app_download_throttle ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. CLAIM_APP_DOWNLOAD_GRANT RPC (Req 7.1, 7.2, 7.4)
-- ============================================================================
-- Atomic check-and-increment for download grant claims.
-- 
-- This function performs the entire decision in a single statement under the
-- primary key's row lock, ensuring that concurrent requests from the same IP
-- serialize and the limit holds exactly. A read-decide-write split would allow
-- concurrent requests to exceed the limit.
--
-- Parameters:
--   p_ip_hash        - SHA256 hash of the client IP address
--   p_app_slug       - App identifier ('customer' or 'rider')
--   p_limit          - Maximum grants allowed per window (e.g., 5)
--   p_window_seconds - Window duration in seconds (e.g., 600 for 10 minutes)
--
-- Returns:
--   granted            - TRUE if the grant was allowed, FALSE if rate limited
--   retry_after_seconds - Seconds until the window resets (0 when granted)
--
-- Behavior:
--   1. If no row exists: INSERT with grant_count=1, return granted=TRUE
--   2. If window is stale (older than p_window_seconds): 
--      UPDATE with grant_count=1, new window start, return granted=TRUE
--   3. If under limit (grant_count < p_limit): 
--      INCREMENT grant_count, return granted=TRUE
--   4. If at limit (grant_count >= p_limit): 
--      Return granted=FALSE with remaining window time
--
-- Security: SECURITY DEFINER with SET search_path = public follows project
-- RPC conventions. The function executes with table owner privileges, allowing
-- service-role clients to manage throttle state without direct table access.

CREATE OR REPLACE FUNCTION public.claim_app_download_grant(
  p_ip_hash text,
  p_app_slug text,
  p_limit integer,
  p_window_seconds integer
) RETURNS TABLE (granted boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_count integer;
  v_window timestamptz;
BEGIN
  -- Atomic check-and-increment for download grant claims.
  -- 
  -- The SELECT...FOR UPDATE acquires an exclusive row lock, ensuring that
  -- concurrent requests from the same IP hash serialize and the limit holds
  -- exactly. This prevents race conditions where multiple concurrent requests
  -- could read the same count and all decide to grant, exceeding the limit.
  --
  -- Decision matrix:
  --   1. Row doesn't exist -> INSERT with count=1 -> GRANT
  --   2. Window is stale -> UPDATE with count=1, new window -> GRANT
  --   3. count < limit -> UPDATE with count+1 -> GRANT  
  --   4. count >= limit -> No change -> DENY with retry_after
  
  -- Lock the existing row (if any)
  SELECT grant_count, window_started_at
  INTO v_count, v_window
  FROM public.app_download_throttle
  WHERE ip_hash = p_ip_hash AND app_slug = p_app_slug
  FOR UPDATE;
  
  IF NOT FOUND THEN
    -- Case 1: Row doesn't exist, insert and grant
    INSERT INTO public.app_download_throttle 
      (ip_hash, app_slug, grant_count, window_started_at, updated_at)
    VALUES (p_ip_hash, p_app_slug, 1, v_now, v_now);
    
    granted := TRUE;
    retry_after_seconds := 0;
    RETURN NEXT;
    RETURN;
  END IF;
  
  -- Check if window is stale (older than p_window_seconds)
  IF v_window < v_now - (p_window_seconds || ' seconds')::interval THEN
    -- Case 2: Window is stale, reset and grant
    UPDATE public.app_download_throttle
    SET grant_count = 1, window_started_at = v_now, updated_at = v_now
    WHERE ip_hash = p_ip_hash AND app_slug = p_app_slug;
    
    granted := TRUE;
    retry_after_seconds := 0;
    RETURN NEXT;
    RETURN;
  END IF;
  
  -- Window is active, check if under limit
  IF v_count < p_limit THEN
    -- Case 3: Under limit, increment and grant
    UPDATE public.app_download_throttle
    SET grant_count = grant_count + 1, updated_at = v_now
    WHERE ip_hash = p_ip_hash AND app_slug = p_app_slug;
    
    granted := TRUE;
    retry_after_seconds := 0;
    RETURN NEXT;
    RETURN;
  END IF;
  
  -- Case 4: At limit, deny without incrementing
  -- Calculate remaining seconds until window expires
  granted := FALSE;
  retry_after_seconds := GREATEST(0, EXTRACT(epoch FROM (
    v_window + (p_window_seconds || ' seconds')::interval - v_now
  ))::integer);
  RETURN NEXT;
END;
$$;
