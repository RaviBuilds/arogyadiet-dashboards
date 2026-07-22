-- ============================================================================
-- ADMIN PLACE SHOP ORDER FOR CUSTOMER — Atomic place_assisted_addon_order() RPC
-- ============================================================================
-- Feature: admin-place-shop-order-for-customer (Task 1.2)
-- Requirements: 4.5, 6.1, 6.5, 7.2
--
-- Defines public.place_assisted_addon_order(payload jsonb): the AUTHORITATIVE,
-- single-transaction path that materializes an Operator-placed (Admin or
-- Franchise_Admin) shop-product order on behalf of a customer. In ONE
-- transaction it inserts, in dependency order:
--
--   1. public.payments           — MANUAL / PAID invoice of type 'ADDON'   (Req 6.1)
--   2. public.addon_orders        — status 'PAID', total_amount = total,    (Req 6.1, 7.2)
--                                   scoped franchise_id, placed_by_user_id
--   3. public.addon_order_items   — one row per cart line                   (Req 6.1)
--
-- and RETURNS the new addon_orders.id (uuid).
--
-- ATOMICITY (Req 6.5): a plpgsql function body runs inside a single implicit
-- transaction. Every INSERT below either commits together or rolls back
-- together. Any failure — a NOT NULL / UNIQUE / CHECK / FK violation, or an
-- explicit RAISE for a missing required field / empty cart — aborts the whole
-- function so NO partial order is ever left behind (no orphan payment,
-- addon_order, or addon_order_items row).
--
-- SERVER-COMPUTED INPUTS ONLY (Req 4.5): every price, the total, the target
-- delivery date, the franchise_id, and the operator id are computed and passed
-- by the trusted server (AssistedOrderService via createAdminClient). This RPC
-- is the thin transactional writer and NEVER trusts a client-supplied price —
-- unit prices arrive already resolved from the server catalog
-- (sale_price ?? original_price) and the payment amounts arrive already
-- computed by calculateShopOrderBreakdown with the delivery fee forced to 0.
--
-- SCOPE STAMPING (Req 7.2): franchise_id is stamped from the resolved operator
-- scope — a franchise id for a Franchise_Admin, NULL for an Admin (core
-- business) order. The same franchise_id is carried onto every
-- addon_order_items row for parity with existing franchise data.
--
-- SECURITY DEFINER: invoked by the service-role admin client
-- (createAdminClient) from the assisted-order Server Action AFTER that action
-- has authorized the operator, resolved and enforced the OperatorContext
-- (role + scope), re-validated customer eligibility, resolved the target
-- delivery date, and confirmed the payment is to be marked PAID. Running as
-- DEFINER keeps the atomic write behaving consistently regardless of the
-- caller's row-level privileges, mirroring create-onboard-customer-rpc.sql.
--
-- PAYLOAD SHAPE (all resolution — pricing, target date, franchise scope,
-- operator id — is done by the service; this RPC only writes):
--
-- {
--   "customer_profile_id":  "<uuid>",          -- required (Target_Customer)
--   "franchise_id":         "<uuid>" | null,    -- optional (NULL for core/Admin)
--   "placed_by_user_id":    "<uuid>",          -- required (Operator, Req 6.6)
--   "target_delivery_date": "<date>",          -- required (Next_Available_Delivery)
--   "total":                <numeric>,          -- required (breakdown total, no delivery fee)
--   "base_amount":          <numeric>,          -- optional (breakdown subtotal)
--   "tax_amount":           <numeric>,          -- optional (breakdown tax)
--   "discount_amount":      <numeric>,          -- optional, default 0
--   "payment_reference":    "<text>",          -- optional
--   "payment_notes":        "<text>",          -- optional
--   "items": [                                  -- required, at least one line
--     { "product_id": "<uuid>", "quantity": <int>, "unit_price": <numeric> },
--     ...
--   ]
-- }
--
-- Returns: the new addon_orders.id (uuid).
--
-- Safety: additive only — creates/replaces a function; alters no table and
-- drops no data. Idempotent (re-runnable) via CREATE OR REPLACE FUNCTION.
--
-- RUN ORDER (IMPORTANT): run AFTER scripts/add-placed-by-to-addon-orders.sql
-- (Task 1.1) so that addon_orders.placed_by_user_id already exists.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.place_assisted_addon_order(jsonb);
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

  v_items         jsonb := payload -> 'items';
  v_payment_id    uuid;
  v_addon_order_id uuid;
  v_item          jsonb;
  -- Clinic pickup: when true, the customer collects the product at the clinic,
  -- so the order is created already DELIVERED (fulfillment CLINIC_PICKUP) and
  -- never enters the meal-delivery linking/routing pipeline.
  v_is_clinic_pickup boolean := COALESCE((payload ->> 'is_clinic_pickup')::boolean, false);
BEGIN
  -- --------------------------------------------------------------------------
  -- 0. Extract and validate the required, server-computed inputs. A missing
  --    required field is an unrecoverable payload error; RAISE aborts the whole
  --    transaction so no partial order is created (Req 6.5).
  -- --------------------------------------------------------------------------
  v_customer_profile_id := NULLIF(payload ->> 'customer_profile_id', '')::uuid;
  v_franchise_id        := NULLIF(payload ->> 'franchise_id', '')::uuid;      -- NULL for core/Admin
  v_placed_by_user_id   := NULLIF(payload ->> 'placed_by_user_id', '')::uuid;
  v_target_date         := NULLIF(payload ->> 'target_delivery_date', '')::date;
  v_total               := NULLIF(payload ->> 'total', '')::numeric;
  v_base_amount         := NULLIF(payload ->> 'base_amount', '')::numeric;
  v_tax_amount          := NULLIF(payload ->> 'tax_amount', '')::numeric;
  v_discount_amount     := COALESCE(NULLIF(payload ->> 'discount_amount', '')::numeric, 0);

  IF v_customer_profile_id IS NULL THEN
    RAISE EXCEPTION 'place_assisted_addon_order: customer_profile_id is required';
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

  -- The cart must contain at least one line (Req 6.1). An empty or absent items
  -- array is rejected before any write.
  IF v_items IS NULL
     OR jsonb_typeof(v_items) <> 'array'
     OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'place_assisted_addon_order: at least one order item is required';
  END IF;

  -- --------------------------------------------------------------------------
  -- 1. PAYMENTS — exactly one manual, PAID invoice of type 'ADDON'. amount is
  --    the server-computed total (delivery fee already excluded); base/tax/
  --    discount come from the same breakdown. paid_at defaults to now() to
  --    record when the Operator marked the order paid (Req 6.1). No online
  --    charge is initiated here — this is a manual/offline PAID record.
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
    NULLIF(payload ->> 'payment_notes', ''),
    v_franchise_id
  )
  RETURNING id INTO v_payment_id;

  -- --------------------------------------------------------------------------
  -- 2. ADDON_ORDERS — the placed order, status 'PAID', total_amount = the
  --    server-computed total, target_delivery_date = the Next_Available_Delivery
  --    resolved by the service, franchise_id stamped from the operator scope
  --    (Req 7.2), linked to the payment above, and carrying the operator id for
  --    audit (Req 6.6). delivery_order_id stays NULL until the Linking_Flow
  --    runs; fulfillment_status stays NULL (a clean sale) unless a later
  --    franchise-stock failsafe flips it to UNFULFILLABLE_STOCK.
  -- --------------------------------------------------------------------------
  -- For a clinic pickup the order is fulfilled immediately: status DELIVERED,
  -- fulfillment_status CLINIC_PICKUP, delivered_at now(). It stays UNLINKED
  -- (delivery_order_id NULL) and, being non-PAID, is excluded from every future
  -- product-linking / routing pass. A normal order is created PAID and rides
  -- along with the resolved target delivery.
  INSERT INTO public.addon_orders (
    customer_profile_id,
    payment_id,
    total_amount,
    status,
    target_delivery_date,
    franchise_id,
    placed_by_user_id,
    fulfillment_status,
    delivered_at
  )
  VALUES (
    v_customer_profile_id,
    v_payment_id,
    v_total,
    CASE WHEN v_is_clinic_pickup THEN 'DELIVERED' ELSE 'PAID' END,
    v_target_date,
    v_franchise_id,
    v_placed_by_user_id,
    CASE WHEN v_is_clinic_pickup THEN 'CLINIC_PICKUP' ELSE NULL END,
    CASE WHEN v_is_clinic_pickup THEN now() ELSE NULL END
  )
  RETURNING id INTO v_addon_order_id;

  -- --------------------------------------------------------------------------
  -- 3. ADDON_ORDER_ITEMS — one row per cart line, recording the product, the
  --    ordered quantity, and the server-resolved unit price (Req 4.5). The
  --    franchise_id is carried through for parity with existing franchise data.
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
  --    succeeded and the transaction will commit as a unit (Req 6.5).
  -- --------------------------------------------------------------------------
  RETURN v_addon_order_id;
END;
$$;

-- ============================================================================
-- DONE. place_assisted_addon_order(payload jsonb) is the authoritative atomic
-- placement path for the assisted shop-order flow. Invoke it from
-- AssistedOrderService.placeOrder via
--   createAdminClient().rpc('place_assisted_addon_order', { payload })
-- Any failure rolls back the entire multi-table write (Req 6.5). After it
-- returns the new addon_order id, the service runs the franchise-stock failsafe
-- (franchise orders only) and then runProductLinkingAction(target_date).
-- ============================================================================
