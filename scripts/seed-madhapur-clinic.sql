-- ============================================================================
-- CORE CLINIC ARCHITECTURE — Core Hyderabad Business Seed & History Back-Stamp
-- (SAFE: Core-only, idempotent, single transaction)
-- ============================================================================
-- PURPOSE
--   Seeds the CORE hierarchy and back-fills clinic associations so that no core
--   record is left orphaned from a Clinic (Requirement 15):
--
--       Core Hyderabad Business (type 'Core')
--         └── Hyderabad Central Kitchen   (NO routing geo; prep/workload only)
--               ├── Madhapur Clinic        (Core Clinic — has its OWN address/geo)
--               └── Uppal Clinic           (Core Clinic — has its OWN address/geo)
--
--   Run this MANUALLY in the Supabase SQL editor, AFTER:
--     1. scripts/create-clinic-hierarchy-tables.sql  (businesses/cities/clinics,
--        kitchens.business_id + kitchens.city_id, clinic_id columns)
--     2. scripts/add-clinic-stamp-to-orders.sql       (delivery_orders/_batches clinic_id)
--   It performs no application work and is safe to re-run (idempotent).
--
-- ── WHAT CHANGED VS THE OLD SEED ────────────────────────────────────────────
--   The previous seed created ONE "Madhapur Clinic" and COPIED the kitchen's
--   address_text/lat/lng onto it. That is wrong: the Kitchen carries no routing
--   geo, and a Clinic's coordinates must be its OWN (Req 2.5, 2.7, 3.11, 15.3).
--   This rewrite:
--     * creates the explicit "Core Hyderabad Business" (type 'Core', Req 15.1),
--     * resolves/ensures the "Hyderabad Central Kitchen" owned by that business
--       with NO geo used as a routing origin/seed source (Req 15.2),
--     * backfills kitchens.business_id and promotes it to NOT NULL once every
--       kitchen is backfilled (Req 2.2, 20.8),
--     * creates TWO Core Clinics (Madhapur, Uppal) whose address/lat/lng are set
--       DIRECTLY from seeded clinic values — never copied from the Kitchen
--       (Req 15.3),
--     * gap-fills customers/riders/service-areas + primary addresses to Madhapur,
--     * guards zero-orphan, and back-stamps order/batch history to Madhapur.
--
-- ── SEEDED CLINIC COORDINATES (set directly on each Clinic; Req 15.3) ────────
--     Madhapur Clinic : lat 17.3201133, lng 78.3390182
--     Uppal Clinic    : lat 17.4018,    lng 78.5602
--   These are the Clinics' OWN coordinates. They are NOT read from, derived
--   from, or copied off the Kitchen.
--
-- ── CORE-ONLY SCOPING (franchise data is NEVER touched) ─────────────────────
--   Franchise kitchens/clinics/customers/riders/data are SEPARATE and owned by
--   franchises. EVERY write below is scoped so only CORE rows are touched:
--     * customer_profiles / rider_profiles / rider_service_areas / delivery_*
--       are scoped to `franchise_id IS NULL`.
--     * addresses carry no reliable franchise_id, so they are scoped by their
--       owning customer being core
--       (customer_profile_id IN (SELECT id FROM customer_profiles WHERE franchise_id IS NULL))
--       and additionally restricted to the PRIMARY address (is_primary = true),
--       which is what anchors a Customer's clinic (Req 6.2, 7.2).
--   Franchise-owned rows (franchise_id IS NOT NULL) are never modified.
--
-- ── CORE-KITCHEN RESOLUTION (dynamic; never hardcoded) ──────────────────────
--   The core kitchen is the single active kitchen NOT referenced by any
--   franchise:
--       is_active = true
--       AND id NOT IN (SELECT kitchen_id FROM public.franchises WHERE kitchen_id IS NOT NULL)
--   EXACTLY ONE such kitchen is expected. If ZERO match, one is created. If MORE
--   THAN ONE matches, the script RAISES AN EXCEPTION (aborting/rolling back) so
--   the operator resolves the ambiguity rather than seeding the wrong kitchen.
--   The resolved kitchen is (re)named 'Hyderabad Central Kitchen' (idempotent).
--
-- ── KITCHEN GEO NOTE (Req 2.5, 2.7, 3.11, 15.2) ─────────────────────────────
--   kitchens.lat / kitchens.lng are legacy NOT NULL columns. This feature no
--   longer uses them as a routing origin or seed source, and this additive
--   migration neither drops nor rewrites them. When CREATING a brand-new core
--   kitchen the NOT NULL constraint is satisfied with placeholder 0/0 — these
--   values are never read by routing or copied onto a Clinic. Existing kitchen
--   geo is left untouched (additive principle).
--
-- ── SAFETY / IDEMPOTENCY / TRANSACTION (Req 15.8, 15.9, 15.11) ──────────────
--   Additive only: inserts at most one business, one city, one kitchen (if
--   none), two clinics, and fills clinic_id stamps. Drops nothing. The whole
--   migration runs inside a single DO $$ ... $$ plpgsql block, which executes as
--   ONE atomic transaction — any error (ambiguous kitchen, or a remaining
--   orphan) aborts and rolls back ALL changes so no partial migration persists.
--
--   Idempotent guards:
--     * business insert guarded by NOT EXISTS (name + type)
--     * city insert     guarded by NOT EXISTS (case-insensitive)
--     * kitchen link    guarded by IS DISTINCT FROM
--     * NOT NULL promotion of kitchens.business_id runs ONLY when no kitchen
--       still has a NULL business_id (so franchise kitchens that are not yet
--       wired to a Business do not cause a rollback; promotion is deferred with
--       a NOTICE until a later franchise spec backfills them)
--     * clinic inserts  guarded by NOT EXISTS (name + franchise_id IS NULL)
--     * every stamp UPDATE is scoped to `clinic_id IS NULL` (gap-fill only), so
--       a clean re-run is a no-op and records already assigned to another core
--       clinic are left alone (honors Req 15.10). Order/batch back-stamps fill
--       only NULL stamps and never overwrite (immutability Req 19.4/19.5).
--
--   RLS (Req 15.11): This script only INSERTs reference data and fills clinic_id
--   stamps. It does not enable/alter RLS, following the established additive
--   pattern. Run it with a privileged (service-role) connection.
--
-- ── ROLLBACK (manual undo) ──────────────────────────────────────────────────
--   Run undo in a transaction. ORDER MATTERS: null out clinic_id stamps that
--   point at the Core Clinics BEFORE deleting the clinics, otherwise the FK
--   references would block the delete. (kitchens.business_id may need to be made
--   nullable again first if it was promoted: ALTER TABLE public.kitchens ALTER
--   COLUMN business_id DROP NOT NULL;)
--     BEGIN;
--     WITH core AS (SELECT id FROM public.clinics WHERE franchise_id IS NULL
--                   AND name IN ('Madhapur Clinic','Uppal Clinic'))
--     UPDATE public.delivery_batches    SET clinic_id = NULL WHERE clinic_id IN (SELECT id FROM core);
--     -- (repeat the same WITH core ... UPDATE ... pattern for:)
--     --   delivery_orders, addresses, rider_service_areas, rider_profiles, customer_profiles
--     DELETE FROM public.clinics WHERE franchise_id IS NULL
--       AND name IN ('Madhapur Clinic','Uppal Clinic');
--     -- (optional) DELETE FROM public.businesses WHERE name = 'Core Hyderabad Business' AND type = 'Core';
--     -- (optional) DELETE FROM public.cities    WHERE lower(name) = lower('Hyderabad');
--     COMMIT;
-- ============================================================================

DO $$
DECLARE
  v_business_id        uuid;
  v_business_existed   boolean := false;
  v_city_id            uuid;
  v_kitchen_id         uuid;
  v_kitchen_name       text;
  v_core_kitchen_count integer;
  v_kitchen_created    boolean := false;
  v_null_business      integer := 0;   -- kitchens still missing business_id
  v_madhapur_id        uuid;
  v_uppal_id           uuid;
  v_madhapur_existed   boolean := false;
  v_uppal_existed      boolean := false;
  -- Affected-row counters for the run-summary NOTICE.
  v_customers integer := 0;
  v_addresses integer := 0;
  v_riders    integer := 0;
  v_areas     integer := 0;
  v_orders    integer := 0;
  v_batches   integer := 0;
  -- Zero-orphan guard counters (Req 15.7).
  v_orphan_customers integer := 0;
  v_orphan_riders    integer := 0;
  v_orphan_areas     integer := 0;
  -- Seeded clinic coordinates (the Clinics' OWN geo; Req 15.3).
  c_madhapur_lat  double precision := 17.3201133;
  c_madhapur_lng  double precision := 78.3390182;
  c_uppal_lat     double precision := 17.4018;
  c_uppal_lng     double precision := 78.5602;
  c_madhapur_addr text := 'Madhapur, HITEC City Road, Hyderabad, Telangana 500081';
  c_uppal_addr    text := 'Uppal, Hyderabad, Telangana 500039';
BEGIN
  -- ──────────────────────────────────────────────────────────────────────────
  -- STEP 1: Create EXACTLY ONE Core Hyderabad Business (type 'Core'). Req 15.1.
  -- Guarded by NOT EXISTS on (name, type) so re-runs create no duplicate.
  -- ──────────────────────────────────────────────────────────────────────────
  SELECT id INTO v_business_id
    FROM public.businesses
   WHERE name = 'Core Hyderabad Business'
     AND type = 'Core'
   LIMIT 1;

  IF v_business_id IS NULL THEN
    INSERT INTO public.businesses (name, type)
    VALUES ('Core Hyderabad Business', 'Core')
    RETURNING id INTO v_business_id;
    RAISE NOTICE 'Created Business "Core Hyderabad Business" (id=%).', v_business_id;
  ELSE
    v_business_existed := true;
    RAISE NOTICE 'Business "Core Hyderabad Business" already exists (id=%); reusing.', v_business_id;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- STEP 2: Ensure the "Hyderabad" City exists (idempotent, case-insensitive).
  -- Needed before the Kitchen so we can set kitchens.city_id. Req 1, 15.
  -- ──────────────────────────────────────────────────────────────────────────
  SELECT id INTO v_city_id
    FROM public.cities
   WHERE lower(name) = lower('Hyderabad')
   LIMIT 1;

  IF v_city_id IS NULL THEN
    INSERT INTO public.cities (name)
    VALUES ('Hyderabad')
    RETURNING id INTO v_city_id;
    RAISE NOTICE 'Created City "Hyderabad" (id=%).', v_city_id;
  ELSE
    RAISE NOTICE 'City "Hyderabad" already exists (id=%); reusing.', v_city_id;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- STEP 3: Resolve/ensure the CORE kitchen "Hyderabad Central Kitchen". Req 15.2.
  -- Resolution = the single active kitchen NOT referenced by any franchise.
  -- Exactly one expected: 0 -> create; >1 -> abort (ambiguous). Then own it to
  -- the Core Business + Hyderabad City, store NO routing geo, backfill
  -- business_id and promote kitchens.business_id to NOT NULL once all kitchens
  -- are backfilled (Req 2.2, 20.8).
  -- ──────────────────────────────────────────────────────────────────────────
  SELECT count(*) INTO v_core_kitchen_count
    FROM public.kitchens k
   WHERE k.is_active = true
     AND k.id NOT IN (
       SELECT f.kitchen_id FROM public.franchises f WHERE f.kitchen_id IS NOT NULL
     );

  IF v_core_kitchen_count > 1 THEN
    RAISE EXCEPTION
      'Ambiguous CORE kitchen: % active kitchens are unreferenced by a franchise. Expected exactly one. Aborting; nothing migrated.',
      v_core_kitchen_count;
  ELSIF v_core_kitchen_count = 1 THEN
    SELECT k.id, k.name
      INTO v_kitchen_id, v_kitchen_name
      FROM public.kitchens k
     WHERE k.is_active = true
       AND k.id NOT IN (
         SELECT f.kitchen_id FROM public.franchises f WHERE f.kitchen_id IS NOT NULL
       );
    RAISE NOTICE 'Resolved CORE kitchen "%" (id=%); ensuring name/ownership.',
      v_kitchen_name, v_kitchen_id;
  ELSE
    -- No core kitchen exists yet: create one. lat/lng are legacy NOT NULL
    -- columns and are NOT used as a routing origin/seed source (placeholder 0/0).
    INSERT INTO public.kitchens (name, lat, lng, is_active)
    VALUES ('Hyderabad Central Kitchen', 0, 0, true)
    RETURNING id INTO v_kitchen_id;
    v_kitchen_created := true;
    RAISE NOTICE 'No core kitchen found; created "Hyderabad Central Kitchen" (id=%).', v_kitchen_id;
  END IF;

  -- Ensure name, business ownership and city — idempotent (only writes on change).
  UPDATE public.kitchens
     SET name        = 'Hyderabad Central Kitchen',
         business_id = v_business_id,
         city_id     = v_city_id
   WHERE id = v_kitchen_id
     AND (name        IS DISTINCT FROM 'Hyderabad Central Kitchen'
          OR business_id IS DISTINCT FROM v_business_id
          OR city_id     IS DISTINCT FROM v_city_id);

  -- Promote kitchens.business_id to NOT NULL — ONLY once every kitchen has a
  -- business_id (Req 2.2, 20.8). Franchise kitchens not yet wired to a Business
  -- still have NULL business_id; promoting now would fail and roll back the
  -- whole seed, so promotion is deferred (with a NOTICE) until a later franchise
  -- spec backfills them. Re-running this seed performs the promotion as soon as
  -- the precondition holds.
  SELECT count(*) INTO v_null_business
    FROM public.kitchens
   WHERE business_id IS NULL;

  IF v_null_business = 0 THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'kitchens'
         AND column_name = 'business_id' AND is_nullable = 'YES'
    ) THEN
      ALTER TABLE public.kitchens ALTER COLUMN business_id SET NOT NULL;
      RAISE NOTICE 'Promoted kitchens.business_id to NOT NULL (all kitchens backfilled).';
    ELSE
      RAISE NOTICE 'kitchens.business_id already NOT NULL; nothing to promote.';
    END IF;
  ELSE
    RAISE NOTICE
      'Deferred NOT NULL promotion of kitchens.business_id: % kitchen(s) still have a NULL business_id (likely franchise kitchens not yet wired to a Business).',
      v_null_business;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- STEP 4: Create EXACTLY TWO Core Clinics (Madhapur, Uppal). Req 15.3, 15.8.
  -- Each: kitchen_id = the core kitchen, franchise_id = NULL (Core Clinic), and
  -- address/latitude/longitude set DIRECTLY from the seeded clinic values above
  -- — NEVER copied from the kitchen. Guarded by NOT EXISTS (name, franchise_id
  -- IS NULL) so re-runs create no duplicates.
  -- ──────────────────────────────────────────────────────────────────────────
  SELECT id INTO v_madhapur_id
    FROM public.clinics
   WHERE name = 'Madhapur Clinic' AND franchise_id IS NULL
   LIMIT 1;

  IF v_madhapur_id IS NULL THEN
    INSERT INTO public.clinics (name, address, latitude, longitude, kitchen_id, franchise_id)
    VALUES ('Madhapur Clinic', c_madhapur_addr, c_madhapur_lat, c_madhapur_lng, v_kitchen_id, NULL)
    RETURNING id INTO v_madhapur_id;
    RAISE NOTICE 'Created Madhapur Clinic (id=%, lat=%, lng=%).', v_madhapur_id, c_madhapur_lat, c_madhapur_lng;
  ELSE
    v_madhapur_existed := true;
    RAISE NOTICE 'Madhapur Clinic already exists (id=%); reusing (idempotent).', v_madhapur_id;
  END IF;

  SELECT id INTO v_uppal_id
    FROM public.clinics
   WHERE name = 'Uppal Clinic' AND franchise_id IS NULL
   LIMIT 1;

  IF v_uppal_id IS NULL THEN
    INSERT INTO public.clinics (name, address, latitude, longitude, kitchen_id, franchise_id)
    VALUES ('Uppal Clinic', c_uppal_addr, c_uppal_lat, c_uppal_lng, v_kitchen_id, NULL)
    RETURNING id INTO v_uppal_id;
    RAISE NOTICE 'Created Uppal Clinic (id=%, lat=%, lng=%).', v_uppal_id, c_uppal_lat, c_uppal_lng;
  ELSE
    v_uppal_existed := true;
    RAISE NOTICE 'Uppal Clinic already exists (id=%); reusing (idempotent).', v_uppal_id;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- STEP 5: Customers — keep existing Madhapur-stamped customers under Madhapur
  -- (untouched), gap-fill core customers with NULL clinic_id to Madhapur, and
  -- gap-fill their PRIMARY addresses to Madhapur. Req 15.4 (+ 6.2/7.2 anchor).
  -- Every UPDATE is scoped to core (franchise_id IS NULL) and to clinic_id IS
  -- NULL, so a clean re-run is a no-op and customers already on another core
  -- clinic are left alone (Req 15.10).
  -- ──────────────────────────────────────────────────────────────────────────
  UPDATE public.customer_profiles
     SET clinic_id = v_madhapur_id
   WHERE franchise_id IS NULL
     AND clinic_id IS NULL;
  GET DIAGNOSTICS v_customers = ROW_COUNT;

  -- Primary addresses of core customers (addresses.franchise_id is unreliable,
  -- so scope by the owning customer being core). Only the PRIMARY address
  -- anchors the Customer's clinic (Req 6.2 / 7.2); gap-fill clinic_id IS NULL.
  UPDATE public.addresses
     SET clinic_id = v_madhapur_id
   WHERE clinic_id IS NULL
     AND is_primary = true
     AND customer_profile_id IN (
       SELECT id FROM public.customer_profiles WHERE franchise_id IS NULL
     );
  GET DIAGNOSTICS v_addresses = ROW_COUNT;

  -- ──────────────────────────────────────────────────────────────────────────
  -- STEP 6: Riders — link every core Rider to Madhapur (gap-fill). Req 15.5.
  -- ──────────────────────────────────────────────────────────────────────────
  UPDATE public.rider_profiles
     SET clinic_id = v_madhapur_id
   WHERE franchise_id IS NULL
     AND clinic_id IS NULL;
  GET DIAGNOSTICS v_riders = ROW_COUNT;

  -- ──────────────────────────────────────────────────────────────────────────
  -- STEP 7: Service areas — associate every core Service_Area pincode with
  -- Madhapur (gap-fill). Req 15.6.
  -- ──────────────────────────────────────────────────────────────────────────
  UPDATE public.rider_service_areas
     SET clinic_id = v_madhapur_id
   WHERE franchise_id IS NULL
     AND clinic_id IS NULL;
  GET DIAGNOSTICS v_areas = ROW_COUNT;

  -- ──────────────────────────────────────────────────────────────────────────
  -- STEP 8: ZERO-ORPHAN GUARANTEE (Req 15.7). After stamping, no CORE customer,
  -- rider, or service area may remain with a NULL clinic_id. If any do, RAISE
  -- EXCEPTION to abort and roll back the whole transaction (Req 15.9).
  -- ──────────────────────────────────────────────────────────────────────────
  SELECT count(*) INTO v_orphan_customers
    FROM public.customer_profiles
   WHERE franchise_id IS NULL AND clinic_id IS NULL;

  SELECT count(*) INTO v_orphan_riders
    FROM public.rider_profiles
   WHERE franchise_id IS NULL AND clinic_id IS NULL;

  SELECT count(*) INTO v_orphan_areas
    FROM public.rider_service_areas
   WHERE franchise_id IS NULL AND clinic_id IS NULL;

  IF v_orphan_customers > 0 OR v_orphan_riders > 0 OR v_orphan_areas > 0 THEN
    RAISE EXCEPTION
      'Zero-orphan check FAILED: % core customers, % core riders, % core service areas still have NULL clinic_id. Rolling back (Req 15.7).',
      v_orphan_customers, v_orphan_riders, v_orphan_areas;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- STEP 9: History back-stamp — set delivery_orders.clinic_id /
  -- delivery_batches.clinic_id to Madhapur for pre-existing core rows whose
  -- stamp is still NULL. FILL-NULL ONLY — an already-stamped row is never
  -- overwritten (immutability Req 19.4/19.5; history Req 19.6/19.7). Scoped to
  -- core (franchise_id IS NULL). Additive and RLS-respecting (Req 15.11).
  -- ──────────────────────────────────────────────────────────────────────────
  UPDATE public.delivery_orders
     SET clinic_id = v_madhapur_id
   WHERE franchise_id IS NULL
     AND clinic_id IS NULL;
  GET DIAGNOSTICS v_orders = ROW_COUNT;

  UPDATE public.delivery_batches
     SET clinic_id = v_madhapur_id
   WHERE franchise_id IS NULL
     AND clinic_id IS NULL;
  GET DIAGNOSTICS v_batches = ROW_COUNT;

  -- ──────────────────────────────────────────────────────────────────────────
  -- Run summary. (Counts reflect rows CHANGED by THIS run; a clean re-run shows
  -- zeros because every gap-fill guard makes the step a no-op.)
  -- ──────────────────────────────────────────────────────────────────────────
  RAISE NOTICE '────────────────────────────────────────────────────────────';
  RAISE NOTICE 'Core Hyderabad Business seed complete.';
  RAISE NOTICE '  business              : % (pre-existing=%)', v_business_id, v_business_existed;
  RAISE NOTICE '  kitchen               : % (created=%)',      v_kitchen_id, v_kitchen_created;
  RAISE NOTICE '  city                  : %',                  v_city_id;
  RAISE NOTICE '  Madhapur Clinic       : % (pre-existing=%)', v_madhapur_id, v_madhapur_existed;
  RAISE NOTICE '  Uppal Clinic          : % (pre-existing=%)', v_uppal_id, v_uppal_existed;
  RAISE NOTICE '  customers stamped     : % (-> Madhapur)',    v_customers;
  RAISE NOTICE '  primary addrs stamped : % (-> Madhapur)',    v_addresses;
  RAISE NOTICE '  riders linked         : % (-> Madhapur)',    v_riders;
  RAISE NOTICE '  service areas linked  : % (-> Madhapur)',    v_areas;
  RAISE NOTICE '  orders back-stamped   : % (NULL stamps filled)', v_orders;
  RAISE NOTICE '  batches back-stamped  : % (NULL stamps filled)', v_batches;
  RAISE NOTICE '  zero-orphan check     : PASSED (0 core customers/riders/areas unstamped)';
  RAISE NOTICE 'Franchise-owned rows (franchise_id IS NOT NULL) were left untouched.';
  RAISE NOTICE '────────────────────────────────────────────────────────────';
END
$$;

-- ============================================================================
-- VERIFICATION (read-only; run after the migration to confirm the result).
-- ============================================================================

-- V1. Exactly one Core Hyderabad Business (type 'Core').
-- SELECT id, name, type FROM public.businesses
--  WHERE name = 'Core Hyderabad Business' AND type = 'Core';

-- V2. The core kitchen is owned by the Core Business, linked to Hyderabad city.
-- SELECT k.id, k.name, k.business_id, k.city_id, b.name AS business_name, ci.name AS city_name
--   FROM public.kitchens k
--   JOIN public.businesses b ON b.id = k.business_id
--   LEFT JOIN public.cities ci ON ci.id = k.city_id
--  WHERE k.name = 'Hyderabad Central Kitchen';

-- V3. Exactly two Core Clinics with their OWN coordinates (not the kitchen's).
-- SELECT c.id, c.name, c.address, c.latitude, c.longitude, c.kitchen_id, c.franchise_id
--   FROM public.clinics c
--  WHERE c.franchise_id IS NULL AND c.name IN ('Madhapur Clinic','Uppal Clinic')
--  ORDER BY c.name;

-- V4. ZERO core customers / riders / service areas with a NULL clinic_id
--     (Req 15.7). Expect all three = 0. Franchise rows are excluded by design.
-- SELECT
--   (SELECT count(*) FROM public.customer_profiles   WHERE franchise_id IS NULL AND clinic_id IS NULL) AS core_customers_unstamped,
--   (SELECT count(*) FROM public.rider_profiles      WHERE franchise_id IS NULL AND clinic_id IS NULL) AS core_riders_unstamped,
--   (SELECT count(*) FROM public.rider_service_areas WHERE franchise_id IS NULL AND clinic_id IS NULL) AS core_service_areas_unstamped;

-- V5. Back-stamped order/batch history attributed to the Madhapur Clinic.
-- SELECT
--   (SELECT count(*) FROM public.delivery_orders  o
--      WHERE o.clinic_id = (SELECT id FROM public.clinics WHERE name='Madhapur Clinic' AND franchise_id IS NULL LIMIT 1)) AS orders_stamped_madhapur,
--   (SELECT count(*) FROM public.delivery_batches b
--      WHERE b.clinic_id = (SELECT id FROM public.clinics WHERE name='Madhapur Clinic' AND franchise_id IS NULL LIMIT 1)) AS batches_stamped_madhapur;

-- ============================================================================
-- DONE. One Core Hyderabad Business; one Hyderabad Central Kitchen (no routing
-- geo); two Core Clinics (Madhapur, Uppal) with their OWN coordinates; all CORE
-- customers/riders/service-areas gap-filled to Madhapur; order/batch history
-- back-stamped to Madhapur. Franchise data deliberately untouched. Master_Admin
-- may edit the seeded Business/Kitchen/Clinics and add more later (Req 15.10).
-- Re-running this script changes nothing further (idempotent).
-- ============================================================================
