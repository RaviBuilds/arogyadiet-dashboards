-- ============================================================================
-- ADD customer_category TO SUBSCRIPTIONS — (SAFE: additive, idempotent)
-- ============================================================================
-- Feature: customer-mobile-onboarding (Task 1.2)
--
-- Lays the multi-category foundation on public.subscriptions so every
-- subscription is associated with exactly one Customer_Category. The immediate
-- implementation target is MEAL; KIT and ACCOMMODATION are modeled here so they
-- can be added later as separately paid add-on subscriptions WITHOUT schema
-- rework (Requirements 13.1, 13.11).
--
-- Adds:
--   - subscriptions.customer_category TEXT NOT NULL DEFAULT 'MEAL'
--       Existing meal subscriptions default cleanly to 'MEAL' (Req 13.1).
--
-- Adds constraint:
--   - subscriptions_customer_category_chk
--       CHECK (customer_category IN ('MEAL','KIT','ACCOMMODATION')) — rejects
--       any Customer_Category value outside the allowed set (Req 13.1).
--
-- Adds index:
--   - uq_active_subscription_per_category
--       Partial UNIQUE index on (customer_profile_id, customer_category)
--       WHERE status IN ('PENDING','ACTIVE'). Enforces AT MOST ONE non-terminal
--       (active/pending) subscription per customer per category, so a customer
--       cannot hold two concurrent active subscriptions in the same category
--       while still allowing historical CANCELLED/EXPIRED/STOPPED rows and a
--       future re-subscription in that category (Req 13.11).
--
-- Safety: Purely additive. The DEFAULT back-fills existing rows to 'MEAL', which
-- satisfies the CHECK for all pre-existing subscriptions. No existing data is
-- dropped or rewritten. Idempotent (re-runnable) via ADD COLUMN IF NOT EXISTS /
-- DO-guarded ADD CONSTRAINT / CREATE UNIQUE INDEX IF NOT EXISTS.
--
-- RLS: This script does NOT enable or alter RLS and does NOT alter existing
-- data beyond the additive column default, following the established additive
-- pattern (add-clinic-stamp-to-orders.sql).
--
-- Rollback:
--   DROP INDEX IF EXISTS public.uq_active_subscription_per_category;
--   ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_customer_category_chk;
--   ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS customer_category;
-- ============================================================================

-- 1) Additive column (defaults existing rows to MEAL) --------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS customer_category TEXT NOT NULL DEFAULT 'MEAL';

-- 2) Restrict to the allowed Customer_Category set (Req 13.1) -------------------
-- DO-guarded so the migration is idempotent (ADD CONSTRAINT has no IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'subscriptions_customer_category_chk'
       AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_customer_category_chk
      CHECK (customer_category IN ('MEAL', 'KIT', 'ACCOMMODATION'));
  END IF;
END $$;

-- 3) At most one active/pending subscription per (customer, category) (Req 13.11)
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_subscription_per_category
  ON public.subscriptions (customer_profile_id, customer_category)
  WHERE status IN ('PENDING', 'ACTIVE');

-- ============================================================================
-- DONE. customer_category is additive (NOT NULL DEFAULT 'MEAL'), constrained to
-- MEAL/KIT/ACCOMMODATION, and the partial unique index guarantees at most one
-- non-terminal subscription per customer per category.
-- ============================================================================
