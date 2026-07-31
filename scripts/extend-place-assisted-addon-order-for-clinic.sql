-- ============================================================================
-- CLINIC-SCOPED SHOP INVENTORY — place_assisted_addon_order() extended for
-- Core_Clinic attribution + decrement (SAFE: Additive only)
-- ============================================================================
-- Spec: clinic-scoped-shop-inventory — Task 9.1
-- Requirements: 10.3, 10.4, 10.5, 10.8, 10.9, 10.10, 10.11, 11.1, 11.2, 11.3
--
-- `place_assisted_addon_order(payload jsonb)` (scripts/add-walkin-shop-orders.sql)
-- already writes the manual PAID invoice, the `addon_orders` row, and every
-- `addon_order_items` row for an assisted/walk-in shop sale, all inside the one
-- implicit transaction a plpgsql function body runs in. Today it never touches
-- `clinic_product_settings` or `clinic_product_ledger` at all — there is no
-- Core_Clinic decrement on this path, so an assisted or walk-in sale can be
-- recorded with no matching stock movement.
--
-- This is a `CREATE OR REPLACE` of that SAME function, adding exactly two
-- payload fields and one call:
--
--   1. `clinic_id` (uuid, optional) — the fulfilling Core_Clinic, already
--      resolved and authorized by the caller (Requirements 10.3, 10.4, 10.5).
--      Stamped into `addon_orders.clinic_id` in the SAME INSERT that already
--      exists — not a separate UPDATE, so the immutability trigger from
--      scripts/add-clinic-stamp-to-addon-orders.sql never even evaluates a
--      change (an INSERT sets the value once, it does not "change" it).
--   2. `movement_source` (clinic_movement_source, required together with
--      `clinic_id`) — which of CUSTOMER_APP_SALE / ASSISTED_SALE / WALKIN_SALE
--      this call represents. This function does not hardcode or validate which
--      of the three it must be; that validation already lives in
--      `clinic_shop_apply_sale` (scripts/create-clinic-shop-apply-sale-rpc.sql)
--      and is not duplicated here.
--
-- After the existing `addon_order_items` insert loop finishes, and only WHEN
-- `clinic_id` is present, this function calls `clinic_shop_apply_sale(...)`
-- with the same product/quantity lines just inserted. Because both functions
-- are plpgsql and the call happens from within `place_assisted_addon_order`'s
-- own body, it executes in the SAME enclosing transaction — no separate
-- commit, no two-phase anything. Any exception `clinic_shop_apply_sale` raises
-- (insufficient clinic stock, bad movement source, unknown clinic, ...)
-- propagates straight out of `place_assisted_addon_order` and rolls back the
-- payment + order + items already inserted earlier in this same call
-- (Requirements 10.8, 10.9, 10.10, 11.1, 11.2, 11.3). `clinic_shop_apply_sale`
-- itself locks the overlay rows FOR UPDATE ordered by product_id and performs
-- a conditional `UPDATE ... WHERE stock_quantity >= qty`, so serialisation and
-- the oversell guard are inherited for free, not reimplemented here.
--
-- WHEN `clinic_id` IS NULL (absent from the payload, e.g. every franchise
-- order and any order with no fulfilling Core_Clinic): the clinic branch is
-- skipped entirely. Every other branch — franchise order via `franchise_id`,
-- walk-in via `walkin_name`, clinic-pickup via `is_clinic_pickup`, normal
-- customer-profile order — is untouched byte-for-byte relative to
-- scripts/add-walkin-shop-orders.sql's current body. `clinic_id` is optional;
-- this function does not require it and does not resolve it — resolving which
-- Core_Clinic applies (from the placing Admin's Clinic_Scope_Assignment or an
-- explicit selection) is caller-side logic (Task 9.2,
-- src/services/AssistedOrderService.ts / src/actions/admin-actions/
-- assistedOrderActions.ts), not something this SQL function does.
--
-- IDEMPOTENT: safe to run more than once (CREATE OR REPLACE FUNCTION).
--
-- ORDERING: This script MUST run AFTER:
--   - scripts/add-walkin-shop-orders.sql (defines the CURRENT
--     place_assisted_addon_order body this replaces)
--   - scripts/add-clinic-stamp-to-addon-orders.sql (public.addon_orders.clinic_id
--     + its immutability trigger)
--   - scripts/create-clinic-shop-apply-sale-rpc.sql (public.clinic_shop_apply_sale)
--
-- NOT EXECUTED: there is no live database available in this environment. This
-- script has been reviewed for correctness against the current body of
-- place_assisted_addon_order but has not been run against Postgres.
--
-- Rollback: re-run scripts/add-walkin-shop-orders.sql to restore the
-- pre-clinic body of place_assisted_addon_order (it is itself a
-- CREATE OR REPLACE FUNCTION, so this is a clean revert).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.place_assisted_addon_order(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_profile_id uuid;
  v_franchise_id        uuid;
  v_placed_by_user_id   uuid;
  v_target_date         date;
  v_total               numeric;
  v_base_amount         numeric;
  v_tax_amount          numeric;
  v_discount_amount     numeric;

  v_items          jsonb := payload -> 'items';
  v_payment_id     uuid;
  v_addon_order_id uuid;
  v_item           jsonb;

  -- Clinic pickup: the customer collects the product at the clinic, so the
  -- order is created already DELIVERED (fulfillment CLINIC_PICKUP) and never
  -- enters the meal-delivery linking/routing pipeline.
  v_is_clinic_pickup boolean := COALESCE((payload ->> 'is_clinic_pickup')::boolean, false);

  -- Walk-in buyer: a non-subscriber who only bought a shop product. Identified
  -- by a name instead of a customer profile.
  v_walkin_name    text := NULLIF(btrim(payload ->> 'walkin_name'), '');
  v_walkin_mobile  text := NULLIF(btrim(payload ->> 'walkin_mobile'), '');
  v_walkin_address text := NULLIF(btrim(payload ->> 'walkin_address'), '');
  v_is_walkin      boolean;

  -- Resolved terminal shape of the order.
  v_status             text;
  v_fulfillment_status text;
  v_delivered_at       timestamptz;

  -- Core_Clinic fulfilment (Requirements 10.3, 10.4, 10.5, 10.8, 10.9, 10.10,
  -- 10.11, 11.1, 11.2, 11.3). Both NULL for every non-clinic order (franchise,
  -- or any order with no fulfilling Core_Clinic) — the clinic branch below is
  -- then skipped entirely and every other branch is unaffected.
  v_clinic_id         uuid := NULLIF(payload ->> 'clinic_id', '')::uuid;
  v_movement_source   clinic_movement_source := NULLIF(payload ->> 'movement_source', '')::clinic_movement_source;
  v_clinic_lines      jsonb := '[]'::jsonb;
BEGIN
  -- --------------------------------------------------------------------------
  -- 0. Extract and validate the required, server-computed inputs. A missing
  --    required field is an unrecoverable payload error; RAISE aborts the whole
  --    transaction so no partial order is created.
  -- --------------------------------------------------------------------------
  v_customer_profile_id := NULLIF(payload ->> 'customer_profile_id', '')::uuid;
  v_franchise_id        := NULLIF(payload ->> 'franchise_id', '')::uuid;      -- NULL for core/Admin
  v_placed_by_user_id   := NULLIF(payload ->> 'placed_by_user_id', '')::uuid;
  v_target_date         := NULLIF(payload ->> 'target_delivery_date', '')::date;
  v_total               := NULLIF(payload ->> 'total', '')::numeric;
  v_base_amount         := NULLIF(payload ->> 'base_amount', '')::numeric;
  v_tax_amount          := NULLIF(payload ->> 'tax_amount', '')::numeric;
  v_discount_amount     := COALESCE(NULLIF(payload ->> 'discount_amount', '')::numeric, 0);

  v_is_walkin := v_customer_profile_id IS NULL AND v_walkin_name IS NOT NULL;

  -- Exactly one buyer identity. Both-or-neither is a caller bug, not a
  -- recoverable state, so reject it before any write.
  IF v_customer_profile_id IS NULL AND v_walkin_name IS NULL THEN
    RAISE EXCEPTION 'place_assisted_addon_order: either customer_profile_id or walkin_name is required';
  END IF;

  IF v_customer_profile_id IS NOT NULL AND v_walkin_name IS NOT NULL THEN
    RAISE EXCEPTION 'place_assisted_addon_order: customer_profile_id and walkin_name are mutually exclusive';
  END IF;

  IF v_placed_by_user_id IS NULL THEN
    RAISE EXCEPTION 'place_assisted_addon_order: placed_by_user_id (operator) is required';
  END IF;

  IF v_target_date IS NULL THEN
    RAISE EXCEPTION 'place_assisted_addon_order: target_delivery_date is required';
  END IF;

  IF v_total IS NULL THEN
    RAISE EXCEPTION 'place_assisted_addon_order: total is required';
  END IF;

  -- The cart must contain at least one line. An empty or absent items array is
  -- rejected before any write.
  IF v_items IS NULL
     OR jsonb_typeof(v_items) <> 'array'
     OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'place_assisted_addon_order: at least one order item is required';
  END IF;

  -- clinic_id and movement_source travel together: a fulfilling Core_Clinic
  -- with no movement_source (or vice versa) is a caller bug in how the two new
  -- fields were threaded, not a state clinic_shop_apply_sale should have to
  -- diagnose on our behalf.
  IF v_clinic_id IS NOT NULL AND v_movement_source IS NULL THEN
    RAISE EXCEPTION 'place_assisted_addon_order: movement_source is required when clinic_id is provided';
  END IF;

  -- A walk-in sale is always handed over across the counter: there is no
  -- subscription and therefore no delivery to ride along with.
  IF v_is_walkin THEN
    v_status             := 'DELIVERED';
    v_fulfillment_status := 'CLINIC_PICKUP';
    v_delivered_at       := now();
  ELSIF v_is_clinic_pickup THEN
    v_status             := 'DELIVERED';
    v_fulfillment_status := 'CLINIC_PICKUP';
    v_delivered_at       := now();
  ELSE
    v_status             := 'PAID';
    v_fulfillment_status := NULL;
    v_delivered_at       := NULL;
  END IF;

  -- --------------------------------------------------------------------------
  -- 1. PAYMENTS — exactly one manual, PAID invoice of type 'ADDON'. amount is
  --    the server-computed total (delivery fee already excluded); base/tax/
  --    discount come from the same breakdown. paid_at defaults to now() to
  --    record when the Operator marked the order paid. No online charge is
  --    initiated here — this is a manual/offline PAID record.
  --    For a walk-in, customer_profile_id is NULL (nullable on payments).
  -- --------------------------------------------------------------------------
  INSERT INTO public.payments (
    customer_profile_id,
    payment_method,
    amount,
    base_amount,
    tax_amount,
    discount_amount,
    status,
    paid_at,
    invoice_type,
    payment_reference,
    payment_notes,
    franchise_id
  )
  VALUES (
    v_customer_profile_id,
    'MANUAL',
    v_total,
    v_base_amount,
    v_tax_amount,
    v_discount_amount,
    'PAID',
    now(),
    'ADDON',
    NULLIF(payload ->> 'payment_reference', ''),
    -- Keep the walk-in buyer identifiable from the invoice itself, so the
    -- payment record is self-describing without a profile join.
    COALESCE(
      NULLIF(payload ->> 'payment_notes', ''),
      CASE WHEN v_is_walkin
        THEN 'Walk-in shop sale — ' || v_walkin_name
             || COALESCE(' (' || v_walkin_mobile || ')', '')
        ELSE NULL
      END
    ),
    v_franchise_id
  )
  RETURNING id INTO v_payment_id;

  -- --------------------------------------------------------------------------
  -- 2. ADDON_ORDERS — the placed order. total_amount = the server-computed
  --    total, target_delivery_date = the resolved Next_Available_Delivery (or
  --    today for a pickup / walk-in), franchise_id stamped from the operator
  --    scope, linked to the payment above, and carrying the operator id for
  --    audit. delivery_order_id stays NULL until the Linking_Flow runs; a
  --    DELIVERED order is excluded from every future linking / routing pass.
  --    clinic_id is stamped here, in this same INSERT, when a fulfilling
  --    Core_Clinic was resolved by the caller (Requirements 10.3, 10.4, 10.5) —
  --    NULL for a franchise order or any order with no fulfilling Core_Clinic,
  --    which is exactly the `Unassigned` grouping Requirement 12.6 describes.
  -- --------------------------------------------------------------------------
  INSERT INTO public.addon_orders (
    customer_profile_id,
    payment_id,
    total_amount,
    status,
    target_delivery_date,
    franchise_id,
    placed_by_user_id,
    fulfillment_status,
    delivered_at,
    walkin_name,
    walkin_mobile,
    walkin_address,
    clinic_id
  )
  VALUES (
    v_customer_profile_id,
    v_payment_id,
    v_total,
    v_status,
    v_target_date,
    v_franchise_id,
    v_placed_by_user_id,
    v_fulfillment_status,
    v_delivered_at,
    v_walkin_name,
    CASE WHEN v_is_walkin THEN v_walkin_mobile ELSE NULL END,
    CASE WHEN v_is_walkin THEN v_walkin_address ELSE NULL END,
    v_clinic_id
  )
  RETURNING id INTO v_addon_order_id;

  -- --------------------------------------------------------------------------
  -- 3. ADDON_ORDER_ITEMS — one row per cart line, recording the product, the
  --    ordered quantity, and the server-resolved unit price. The franchise_id
  --    is carried through for parity with existing franchise data. When a
  --    fulfilling Core_Clinic is set, the same product_id/quantity pair is
  --    also collected into v_clinic_lines for the clinic decrement step below
  --    — no second pass over the payload's items array.
  -- --------------------------------------------------------------------------
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    IF NULLIF(v_item ->> 'product_id', '') IS NULL THEN
      RAISE EXCEPTION 'place_assisted_addon_order: each item requires a product_id';
    END IF;

    IF NULLIF(v_item ->> 'quantity', '') IS NULL
       OR (v_item ->> 'quantity')::integer < 1 THEN
      RAISE EXCEPTION 'place_assisted_addon_order: each item requires a quantity of at least 1';
    END IF;

    IF NULLIF(v_item ->> 'unit_price', '') IS NULL THEN
      RAISE EXCEPTION 'place_assisted_addon_order: each item requires a server-resolved unit_price';
    END IF;

    INSERT INTO public.addon_order_items (
      addon_order_id,
      product_id,
      quantity,
      unit_price,
      franchise_id
    )
    VALUES (
      v_addon_order_id,
      (v_item ->> 'product_id')::uuid,
      (v_item ->> 'quantity')::integer,
      (v_item ->> 'unit_price')::numeric,
      v_franchise_id
    );

    IF v_clinic_id IS NOT NULL THEN
      v_clinic_lines := v_clinic_lines || jsonb_build_object(
        'product_id', v_item ->> 'product_id',
        'quantity', (v_item ->> 'quantity')::integer
      );
    END IF;
  END LOOP;

  -- --------------------------------------------------------------------------
  -- 4. Clinic decrement + OUT ledger write — ONLY when a fulfilling Core_Clinic
  --    was resolved by the caller. Skipped entirely for a franchise order or
  --    any order with no fulfilling Core_Clinic, leaving those paths byte-for-
  --    byte unchanged.
  --
  --    `clinic_shop_apply_sale` runs inside THIS SAME transaction (a plpgsql
  --    function call from within another plpgsql function body does not open
  --    a new transaction), so it inherits every write already made above.
  --    It re-validates the movement source, the clinic, the actor, the order,
  --    and every line's quantity against the fulfilling clinic's current
  --    Effective_Clinic_Stock under a row lock, then performs the conditional
  --    decrement and writes one OUT ledger row per line, referencing this
  --    order (Requirements 10.8, 10.10, 11.2). Any exception it raises — most
  --    notably `CLINIC_STOCK_INSUFFICIENT_CLINIC:` naming every shortfall
  --    product — propagates straight out of this function and rolls back the
  --    payment, order, and items already inserted above (Requirements 10.9,
  --    11.1, 11.3). Its own report jsonb is not needed by this caller.
  -- --------------------------------------------------------------------------
  IF v_clinic_id IS NOT NULL THEN
    PERFORM public.clinic_shop_apply_sale(
      v_clinic_id,
      v_addon_order_id,
      v_clinic_lines,
      v_movement_source,
      v_placed_by_user_id
    );
  END IF;

  -- --------------------------------------------------------------------------
  -- 5. Return the new addon_order id. Reaching here means every INSERT (and,
  --    when applicable, the clinic decrement) succeeded and the transaction
  --    will commit as a unit.
  -- --------------------------------------------------------------------------
  RETURN v_addon_order_id;
END;
$$;

-- ============================================================================
-- DONE.
--
-- Rollback: re-run scripts/add-walkin-shop-orders.sql — its
-- CREATE OR REPLACE FUNCTION restores the pre-clinic body verbatim.
-- ============================================================================
