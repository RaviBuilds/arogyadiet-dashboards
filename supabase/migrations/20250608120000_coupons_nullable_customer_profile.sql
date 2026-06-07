-- Allow global (subscription-wide) coupons with no customer_profile_id
ALTER TABLE public.coupons
  ALTER COLUMN customer_profile_id DROP NOT NULL;
