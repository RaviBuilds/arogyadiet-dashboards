-- scripts/restrict-dietitian-read-scope-to-assigned.sql
--
-- SECURITY FIX — tighten the Core_Business Dietitian read scope.
--
-- Previously a Core Dietitian could read every Customer_Record of their linked
-- Clinic (`cp.clinic_id = d.clinic_id`), in addition to the ones assigned to
-- them. That let a Dietitian see clinic-mates' customers they were never
-- assigned to. This migration removes the Clinic disjunct so a Core Dietitian
-- reads ONLY the Customer_Records explicitly linked to them via Dietitian_Link
-- (`cp.dietitian_id = d.user_id`).
--
-- Franchise Dietitians are unchanged: they still read their whole tenant
-- (`cp.franchise_id = d.franchise_id`), matching the Franchise Owner model
-- (Req 21.8, 21.11).
--
-- This replaces `public.dietitian_can_read_customer` in place. Every RLS
-- policy that references it (dietitian_select_customer_profiles on
-- customer_profiles; health_logs_select / _insert / _update on health_logs)
-- picks up the new definition automatically — no policy changes required.
--
-- Idempotent: safe to run more than once. Mirrors
-- src/lib/dietitian/scope.ts (dietitianCanRead) exactly.

CREATE OR REPLACE FUNCTION public.dietitian_can_read_customer(p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.current_dietitian() d
    JOIN public.customer_profiles cp ON cp.id = p_profile_id
    WHERE (d.franchise_id IS NOT NULL AND cp.franchise_id = d.franchise_id)
       OR (d.franchise_id IS NULL AND cp.dietitian_id = d.user_id)
  )
$$;

COMMENT ON FUNCTION public.dietitian_can_read_customer(uuid) IS
  'True when the calling Dietitian may READ the given Customer_Record (Req 5.5, 5.6, 5.11). Core Dietitians read only their Dietitian_Link-assigned customers; the linked Clinic does not widen the scope. Mirrors src/lib/dietitian/scope.ts exactly. Grants no write access of any kind (Req 5.10, 16.5).';
