// src/test/shop/property20-migrationQuantityPreserving.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 20 (Task 12.2)
//
// Property 20: Migration is quantity-preserving and idempotent.
//
// For any set of live Shop Products, each carrying an arbitrary legacy
// `products.stock_quantity` (a valid non-negative integer, `null`, a negative
// value, or a non-integral value), and any non-empty set of Core Clinics, a
// successful run of `migrate_shop_stock_to_clinics()`:
//
//   * hands the WHOLE clamped legacy quantity to the Migration_Target_Clinic
//     (the earliest-created Core Clinic) and 0 to every other Core Clinic, so
//     `Aggregate_Stock` after migration equals the clamped legacy quantity
//     exactly — nothing is lost, split, or duplicated across the clinic set
//     (Req 20.1, 20.4, 20.8);
//   * clamps a `null`, negative, or non-integral legacy quantity to 0
//     (Req 20.5), while reporting `null` differently from a genuine clamp in
//     `clampedProductIds` — confirmed below by reading the model's exact
//     clamping-report line;
//   * mirrors Global_Visibility (`products.is_active`) onto every created
//     overlay's `is_visible`, target clinic or not;
//   * never touches `products.stock_quantity` itself or
//     `franchise_product_settings` (Req 20.12); and
//   * is idempotent — a second run against the same world reports zero
//     overlays and zero ledger entries created and leaves `world.overlays` and
//     `world.ledger` byte-for-byte identical (Req 20.7, 20.9, 20.10).
//
// This runs against the model (`src/test/shop/clinicStockModel.ts`), mirroring
// Property 9's model-based-testing approach, since the property is about the
// transactional, all-or-nothing behaviour of a single RPC across a whole
// product/clinic grid rather than about one pure decision function.
//
// A NOTE ON THE NULL-VS-CLAMPED REPORTING RULE (Req 20.5)
// Reading `migrateShopStockToClinics` directly: for each live product,
//   `usable = typeof legacy === "number" && Number.isInteger(legacy) && legacy >= 0 ? legacy : 0`
//   `if (usable !== (legacy ?? 0)) clampedProductIds.push(product.id)`
// For a `null` legacy: `usable` is `0` (the `typeof legacy === "number"` guard
// fails), and `legacy ?? 0` is also `0`, so `usable !== (legacy ?? 0)` is
// `0 !== 0`, which is `false` — the product id is NOT pushed to
// `clampedProductIds`. For a negative or non-integral legacy, `usable` is `0`
// but `legacy ?? 0` is the original (non-zero, or non-integral) value, so the
// comparison is `false`'s opposite — the id IS pushed. This confirms the
// model's own comment: "the default, not reported as clamped" applies only to
// `null`, never to a negative or non-integral value, even though all three
// store 0. Property C below asserts this exact split.
//
// **Validates: Requirements 20.1, 20.4, 20.5, 20.7, 20.8, 20.9, 20.10, 20.12**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  aggregateStock,
  createWorld,
  migrateShopStockToClinics,
  type World,
} from "@/test/shop/clinicStockModel";
import {
  ACTOR_USER_IDS,
  arbActorUserId,
  CORE_CLINIC_IDS,
  PRODUCT_IDS,
  REFERENCE_STOCK_QUANTITY_MAXIMUM,
} from "@/test/shop/clinicStockArbitraries";

const NUM_RUNS = 150;

// ─── World factory ────────────────────────────────────────────────────────────

interface MigrationProductSpec {
  id: string;
  legacyStockQuantity: number | null;
  isActive?: boolean;
  deletedAt?: string | null;
}

/**
 * A world holding exactly the named Core Clinics (created in list order, so
 * `clinicIds[0]` is always the Migration_Target_Clinic) and the named live
 * Shop Products, with no overlays and no franchises — the "before the first
 * migration" shape every test in this file starts from.
 */
function buildMigrationWorld(
  clinicIds: readonly string[],
  products: readonly MigrationProductSpec[],
): World {
  return createWorld({
    clinics: clinicIds.map((id, index) => ({
      id,
      franchiseId: null,
      createdAtTick: index,
    })),
    products: products.map((product) => ({
      id: product.id,
      inventoryProductId: null,
      isActive: product.isActive ?? true,
      deletedAt: product.deletedAt ?? null,
      legacyStockQuantity: product.legacyStockQuantity,
    })),
  });
}

/**
 * The clamping rule transcribed from the model's own comment and confirmed by
 * reading its implementation directly (see the header note): a `null`,
 * negative, or non-integral legacy quantity clamps to 0; everything else
 * passes through unchanged. Derived independently of the reporting rule in
 * `clampedProductIds`, which Property C states separately.
 */
function clampedLegacyQuantity(legacy: number | null): number {
  return typeof legacy === "number" && Number.isInteger(legacy) && legacy >= 0
    ? legacy
    : 0;
}

/** A deterministic, order-independent snapshot of every overlay row. */
function overlaysSnapshot(world: World) {
  return [...world.overlays.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, overlay]) => ({ key, ...overlay }));
}

/** A snapshot of the ledger in its stored (insertion) order. */
function ledgerSnapshot(world: World) {
  return world.ledger.map((entry) => ({ ...entry }));
}

/** A snapshot of the legacy product catalogue the migration must never touch. */
function productsSnapshot(world: World) {
  return [...world.products.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, product]) => ({ key, ...product }));
}

/** A snapshot of `franchise_product_settings`, likewise untouched. */
function franchiseSettingsSnapshot(world: World) {
  return [...world.franchiseSettings.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, setting]) => ({ key, ...setting }));
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/**
 * Every kind of legacy quantity Requirements 20.4/20.5 turn on: a valid
 * non-negative integer within range, `null`, a negative integer, and a
 * non-integral number — biased evenly so a run explores all four freely.
 * Values never exceed the maximum here; the maximum boundary itself is the
 * dedicated boundary case below, not this general property.
 */
const arbLegacyQuantityKind: fc.Arbitrary<number | null> = fc.oneof(
  { arbitrary: fc.integer({ min: 0, max: REFERENCE_STOCK_QUANTITY_MAXIMUM }), weight: 3 },
  { arbitrary: fc.constant(null), weight: 2 },
  { arbitrary: fc.integer({ min: -1_000_000, max: -1 }), weight: 2 },
  {
    arbitrary: fc.integer({ min: -1_000, max: 1_000 }).map((n) => n + 0.5),
    weight: 2,
  },
);

/** One legacy-quantity draw per fixture product, in `PRODUCT_IDS` order. */
const arbLegacyTuple: fc.Arbitrary<Array<number | null>> = fc.tuple(
  ...PRODUCT_IDS.map(() => arbLegacyQuantityKind),
) as fc.Arbitrary<Array<number | null>>;

/** One Global_Visibility draw per fixture product, in `PRODUCT_IDS` order. */
const arbActiveTuple: fc.Arbitrary<boolean[]> = fc.tuple(
  ...PRODUCT_IDS.map(() => fc.boolean()),
) as fc.Arbitrary<boolean[]>;

/** Between one and every fixture Core Clinic. */
const arbClinicCount: fc.Arbitrary<number> = fc.integer({
  min: 1,
  max: CORE_CLINIC_IDS.length,
});

// ─── Property A — quantity-preserving ────────────────────────────────────────

describe("Property 20: Migration is quantity-preserving and idempotent", () => {
  it("Property A: Aggregate_Stock after migration equals the clamped legacy quantity for every product", () => {
    fc.assert(
      fc.property(
        arbClinicCount,
        arbLegacyTuple,
        arbActiveTuple,
        arbActorUserId,
        (clinicCount, legacyQuantities, activeFlags, actorUserId) => {
          const clinicIds = CORE_CLINIC_IDS.slice(0, clinicCount);
          const products: MigrationProductSpec[] = PRODUCT_IDS.map((id, index) => ({
            id,
            legacyStockQuantity: legacyQuantities[index],
            isActive: activeFlags[index],
          }));
          const world = buildMigrationWorld(clinicIds, products);

          const result = migrateShopStockToClinics(world, { actorUserId });
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value.status).toBe("APPLIED");
          expect(result.value.targetClinicId).toBe(clinicIds[0]);

          for (const product of products) {
            const expected = clampedLegacyQuantity(product.legacyStockQuantity);
            // Nothing lost, split, or duplicated: the sum across every Core
            // Clinic equals exactly what the single target clinic received.
            expect(aggregateStock(world, product.id)).toBe(expected);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Property B — idempotent ─────────────────────────────────────────────────

describe("Property 20 (Property B): a second migration run is a true no-op", () => {
  it("reports zero overlays and zero ledger entries and leaves overlays and ledger byte-for-byte identical", () => {
    fc.assert(
      fc.property(
        arbClinicCount,
        arbLegacyTuple,
        arbActiveTuple,
        fc.constantFrom(...ACTOR_USER_IDS),
        fc.constantFrom(...ACTOR_USER_IDS),
        (clinicCount, legacyQuantities, activeFlags, firstActorUserId, secondActorUserId) => {
          const clinicIds = CORE_CLINIC_IDS.slice(0, clinicCount);
          const products: MigrationProductSpec[] = PRODUCT_IDS.map((id, index) => ({
            id,
            legacyStockQuantity: legacyQuantities[index],
            isActive: activeFlags[index],
          }));
          const world = buildMigrationWorld(clinicIds, products);

          const first = migrateShopStockToClinics(world, {
            actorUserId: firstActorUserId,
          });
          expect(first.ok).toBe(true);
          if (!first.ok) return;
          expect(first.value.status).toBe("APPLIED");

          const overlaysBefore = overlaysSnapshot(world);
          const ledgerBefore = ledgerSnapshot(world);

          const second = migrateShopStockToClinics(world, {
            actorUserId: secondActorUserId,
          });
          expect(second.ok).toBe(true);
          if (!second.ok) return;

          // ON CONFLICT DO NOTHING skips every pair — all of them already
          // hold a record after the first run.
          expect(second.value.status).toBe("APPLIED");
          expect(second.value.overlaysCreated).toBe(0);
          expect(second.value.ledgerEntriesWritten).toBe(0);

          // A true no-op: identical content before and after the second call.
          expect(overlaysSnapshot(world)).toEqual(overlaysBefore);
          expect(ledgerSnapshot(world)).toEqual(ledgerBefore);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Property C — clamping precision ─────────────────────────────────────────

describe("Property 20 (Property C): clamping precision and the null-vs-clamped-report split", () => {
  it("a negative legacy quantity clamps to 0 and IS reported in clampedProductIds", () => {
    fc.assert(
      fc.property(
        arbClinicCount,
        fc.integer({ min: -1_000_000, max: -1 }),
        arbActorUserId,
        (clinicCount, negativeLegacy, actorUserId) => {
          const clinicIds = CORE_CLINIC_IDS.slice(0, clinicCount);
          const world = buildMigrationWorld(clinicIds, [
            { id: PRODUCT_IDS[0], legacyStockQuantity: negativeLegacy },
          ]);

          const result = migrateShopStockToClinics(world, { actorUserId });
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value.status).toBe("APPLIED");
          expect(aggregateStock(world, PRODUCT_IDS[0])).toBe(0);
          expect(result.value.clampedProductIds).toContain(PRODUCT_IDS[0]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("a non-integral legacy quantity clamps to 0 and IS reported in clampedProductIds", () => {
    fc.assert(
      fc.property(
        arbClinicCount,
        fc.integer({ min: -1_000, max: 1_000 }).map((n) => n + 0.5),
        arbActorUserId,
        (clinicCount, nonIntegralLegacy, actorUserId) => {
          const clinicIds = CORE_CLINIC_IDS.slice(0, clinicCount);
          const world = buildMigrationWorld(clinicIds, [
            { id: PRODUCT_IDS[0], legacyStockQuantity: nonIntegralLegacy },
          ]);

          const result = migrateShopStockToClinics(world, { actorUserId });
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value.status).toBe("APPLIED");
          expect(aggregateStock(world, PRODUCT_IDS[0])).toBe(0);
          expect(result.value.clampedProductIds).toContain(PRODUCT_IDS[0]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("a null legacy quantity clamps to 0 but is NOT reported in clampedProductIds — it is the documented default", () => {
    fc.assert(
      fc.property(arbClinicCount, arbActorUserId, (clinicCount, actorUserId) => {
        const clinicIds = CORE_CLINIC_IDS.slice(0, clinicCount);
        const world = buildMigrationWorld(clinicIds, [
          { id: PRODUCT_IDS[0], legacyStockQuantity: null },
        ]);

        const result = migrateShopStockToClinics(world, { actorUserId });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.status).toBe("APPLIED");
        // Same stored value as the negative/non-integral cases (0)...
        expect(aggregateStock(world, PRODUCT_IDS[0])).toBe(0);
        // ...but `null` is the default, not a clamp, so it is excluded from
        // the report — confirmed against the model's exact comparison
        // `usable !== (legacy ?? 0)`, which is `0 !== 0` (false) for `null`.
        expect(result.value.clampedProductIds).not.toContain(PRODUCT_IDS[0]);
        expect(result.value.clampedProductIds).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Property D — visibility mirrors Global_Visibility ──────────────────────

describe("Property 20 (Property D): every created overlay's is_visible mirrors Global_Visibility", () => {
  it("matches products.is_active exactly, for the target clinic and every other Core Clinic alike", () => {
    fc.assert(
      fc.property(
        arbClinicCount,
        arbActiveTuple,
        arbActorUserId,
        (clinicCount, activeFlags, actorUserId) => {
          const clinicIds = CORE_CLINIC_IDS.slice(0, clinicCount);
          const products: MigrationProductSpec[] = PRODUCT_IDS.map((id, index) => ({
            id,
            legacyStockQuantity: 0,
            isActive: activeFlags[index],
          }));
          const world = buildMigrationWorld(clinicIds, products);

          const result = migrateShopStockToClinics(world, { actorUserId });
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value.status).toBe("APPLIED");

          for (const product of products) {
            for (const clinicId of clinicIds) {
              const overlay = world.overlays.get(`${clinicId}|${product.id}`);
              expect(overlay).toBeDefined();
              expect(overlay?.isVisible).toBe(product.isActive);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Property E — untouched domains ──────────────────────────────────────────

describe("Property 20 (Property E): migration writes only to overlays and the ledger", () => {
  it("leaves world.products (the legacy snapshot) and world.franchiseSettings completely unchanged", () => {
    fc.assert(
      fc.property(
        arbClinicCount,
        arbLegacyTuple,
        arbActiveTuple,
        arbActorUserId,
        (clinicCount, legacyQuantities, activeFlags, actorUserId) => {
          const clinicIds = CORE_CLINIC_IDS.slice(0, clinicCount);
          const products: MigrationProductSpec[] = PRODUCT_IDS.map((id, index) => ({
            id,
            legacyStockQuantity: legacyQuantities[index],
            isActive: activeFlags[index],
          }));
          const world = buildMigrationWorld(clinicIds, products);
          // A pre-existing franchise + its settings, so there is something to
          // prove untouched, not merely an empty map that trivially matches.
          world.franchiseIds.add("franchise-untouched");
          world.franchiseSettings.set("franchise-untouched|" + PRODUCT_IDS[0], {
            franchiseId: "franchise-untouched",
            productId: PRODUCT_IDS[0],
            stockQuantity: 42,
            isVisible: false,
          });

          const productsBefore = productsSnapshot(world);
          const franchiseSettingsBefore = franchiseSettingsSnapshot(world);

          const result = migrateShopStockToClinics(world, { actorUserId });
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value.status).toBe("APPLIED");

          expect(productsSnapshot(world)).toEqual(productsBefore);
          expect(franchiseSettingsSnapshot(world)).toEqual(franchiseSettingsBefore);

          // The legacy field itself, specifically — not just the container.
          for (const product of products) {
            expect(world.products.get(product.id)?.legacyStockQuantity).toBe(
              product.legacyStockQuantity,
            );
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Boundary case — the maximum itself (Req 20.6, confirming) ───────────────

describe("Property 20 (boundary): the maximum legacy quantity is a hard line, not a soft one", () => {
  it("accepts a legacy quantity of exactly 1,000,000 and migrates the full amount", () => {
    fc.assert(
      fc.property(arbClinicCount, arbActorUserId, (clinicCount, actorUserId) => {
        const clinicIds = CORE_CLINIC_IDS.slice(0, clinicCount);
        const world = buildMigrationWorld(clinicIds, [
          {
            id: PRODUCT_IDS[0],
            legacyStockQuantity: REFERENCE_STOCK_QUANTITY_MAXIMUM,
          },
        ]);

        const result = migrateShopStockToClinics(world, { actorUserId });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.status).toBe("APPLIED");
        expect(result.value.exceedingProductIds).toEqual([]);
        expect(aggregateStock(world, PRODUCT_IDS[0])).toBe(
          REFERENCE_STOCK_QUANTITY_MAXIMUM,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("aborts the WHOLE migration with EXCEEDS_MAXIMUM and creates nothing when one product exceeds the maximum, even alongside other valid products", () => {
    fc.assert(
      fc.property(
        arbClinicCount,
        fc.integer({ min: 1, max: REFERENCE_STOCK_QUANTITY_MAXIMUM }),
        arbActorUserId,
        (clinicCount, validLegacy, actorUserId) => {
          const clinicIds = CORE_CLINIC_IDS.slice(0, clinicCount);
          const exceedingId = PRODUCT_IDS[0];
          const validId = PRODUCT_IDS[1];
          const world = buildMigrationWorld(clinicIds, [
            {
              id: exceedingId,
              legacyStockQuantity: REFERENCE_STOCK_QUANTITY_MAXIMUM + 1,
            },
            { id: validId, legacyStockQuantity: validLegacy },
          ]);

          const result = migrateShopStockToClinics(world, { actorUserId });
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value.status).toBe("EXCEEDS_MAXIMUM");
          expect(result.value.targetClinicId).toBeNull();
          expect(result.value.overlaysCreated).toBe(0);
          expect(result.value.ledgerEntriesWritten).toBe(0);
          expect(result.value.exceedingProductIds).toContain(exceedingId);
          expect(result.value.clampedProductIds).toEqual([]);

          // Nothing created at all — not even for the other, valid product.
          expect(world.overlays.size).toBe(0);
          expect(world.ledger).toHaveLength(0);
          expect(aggregateStock(world, validId)).toBe(0);
          expect(aggregateStock(world, exceedingId)).toBe(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
