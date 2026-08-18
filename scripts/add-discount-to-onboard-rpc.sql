-- ============================================================================
-- UPDATE onboard_customer RPC — admin manual discount (MEAL / KIT only)
-- ============================================================================
-- Feature: admin-manual-onboarding-discount
--
-- Built on top of the current production body
-- (scripts/update-onboard-customer-with-partial-payment.sql). Three additions,
-- all confined to one new local variable, two guards, and the subscriptions
-- INSERT:
--
--   1. subscriptions.discount_amount — the gross concession, persisted so
--      total_payable (stored NET) is explainable and so concession reporting
--      does not have to infer it.
--
--   2. A CATEGORY GUARD — a non-zero discount is rejected for anything other
--      than MEAL or KIT. ACCOMMODATION never gets a discount. Defence in depth:
--      the wizard does not render the field and the server action rejects it,
--      but the RPC must not be the weak link if called directly. Same
--      discipline as the MEAL-only partial-payment guard below it.
--
--   3. A NON-NEGATIVE GUARD — a negative discount would be a price INCREASE
--      smuggled in through a discount field.
--
-- payments.discount_amount was already read by this function and needs no
-- change. What changes is that the service layer now actually sends it, and
-- sends base_amount / tax_amount / amount already NET of it. See
-- scripts/add-discount-to-subscriptions-and-payments.sql for the storage model
-- and a worked example.
--
-- WHAT THIS FUNCTION DELIBERATELY DOES NOT DO
--   It does not validate the discount against the plan or kit price. The RPC is
--   handed a resolved payload and has no access to subscription_plans.price /
--   kit_products.base_price at this point. The "discount <= subscription gross"
--   cap is enforced in OnboardingService, which resolves that price server-side
--   from the database and never trusts the client's figure — the same place and
--   the same reason the advance amount is validated.
--
-- PREREQUISITE: run scripts/add-discount-to-subscriptions-and-payments.sql
-- first — this function references subscriptions.discount_amount.
--
-- Safety: CREATE OR REPLACE on the function only. Alters no table, drops no
-- data, back-fills nothing. Idempotent (re-runnable). A payload that omits
-- subscription.discount_amount behaves exactly as before (0).
--
-- Rollback: re-run scripts/update-onboard-customer-with-partial-payment.sql
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
  v_collection   jsonb := payload -> 'payment_collection';

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

  -- Payment collection state
  v_amount          numeric;
  v_total_payable   numeric;
  v_paid_in_full    boolean;
  v_amount_paid     numeric;
  v_balance_due     numeric;
  v_payment_status  text;
  v_advance_tx_id   uuid := NULL;
  v_tx_date         date;

  -- Manual discount (NEW)
  v_discount        numeric;
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

  IF v_customer_category IS NULL OR v_customer_category = '' THEN
    RAISE EXCEPTION 'onboard_customer: subscription.customer_category is required';
  END IF;

  IF v_customer_category = 'MEAL' AND NULLIF(v_subscription ->> 'plan_id', '') IS NULL THEN
    RAISE EXCEPTION 'onboard_customer: MEAL category requires subscription.plan_id';
  END IF;

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
  -- 0a. RESOLVE THE MANUAL DISCOUNT (NEW)
  -- --------------------------------------------------------------------------
  -- Absent => 0, so every existing caller (bulk migration, any payload written
  -- before this feature) is unaffected without being touched.
  --
  -- Read from the SUBSCRIPTION block, which is the durable record of the
  -- concession. payments.discount_amount is set independently further down from
  -- the payment block; the service layer sends the same figure to both and this
  -- function does not reconcile them, exactly as it does not reconcile
  -- delivery_charge or misc_charge across the two blocks.
  v_discount := COALESCE(NULLIF(v_subscription ->> 'discount_amount', '')::numeric, 0);

  IF v_discount < 0 THEN
    RAISE EXCEPTION 'onboard_customer: subscription.discount_amount cannot be negative (got %)', v_discount;
  END IF;

  -- A discount is a concession on a subscription charge. ACCOMMODATION prices
  -- live in stay_entries and are settled through record_stay_payment_transaction,
  -- so a discount arriving here for that category means the caller is confused
  -- about which flow it is in.
  IF v_discount > 0 AND v_customer_category NOT IN ('MEAL', 'KIT') THEN
    RAISE EXCEPTION 'onboard_customer: a manual discount is only supported for MEAL and KIT subscriptions (got %)', v_customer_category;
  END IF;

  -- --------------------------------------------------------------------------
  -- 0b. RESOLVE THE PAYMENT COLLECTION
  -- --------------------------------------------------------------------------
  -- payments.amount stays Total_Payable, exactly as before, so the invoice
  -- breakup still reconciles: base + GST + delivery + misc = amount. With a
  -- discount, base and GST arrive already NET of it, so the identity holds
  -- unchanged and the advance is validated against the DISCOUNTED total — the
  -- figure the customer was actually quoted.
  v_amount        := (v_payment ->> 'amount')::numeric;
  v_total_payable := COALESCE(NULLIF(v_subscription ->> 'total_payable', '')::numeric, v_amount);

  -- Absent block => today's behaviour: paid in full.
  v_paid_in_full := COALESCE((v_collection ->> 'paid_in_full')::boolean, true);

  IF v_paid_in_full THEN
    v_amount_paid := v_total_payable;
  ELSE
    -- Partial payment is a MEAL-only flow. Defence in depth: the server action
    -- already rejects this, but the RPC must not be the weak link if called
    -- directly.
    IF v_customer_category <> 'MEAL' THEN
      RAISE EXCEPTION 'onboard_customer: partial payment is only supported for MEAL subscriptions (got %)', v_customer_category;
    END IF;

    v_amount_paid := NULLIF(v_collection ->> 'amount_paid', '')::numeric;

    IF v_amount_paid IS NULL THEN
      RAISE EXCEPTION 'onboard_customer: payment_collection.amount_paid is required when paid_in_full is false';
    END IF;

    -- An advance of 0 means nothing was collected, which is the PENDING case
    -- onboarding forbids outright.
    IF v_amount_paid <= 0 THEN
      RAISE EXCEPTION 'onboard_customer: payment_collection.amount_paid must be greater than 0';
    END IF;

    IF v_amount_paid > v_total_payable THEN
      RAISE EXCEPTION 'onboard_customer: payment_collection.amount_paid (%) cannot exceed total payable (%)',
        v_amount_paid, v_total_payable;
    END IF;
  END IF;

  v_balance_due := v_total_payable - v_amount_paid;

  -- 'PARTIALLY_PAID' is a first-class third state. Reporting reads amount_paid
  -- for these rows rather than amount, so the unpaid balance is never booked as
  -- collected cash.
  v_payment_status := CASE WHEN v_balance_due > 0 THEN 'PARTIALLY_PAID' ELSE 'PAID' END;

  v_tx_date := COALESCE(NULLIF(v_collection ->> 'transaction_date', '')::date, CURRENT_DATE);

  -- --------------------------------------------------------------------------
  -- 1. USERS — the mobile-first identity row
  -- --------------------------------------------------------------------------
  INSERT INTO public.users (
    auth_user_id, role_id, full_name, email, mobile, is_test_email, is_active,
    franchise_id, created_by, pin_hash, is_temp_pin
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
  -- 2. CUSTOMER_PROFILES — always created IN_PROGRESS, with the Dietitian_Link
  -- --------------------------------------------------------------------------
  INSERT INTO public.customer_profiles (
    user_id, customer_code, gender, dietary_preference, allergies, date_of_birth,
    medical_history_notes, has_medical_history, source, onboarding_status,
    is_active, franchise_id, clinic_id, dietitian_id
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
    NULLIF(v_profile ->> 'clinic_id', '')::uuid,
    NULLIF(v_profile ->> 'dietitian_id', '')::uuid
  )
  RETURNING id INTO v_profile_id;

  -- --------------------------------------------------------------------------
  -- 3. SUBSCRIPTIONS — discount_amount is NEW; everything else is unchanged.
  -- --------------------------------------------------------------------------
  -- total_payable is stored NET of the discount. Keeping the gross concession
  -- alongside it is what makes the net figure explainable later without
  -- re-reading a plan price that may since have changed.
  INSERT INTO public.subscriptions (
    customer_profile_id, plan_id, kit_product_id, kit_duration_days,
    subscription_code, customer_category, starts_on, ends_on, effective_end_on,
    status, total_days, pause_credits_total, pause_credits_used, consumed_days,
    delivery_charge, misc_charge, misc_charge_label, discount_amount,
    total_payable, franchise_id
  )
  VALUES (
    v_profile_id,
    NULLIF(v_subscription ->> 'plan_id', '')::uuid,
    NULLIF(v_subscription ->> 'kit_product_id', '')::uuid,
    NULLIF(v_subscription ->> 'kit_duration_days', '')::integer,
    NULLIF(v_subscription ->> 'subscription_code', ''),
    v_customer_category,
    (v_subscription ->> 'starts_on')::date,
    NULLIF(v_subscription ->> 'ends_on', '')::date,
    NULLIF(v_subscription ->> 'effective_end_on', '')::date,
    COALESCE(NULLIF(v_subscription ->> 'status', ''), 'ACTIVE'),
    NULLIF(v_subscription ->> 'total_days', '')::integer,
    NULLIF(v_subscription ->> 'pause_credits_total', '')::integer,
    0,
    0,
    COALESCE(NULLIF(v_subscription ->> 'delivery_charge', '')::numeric, 0),
    COALESCE(NULLIF(v_subscription ->> 'misc_charge', '')::numeric, 0),
    NULLIF(btrim(COALESCE(v_subscription ->> 'misc_charge_label', '')), ''),
    v_discount,
    v_total_payable,
    NULLIF(v_subscription ->> 'franchise_id', '')::uuid
  )
  RETURNING id INTO v_sub_id;

  -- --------------------------------------------------------------------------
  -- 3b. ADVANCE LEDGER ROW — only when a balance remains.
  -- --------------------------------------------------------------------------
  -- Inserted BEFORE the payments row so the invoice can reference it, and
  -- inside the same transaction so an advance can never exist without its
  -- subscription (or vice versa).
  IF NOT v_paid_in_full THEN
    INSERT INTO public.subscription_payment_transactions (
      subscription_id, customer_profile_id, transaction_type, amount,
      transaction_date, payment_method, comment, created_by
    )
    VALUES (
      v_sub_id,
      v_profile_id,
      'ADVANCE',
      v_amount_paid,
      v_tx_date,
      COALESCE(NULLIF(v_payment ->> 'payment_method', ''), 'COUNTER'),
      'Advance collected at onboarding',
      NULLIF(v_user ->> 'created_by', '')::uuid
    )
    RETURNING id INTO v_advance_tx_id;
  END IF;

  -- --------------------------------------------------------------------------
  -- 4. PAYMENTS — the ONE invoice for this subscription (design decision D3).
  --    amount stays Total_Payable so the itemised breakup is unchanged;
  --    base_amount / tax_amount arrive NET of the discount, and
  --    discount_amount carries the gross concession so the invoice can
  --    reconstruct the pre-discount figures.
  -- --------------------------------------------------------------------------
  INSERT INTO public.payments (
    subscription_id, customer_profile_id, amount, base_amount, tax_percent,
    tax_amount, discount_amount, delivery_charge, misc_charge, misc_charge_label,
    amount_paid, balance_due, payment_method, status, paid_at, invoice_type,
    payment_reference, payment_notes, franchise_id
  )
  VALUES (
    v_sub_id,
    v_profile_id,
    v_amount,
    NULLIF(v_payment ->> 'base_amount', '')::numeric,
    NULLIF(v_payment ->> 'tax_percent', '')::numeric,
    NULLIF(v_payment ->> 'tax_amount', '')::numeric,
    COALESCE(NULLIF(v_payment ->> 'discount_amount', '')::numeric, 0),
    COALESCE(NULLIF(v_payment ->> 'delivery_charge', '')::numeric, 0),
    COALESCE(NULLIF(v_payment ->> 'misc_charge', '')::numeric, 0),
    NULLIF(btrim(COALESCE(v_payment ->> 'misc_charge_label', '')), ''),
    v_amount_paid,
    v_balance_due,
    COALESCE(NULLIF(v_payment ->> 'payment_method', ''), 'MANUAL'),
    v_payment_status,
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
    customer_profile_id, tag, street_1, street_2, landmark, city, state,
    pincode, lat, lng, is_primary, franchise_id, clinic_id
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
  -- 6. GENERATE SUBSCRIPTION_DAILY_PREFERENCES (MEAL ONLY) — unchanged.
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

    v_current_date := v_starts_on;

    WHILE v_current_date <= v_ends_on LOOP
      INSERT INTO public.subscription_daily_preferences (
        subscription_id, customer_profile_id, preference_date, meal_category_id,
        delivery_address_id, is_paused, pause_credit_used
      )
      VALUES (
        v_sub_id, v_profile_id, v_current_date, v_meal_category_id,
        v_address_id, false, false
      );

      v_current_date := v_current_date + INTERVAL '1 day';
      v_day_count := v_day_count + 1;
    END LOOP;
  END IF;

  -- --------------------------------------------------------------------------
  -- 7. Return the created ids + the resolved payment figures
  -- --------------------------------------------------------------------------
  -- The payment figures are echoed back so the service layer never has to
  -- re-derive (or disagree with) what was actually committed. discount_amount
  -- is echoed for the same reason: the admin audit log records what the database
  -- accepted, not what the request asked for.
  RETURN jsonb_build_object(
    'user_id',            v_user_id,
    'profile_id',         v_profile_id,
    'subscription_id',    v_sub_id,
    'payment_id',         v_payment_id,
    'address_id',         v_address_id,
    'daily_prefs_count',  v_day_count,
    'advance_transaction_id', v_advance_tx_id,
    'total_payable',      v_total_payable,
    'amount_paid',        v_amount_paid,
    'balance_due',        v_balance_due,
    'payment_status',     v_payment_status,
    'discount_amount',    v_discount
  );
END;
$$;

-- ============================================================================
-- DONE. onboard_customer now additionally persists
-- subscriptions.discount_amount and rejects a discount for any category other
-- than MEAL / KIT. Omitting subscription.discount_amount reproduces the
-- previous behaviour exactly.
-- ============================================================================
