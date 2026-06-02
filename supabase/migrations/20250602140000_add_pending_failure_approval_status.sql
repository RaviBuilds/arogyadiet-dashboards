-- Allow riders to request failed delivery pending admin approval
ALTER TABLE public.delivery_orders
  DROP CONSTRAINT IF EXISTS delivery_orders_status_check;

ALTER TABLE public.delivery_orders
  ADD CONSTRAINT delivery_orders_status_check
  CHECK (
    status = ANY (
      ARRAY[
        'ORDER_CREATED'::text,
        'MEAL_PREPARED'::text,
        'ASSIGNED'::text,
        'PICKED'::text,
        'OUT_FOR_DELIVERY'::text,
        'ON_THE_WAY'::text,
        'REACHING_TO_LOCATION'::text,
        'PENDING_FAILURE_APPROVAL'::text,
        'DELIVERED'::text,
        'FAILED'::text,
        'CANCELLED'::text
      ]
    )
  );
