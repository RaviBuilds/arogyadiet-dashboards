-- ============================================================================
-- CUSTOMER MOBILE ONBOARDING — Atomic onboard_customer() RPC (SAFE)
-- ============================================================================
-- Feature: customer-mobile-onboarding (Task 1.5)
-- Requirements: 6.1, 6.2, 6.3, 6.6, 5.5, 8.3, 8.6
--
-- Defines public.onboard_customer(payload jsonb): the AUTHORITATIVE, single-
-- transaction path that materializes an admin-initiated onboarding. In ONE
-- transaction it inserts, in dependency order:
--
--   1. public.users              — the mobile-first identity row            (Req 6.1)
--   2. public.customer_profiles  — onboarding_status = 'IN_PROGRESS'         (Req 6.1)
--   3. public.subscriptions      — with customer_category + starts_on        (Req 6.2)
--   4. public.payments           — status 'PAID', amount, paid_at (invoice)  (Req 8.3, 8.6)
--   5. public.addresses          — the primary address, is_primary = true    (Req 6.3, 5.5)
--
-- and RETURNS a jsonb object of the created ids.
--
-- ATOMICITY (Req 6.6): a plpgsql function body runs inside a single implicit
-- transaction. Every INSERT below either commits together or rolls back
-- together. Any failure — a NOT NULL / UNIQUE / CHECK / FK violation, or an
-- explicit RAISE for a missing required field — aborts the whole function so
-- NO partial Customer_Record (no orphan users / customer_profiles /
-- subscriptions / payments / addresses row) is ever left behind. The caller
-- (OnboardingService) creates the Supabase Auth identity BEFORE calling this
-- RPC and compensates by deleting it if the RPC raises.
--
-- SECURITY DEFINER: invoked by the service-role admin client
-- (createAdminClient) from the onboardCustomerAction Server Action after that
-- action has authorized the admin, validated inputs with Zod, asserted
-- Payment_Status == PAID (Req 8.1/8.2) and the cutoff start-date rule (Req 7).
-- Running as DEFINER keeps the atomic write behaving consistently regardless of
-- the caller's row-level privileges, mirroring create-group-with-kitchen-rpc.sql.
--
-- PAYLOAD SHAPE (all resolution — franchise_id/clinic_id from pincode, unique
-- customer_code/subscription_code generation, and amount computation — is done
-- by the service; this RPC is the thin transactional writer):
--
-- {
--   "user": {
--     "auth_user_id": "<uuid>",            -- required (created by service first)
--     "role_id":      "<uuid>",            -- required (Customer role)
--     "full_name":    "<text>",            -- required (Req 4.1 / 6.1)
--     "email":        "<text>",            -- required (real or placeholder Test_Email)
--     "mobile":       "<10-digit text>",   -- required (Req 6.1)
--     "is_test_email": true|false,         -- optional, default false (Req 10.3)
--     "franchise_id": "<uuid>",            -- optional
--     "created_by":   "<uuid>"             -- optional (acting admin)
--   },
--   "profile": {
--     "customer_code":         "<text>",   -- required (unique, service-generated)
--     "gender":                "<text>",   -- optional (Req 4.1)
--     "dietary_preference":    "<text>",   -- optional (Req 4.2)
--     "allergies":             "<text>",   -- optional (Req 4.3)
--     "date_of_birth":         "<date>",   -- optional
--     "medical_history_notes": "<text>",   -- optional
--     "source":                "<text>",   -- optional
--     "franchise_id":          "<uuid>",   -- optional
--     "clinic_id":             "<uuid>"    -- optional
--   },
--   "subscription": {
--     "plan_id":             "<uuid>",     -- required (Req 4.4)
--     "subscription_code":   "<text>",     -- optional (service-generated)
--     "customer_category":   "MEAL|KIT|ACCOMMODATION", -- required (Req 6.2/13.2)
--     "starts_on":           "<date>",     -- required (Req 6.2)
--     "ends_on":             "<date>",     -- optional
--     "effective_end_on":    "<date>",     -- optional
--     "status":              "<text>",     -- optional, default 'ACTIVE'
--     "total_days":          <int>,        -- optional
--     "pause_credits_total": <int>,        -- optional
--     "franchise_id":        "<uuid>"      -- optional
--   },
--   "payment": {
--     "amount":            <numeric>,      -- required, subscription amount due (Req 8.3)
--     "base_amount":       <numeric>,      -- optional
--     "tax_percent":       <numeric>,      -- optional
--     "tax_amount":        <numeric>,      -- optional
--     "discount_amount":   <numeric>,      -- optional, default 0
--     "payment_method":    "<text>",       -- optional, default 'MANUAL'
--     "paid_at":           "<timestamptz>",-- optional, default now() (Req 8.3)
--     "payment_reference": "<text>",       -- optional
--     "payment_notes":     "<text>",       -- optional
--     "franchise_id":      "<uuid>"        -- optional
--   },
--   "address": {
--     "tag":       "Home|Office",          -- optional, default 'Home' (Req 5.1)
--     "street_1":  "<text>",               -- required (Req 6.3)
--     "street_2":  "<text>",               -- optional
--     "landmark":  "<text>",               -- optional
--     "city":      "<text>",               -- optional (has table default)
--     "state":     "<text>",               -- optional (has table default)
--     "pincode":   "<text>",               -- required
--     "lat":       <numeric>,              -- optional (Req 5.3)
--     "lng":       <numeric>,              -- optional (Req 5.3)
--     "franchise_id": "<uuid>",            -- optional
--     "clinic_id":    "<uuid>"             -- optional
--   }
-- }
--
-- Returns:
--   { "user_id": "...", "profile_id": "...", "subscription_id": "...",
--     "payment_id": "...", "address_id": "..." }
--
-- Safety: additive only — creates/replaces a function; alters no table and
-- drops no data. Idempotent (re-runnable) via CREATE OR REPLACE FUNCTION.
--
-- RUN ORDER (IMPORTANT): run AFTER the Task 1.1–1.3 migrations
-- (customer_profiles.onboarding_status, subscriptions.customer_category,
-- users.is_test_email must already exist).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.onboard_customer(jsonb);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.onboard_customer(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user         jsonb := payload -> 'user';
  v_profile      jsonb := payload -> 'profile';
  v_subscription jsonb := payload -> 'subscription';
  v_payment      jsonb := payload -> 'payment';
  v_address      jsonb := payload -> 'address';

  v_user_id    uuid;
  v_profile_id uuid;
  v_sub_id     uuid;
  v_payment_id uuid;
  v_address_id uuid;
BEGIN
  -- --------------------------------------------------------------------------
  -- 0. Validate that each required sub-object is present. A missing block is an
  --    unrecoverable payload error; RAISE aborts the whole transaction so no
  --    partial record is created (Req 6.6).
  -- --------------------------------------------------------------------------
  IF v_user IS NULL OR v_profile IS NULL OR v_subscription IS NULL
     OR v_payment IS NULL OR v_address IS NULL THEN
    RAISE EXCEPTION 'onboard_customer: payload must contain user, profile, subscription, payment and address objects';
  END IF;

  -- Required scalar fields (mirrors the NOT NULL / required contract above).
  IF NULLIF(v_user ->> 'full_name', '') IS NULL
     OR NULLIF(v_user ->> 'email', '') IS NULL
     OR NULLIF(v_user ->> 'mobile', '') IS NULL THEN
    RAISE EXCEPTION 'onboard_customer: user.full_name, user.email and user.mobile are required';
  END IF;

  IF NULLIF(v_subscription ->> 'plan_id', '') IS NULL
     OR NULLIF(v_subscription ->> 'starts_on', '') IS NULL
     OR NULLIF(v_subscription ->> 'customer_category', '') IS NULL THEN
    RAISE EXCEPTION 'onboard_customer: subscription.plan_id, subscription.starts_on and subscription.customer_category are required';
  END IF;

  IF (v_payment ->> 'amount') IS NULL THEN
    RAISE EXCEPTION 'onboard_customer: payment.amount is required';
  END IF;

  IF NULLIF(v_address ->> 'street_1', '') IS NULL
     OR NULLIF(v_address ->> 'pincode', '') IS NULL THEN
    RAISE EXCEPTION 'onboard_customer: address.street_1 and address.pincode are required';
  END IF;

  -- --------------------------------------------------------------------------
  -- 1. USERS — the mobile-first identity row (Req 6.1).
  --    email stays NOT NULL + UNIQUE; a placeholder Test_Email (is_test_email =
  --    true) is supplied by the service when the customer has no real email.
  -- --------------------------------------------------------------------------
  INSERT INTO public.users (
    auth_user_id,
    role_id,
    full_name,
    email,
    mobile,
    is_test_email,
    is_active,
    franchise_id,
    created_by
  )
  VALUES (
    NULLIF(v_user ->> 'auth_user_id', '')::uuid,
    NULLIF(v_user ->> 'role_id', '')::uuid,
    v_user ->> 'full_name',
    v_user ->> 'email',
    v_user ->> 'mobile',
    COALESCE((v_user ->> 'is_test_email')::boolean, false),
    true,
    NULLIF(v_user ->> 'franchise_id', '')::uuid,
    NULLIF(v_user ->> 'created_by', '')::uuid
  )
  RETURNING id INTO v_user_id;

  -- --------------------------------------------------------------------------
  -- 2. CUSTOMER_PROFILES — always created IN_PROGRESS (Req 6.1). The customer
  --    later finishes or explicitly skips remaining details to reach COMPLETED.
  -- --------------------------------------------------------------------------
  INSERT INTO public.customer_profiles (
    user_id,
    customer_code,
    gender,
    dietary_preference,
    allergies,
    date_of_birth,
    medical_history_notes,
    has_medical_history,
    source,
    onboarding_status,
    is_active,
    franchise_id,
    clinic_id
  )
  VALUES (
    v_user_id,
    NULLIF(v_profile ->> 'customer_code', ''),
    NULLIF(v_profile ->> 'gender', ''),
    NULLIF(v_profile ->> 'dietary_preference', ''),
    NULLIF(v_profile ->> 'allergies', ''),
    NULLIF(v_profile ->> 'date_of_birth', '')::date,
    NULLIF(v_profile ->> 'medical_history_notes', ''),
    COALESCE((v_profile ->> 'has_medical_history')::boolean, false),
    NULLIF(v_profile ->> 'source', ''),
    'IN_PROGRESS',
    true,
    NULLIF(v_profile ->> 'franchise_id', '')::uuid,
    NULLIF(v_profile ->> 'clinic_id', '')::uuid
  )
  RETURNING id INTO v_profile_id;

  -- --------------------------------------------------------------------------
  -- 3. SUBSCRIPTIONS — carries the Primary_Category and the selected start date
  --    (Req 6.2). The customer_category CHECK + partial unique index from
  --    Task 1.2 guard the enum and the at-most-one-active-per-category rule.
  -- --------------------------------------------------------------------------
  INSERT INTO public.subscriptions (
    customer_profile_id,
    plan_id,
    subscription_code,
    customer_category,
    starts_on,
    ends_on,
    effective_end_on,
    status,
    total_days,
    pause_credits_total,
    pause_credits_used,
    consumed_days,
    franchise_id
  )
  VALUES (
    v_profile_id,
    (v_subscription ->> 'plan_id')::uuid,
    NULLIF(v_subscription ->> 'subscription_code', ''),
    v_subscription ->> 'customer_category',
    (v_subscription ->> 'starts_on')::date,
    NULLIF(v_subscription ->> 'ends_on', '')::date,
    NULLIF(v_subscription ->> 'effective_end_on', '')::date,
    COALESCE(NULLIF(v_subscription ->> 'status', ''), 'ACTIVE'),
    NULLIF(v_subscription ->> 'total_days', '')::integer,
    NULLIF(v_subscription ->> 'pause_credits_total', '')::integer,
    0,
    0,
    NULLIF(v_subscription ->> 'franchise_id', '')::uuid
  )
  RETURNING id INTO v_sub_id;

  -- --------------------------------------------------------------------------
  -- 4. PAYMENTS — exactly one PAID invoice for the subscription, amount = due,
  --    paid_at = when the admin marked payment done (Req 8.3, 8.6).
  -- --------------------------------------------------------------------------
  INSERT INTO public.payments (
    subscription_id,
    customer_profile_id,
    amount,
    base_amount,
    tax_percent,
    tax_amount,
    discount_amount,
    payment_method,
    status,
    paid_at,
    invoice_type,
    payment_reference,
    payment_notes,
    franchise_id
  )
  VALUES (
    v_sub_id,
    v_profile_id,
    (v_payment ->> 'amount')::numeric,
    NULLIF(v_payment ->> 'base_amount', '')::numeric,
    NULLIF(v_payment ->> 'tax_percent', '')::numeric,
    NULLIF(v_payment ->> 'tax_amount', '')::numeric,
    COALESCE(NULLIF(v_payment ->> 'discount_amount', '')::numeric, 0),
    COALESCE(NULLIF(v_payment ->> 'payment_method', ''), 'MANUAL'),
    'PAID',
    COALESCE(NULLIF(v_payment ->> 'paid_at', '')::timestamptz, now()),
    'SUBSCRIPTION',
    NULLIF(v_payment ->> 'payment_reference', ''),
    NULLIF(v_payment ->> 'payment_notes', ''),
    NULLIF(v_payment ->> 'franchise_id', '')::uuid
  )
  RETURNING id INTO v_payment_id;

  -- --------------------------------------------------------------------------
  -- 5. ADDRESSES — the map-captured primary address, is_primary = true
  --    (Req 6.3, 5.5). city/state fall back to the table defaults when omitted.
  -- --------------------------------------------------------------------------
  INSERT INTO public.addresses (
    customer_profile_id,
    tag,
    street_1,
    street_2,
    landmark,
    city,
    state,
    pincode,
    lat,
    lng,
    is_primary,
    franchise_id,
    clinic_id
  )
  VALUES (
    v_profile_id,
    COALESCE(NULLIF(v_address ->> 'tag', ''), 'Home'),
    v_address ->> 'street_1',
    NULLIF(v_address ->> 'street_2', ''),
    NULLIF(v_address ->> 'landmark', ''),
    COALESCE(NULLIF(v_address ->> 'city', ''), 'Hyderabad'),
    COALESCE(NULLIF(v_address ->> 'state', ''), 'Telangana'),
    v_address ->> 'pincode',
    NULLIF(v_address ->> 'lat', '')::numeric,
    NULLIF(v_address ->> 'lng', '')::numeric,
    true,
    NULLIF(v_address ->> 'franchise_id', '')::uuid,
    NULLIF(v_address ->> 'clinic_id', '')::uuid
  )
  RETURNING id INTO v_address_id;

  -- --------------------------------------------------------------------------
  -- 6. Return the created ids. Reaching here means every INSERT succeeded and
  --    the transaction will commit as a unit.
  -- --------------------------------------------------------------------------
  RETURN jsonb_build_object(
    'user_id',         v_user_id,
    'profile_id',      v_profile_id,
    'subscription_id', v_sub_id,
    'payment_id',      v_payment_id,
    'address_id',      v_address_id
  );
END;
$$;

-- ============================================================================
-- DONE. onboard_customer(payload jsonb) is the authoritative atomic onboarding
-- path. Invoke it from onboardCustomerAction via
--   createAdminClient().rpc('onboard_customer', { payload })
-- Any failure rolls back the entire multi-table write (Req 6.6).
-- ============================================================================
