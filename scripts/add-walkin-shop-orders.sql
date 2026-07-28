-- ============================================================================
-- WALK-IN SHOP ORDERS — counter sales to non-subscriber customers
-- ============================================================================
-- Feature: admin-place-shop-order-for-customer (walk-in extension)
--
-- Today an assisted shop order can only be placed for an existing Core customer
-- (a `customer_profiles` row with an ACTIVE subscription). A walk-in buyer who
-- only purchases a shop product — no meal / kit / accommodation subscription —
-- has no profile, so the sale could not be recorded at all and the stock
-- movement went unaccounted for.
--
-- This migration lets `public.addon_orders` carry a "walk-in buyer" instead of a
-- `customer_profile_id`, so EVERY unit that leaves shop stock has exactly one
-- order row behind it, in the SAME table the customer-placed and assisted orders
-- already live in. That keeps the single "all shop orders" view, the BI revenue
-- rollups (which read `addon_orders.total_amount`), and the invoices/payments
-- trail unified — no parallel table, no placeholder customer rows polluting the
-- customer base, search, or customer-count metrics.
--
-- WALK-IN ORDER SHAPE (enforced by the RPC below):
--   - `customer_profile_id` IS NULL, `walkin_name` IS NOT NULL,
--   - it is a counter sale: created status 'DELIVERED' with
--     `fulfillment_status = 'CLINIC_PICKUP'` and `delivered_at = now()`,
--   - `delivery_order_id` stays NULL forever. Because the product-linking flow
--     only ever touches PAID + unlinked orders matched by
--     `customer_profile_id`, a walk-in order can never be picked up by routing
--     and no rider will ever carry it.
--
-- IDEMPOTENT: safe to run more than once.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Buyer identity columns.
--
--    `walkin_name` is required for a walk-in (that is the accountability
--    record); mobile and address are optional — an admin often only gets a
--    name at the counter, and forcing a fake number would corrupt the data.
-- ----------------------------------------------------------------------------
ALTER TABLE public.addon_orders
  ADD COLUMN IF NOT EXISTS walkin_name    TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS walkin_mobile  TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS walkin_address TEXT DEFAULT NULL;

COMMENT ON COLUMN public.addon_orders.walkin_name IS
  'Walk-in (non-subscriber) buyer name. NULL for orders tied to a customer_profile_id.';
COMMENT ON COLUMN public.addon_orders.walkin_mobile IS
  'Optional walk-in buyer mobile, canonical 10-digit form.';
COMMENT ON COLUMN public.addon_orders.walkin_address IS
  'Optional free-text walk-in buyer address, recorded for accountability only.';

-- ----------------------------------------------------------------------------
-- 2. Allow a walk-in order to have no customer profile.
--
--    Existing rows are unaffected: every one of them already has a
--    customer_profile_id, and the CHECK below keeps that mandatory for any
--    non-walk-in order, so nothing can silently become buyer-less.
-- ----------------------------------------------------------------------------
ALTER TABLE public.addon_orders
  ALTER COLUMN customer_profile_id DROP NOT NULL;

-- Exactly one buyer identity per order — a profile OR a named walk-in, never
-- both and never neither.
ALTER TABLE public.addon_orders
  DROP CONSTRAINT IF EXISTS addon_orders_buyer_identity_check;

ALTER TABLE public.addon_orders
  ADD CONSTRAINT addon_orders_buyer_identity_check
  CHECK (
    (customer_profile_id IS NOT NULL AND walkin_name IS NULL)
    OR (
      customer_profile_id IS NULL
      AND walkin_name IS NOT NULL
      AND length(btrim(walkin_name)) > 0
    )
  );

-- Lets the shop-orders view / support look a walk-in buyer up by number.
CREATE INDEX IF NOT EXISTS idx_addon_orders_walkin_mobile
  ON public.addon_orders (walkin_mobile)
  WHERE walkin_mobile IS NOT NULL;

-- Lets the "all shop orders" page list walk-in sales without a full scan.
CREATE INDEX IF NOT EXISTS idx_addon_orders_walkin
  ON public.addon_orders (created_at DESC)
  WHERE customer_profile_id IS NULL;

-- ============================================================================
-- 3. place_assisted_addon_order(payload jsonb) — extended for walk-in buyers.
-- ============================================================================
-- Unchanged for the existing customer-profile path: same inserts, same order,
-- same atomicity (a plpgsql body runs in one implicit transaction, so any RAISE
-- / constraint violation rolls the whole order + items + payment back — no
-- partial order is ever left behind).
--
-- New branch: when `walkin_name` is supplied and `customer_profile_id` is not,
-- the order is written as a walk-in counter sale. `payments.customer_profile_id`
-- is left NULL (that column is already nullable) so the MANUAL/PAID ADDON
-- invoice still records the money, just without a profile.
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
    walkin_address
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
    CASE WHEN v_is_walkin THEN v_walkin_address ELSE NULL END
  )
  RETURNING id INTO v_addon_order_id;

  -- --------------------------------------------------------------------------
  -- 3. ADDON_ORDER_ITEMS — one row per cart line, recording the product, the
  --    ordered quantity, and the server-resolved unit price. The franchise_id
  --    is carried through for parity with existing franchise data.
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
  END LOOP;

  -- --------------------------------------------------------------------------
  -- 4. Return the new addon_order id. Reaching here means every INSERT
  --    succeeded and the transaction will commit as a unit.
  -- --------------------------------------------------------------------------
  RETURN v_addon_order_id;
END;
$$;

-- ============================================================================
-- DONE.
--
-- ROLLBACK (only while no walk-in rows exist):
--   ALTER TABLE public.addon_orders DROP CONSTRAINT addon_orders_buyer_identity_check;
--   ALTER TABLE public.addon_orders ALTER COLUMN customer_profile_id SET NOT NULL;
--   ALTER TABLE public.addon_orders DROP COLUMN walkin_name, DROP COLUMN walkin_mobile,
--                                   DROP COLUMN walkin_address;
--   -- then re-run scripts/create-place-assisted-addon-order-rpc.sql
-- ============================================================================
