-- ============================================================================
-- UPDATE onboard_customer RPC to support KIT category subscriptions
-- ============================================================================
-- Feature: kit-subscription-management (Task 10.1)
-- Requirements: 2.1, 3.1, 4.4, 7.1, 7.2, 9.2
--
-- This script updates the onboard_customer RPC to handle KIT category
-- subscriptions by adding support for kit_product_id and kit_duration_days
-- fields. The RPC now branches logic based on customer_category:
--
-- - For KIT category:  Uses kit_product_id and kit_duration_days (NOT plan_id)
-- - For MEAL category: Uses plan_id (NOT kit_product_id or kit_duration_days)
--
-- The subscription INSERT now includes:
--   - kit_product_id (nullable, required for KIT)
--   - kit_duration_days (nullable, required for KIT)
--
-- Daily preferences generation is SKIPPED for KIT category (Req 7.2), as KIT
-- subscriptions use courier-based shipping rather than daily meal delivery.
--
-- Safety: Replaces existing function. Idempotent (re-runnable).
--
-- Rollback:
--   Use previous version of onboard_customer RPC without KIT support.
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
  
  v_starts_on date;
  v_ends_on date;
  v_meal_category_id uuid;
  v_current_date date;
  v_day_count integer;
  v_customer_category text;
BEGIN
  -- --------------------------------------------------------------------------
  -- 0. Validate that each required sub-object is present.
  -- --------------------------------------------------------------------------
  IF v_user IS NULL OR v_profile IS NULL OR v_subscription IS NULL
     OR v_payment IS NULL OR v_address IS NULL THEN
    RAISE EXCEPTION 'onboard_customer: payload must contain user, profile, subscription, payment and address objects';
  END IF;

  -- Required scalar fields
  IF NULLIF(v_user ->> 'full_name', '') IS NULL
     OR NULLIF(v_user ->> 'email', '') IS NULL
     OR NULLIF(v_user ->> 'mobile', '') IS NULL THEN
    RAISE EXCEPTION 'onboard_customer: user.full_name, user.email and user.mobile are required';
  END IF;

  -- Extract customer_category for validation
  v_customer_category := v_subscription ->> 'customer_category';

  -- Category-based validation (Req 2.1, 4.4, 7.1)
  IF v_customer_category IS NULL OR v_customer_category = '' THEN
    RAISE EXCEPTION 'onboard_customer: subscription.customer_category is required';
  END IF;

  -- MEAL category requires plan_id
  IF v_customer_category = 'MEAL' AND NULLIF(v_subscription ->> 'plan_id', '') IS NULL THEN
    RAISE EXCEPTION 'onboard_customer: MEAL category requires subscription.plan_id';
  END IF;

  -- KIT category requires kit_product_id and kit_duration_days (Req 2.1, 7.1)
  IF v_customer_category = 'KIT' THEN
    IF NULLIF(v_subscription ->> 'kit_product_id', '') IS NULL THEN
      RAISE EXCEPTION 'onboard_customer: KIT category requires subscription.kit_product_id';
    END IF;
    IF NULLIF(v_subscription ->> 'kit_duration_days', '') IS NULL THEN
      RAISE EXCEPTION 'onboard_customer: KIT category requires subscription.kit_duration_days';
    END IF;
  END IF;

  IF NULLIF(v_subscription ->> 'starts_on', '') IS NULL THEN
    RAISE EXCEPTION 'onboard_customer: subscription.starts_on is required';
  END IF;

  IF (v_payment ->> 'amount') IS NULL THEN
    RAISE EXCEPTION 'onboard_customer: payment.amount is required';
  END IF;

  IF NULLIF(v_address ->> 'street_1', '') IS NULL
     OR NULLIF(v_address ->> 'pincode', '') IS NULL THEN
    RAISE EXCEPTION 'onboard_customer: address.street_1 and address.pincode are required';
  END IF;

  -- --------------------------------------------------------------------------
  -- 1. USERS — the mobile-first identity row
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
    created_by,
    pin_hash,
    is_temp_pin
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
    NULLIF(v_user ->> 'created_by', '')::uuid,
    NULLIF(v_user ->> 'pin_hash', ''),
    COALESCE((v_user ->> 'is_temp_pin')::boolean, false)
  )
  RETURNING id INTO v_user_id;

  -- --------------------------------------------------------------------------
  -- 2. CUSTOMER_PROFILES — always created IN_PROGRESS
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
  -- 3. SUBSCRIPTIONS — now supports both MEAL and KIT categories (Req 7.1)
  -- --------------------------------------------------------------------------
  INSERT INTO public.subscriptions (
    customer_profile_id,
    plan_id,
    kit_product_id,
    kit_duration_days,
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
    NULLIF(v_subscription ->> 'plan_id', '')::uuid,
    NULLIF(v_subscription ->> 'kit_product_id', '')::uuid,
    NULLIF(v_subscription ->> 'kit_duration_days', '')::integer,
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
  -- 4. PAYMENTS
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
  -- 5. ADDRESSES — the map-captured primary address
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
  -- 6. GENERATE SUBSCRIPTION_DAILY_PREFERENCES (ONLY FOR MEAL CATEGORY)
  --    Req 7.2: KIT subscriptions skip daily preferences generation
  -- --------------------------------------------------------------------------
  v_day_count := 0;
  
  IF v_customer_category = 'MEAL' THEN
    v_starts_on := (v_subscription ->> 'starts_on')::date;
    v_ends_on := COALESCE(
      NULLIF(v_subscription ->> 'ends_on', '')::date,
      NULLIF(v_subscription ->> 'effective_end_on', '')::date,
      v_starts_on + (COALESCE(NULLIF(v_subscription ->> 'total_days', '')::integer, 30) - 1)
    );
    v_meal_category_id := NULLIF(v_subscription ->> 'initial_meal_category_id', '')::uuid;

    -- Generate daily preferences for entire subscription period
    v_current_date := v_starts_on;
    
    WHILE v_current_date <= v_ends_on LOOP
      INSERT INTO public.subscription_daily_preferences (
        subscription_id,
        customer_profile_id,
        preference_date,
        meal_category_id,
        delivery_address_id,
        is_paused,
        pause_credit_used
      )
      VALUES (
        v_sub_id,
        v_profile_id,
        v_current_date,
        v_meal_category_id,  -- Can be NULL if not provided
        v_address_id,
        false,
        false
      );
      
      v_current_date := v_current_date + INTERVAL '1 day';
      v_day_count := v_day_count + 1;
    END LOOP;
  END IF;

  -- --------------------------------------------------------------------------
  -- 7. Return the created ids
  -- --------------------------------------------------------------------------
  RETURN jsonb_build_object(
    'user_id',         v_user_id,
    'profile_id',      v_profile_id,
    'subscription_id', v_sub_id,
    'payment_id',      v_payment_id,
    'address_id',      v_address_id,
    'daily_prefs_count', v_day_count
  );
END;
$$;

-- ============================================================================
-- DONE. onboard_customer now supports KIT category subscriptions with
-- category-based branching for plan_id vs kit_product_id/kit_duration_days.
-- Daily preferences generation is skipped for KIT category (Req 7.2).
-- ============================================================================

