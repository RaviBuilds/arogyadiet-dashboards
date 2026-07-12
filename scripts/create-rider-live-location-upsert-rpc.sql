-- ============================================================================
-- Native background-location upload RPC
-- ----------------------------------------------------------------------------
-- The rider mobile app's native foreground service uploads live location
-- directly to Supabase (bypassing the WebView, which the OS throttles/suspends
-- in the background). The native service authenticates with only the public
-- anon/publishable key, so it acts as the `anon` role and cannot satisfy the
-- existing `is_own_rider_profile(rider_id)` RLS policies on
-- `rider_live_locations`.
--
-- Rather than opening the table to the anon role directly, we expose a single
-- narrow, SECURITY DEFINER function. This keeps table-level RLS fully intact
-- (only this function can write from the anon role), limits writes to just the
-- three location columns, and validates the input:
--   * lat/lng must be present and within valid geographic ranges
--   * rider_id must reference an existing rider_profiles row
--
-- Security note: live location is low-sensitivity, short-lived data. A caller
-- with the public anon key can update any known rider's location via this
-- function — an accepted trade-off for reliable background tracking. The
-- function cannot read, delete, or write any other table/column.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_rider_live_location(
    p_rider_id uuid,
    p_lat double precision,
    p_lng double precision
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Validate coordinates.
    IF p_lat IS NULL OR p_lng IS NULL THEN
        RAISE EXCEPTION 'lat and lng are required';
    END IF;

    IF p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN
        RAISE EXCEPTION 'lat/lng out of valid range';
    END IF;

    -- Only accept updates for a known rider (guards against arbitrary rows).
    IF NOT EXISTS (SELECT 1 FROM public.rider_profiles WHERE id = p_rider_id) THEN
        RAISE EXCEPTION 'unknown rider_id: %', p_rider_id;
    END IF;

    -- Upsert only the live-location columns. franchise_id and any other
    -- columns are left untouched on update.
    INSERT INTO public.rider_live_locations (rider_id, lat, lng, updated_at)
    VALUES (p_rider_id, p_lat, p_lng, now())
    ON CONFLICT (rider_id)
    DO UPDATE SET
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        updated_at = EXCLUDED.updated_at;
END;
$$;

-- Allow both the anon (native app w/ publishable key) and authenticated
-- (web app w/ user session) roles to call it.
GRANT EXECUTE ON FUNCTION public.upsert_rider_live_location(uuid, double precision, double precision)
    TO anon, authenticated;
