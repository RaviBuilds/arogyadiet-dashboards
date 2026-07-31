// src/test/shop/clinicStockArbitraries.ts
// Feature: clinic-scoped-shop-inventory — shared property-test arbitraries
// (Task 2.4).
//
// Every property test for this feature draws its inputs from this module, so the
// input space is described once and the edge cases the requirements call out are
// folded into the generators instead of being written as separate tests:
// stock of exactly 0, exactly 1, 999,999 and 1,000,000; missing overlay rows;
// empty / single / many-small lot sets; non-integral, negative and non-numeric
// quantities; malformed and unknown-uuid destination parameters; clinics with a
// non-null `franchise_id`; soft-deleted products.
//
// The generators are deliberately *reference-side*: the bounds, the enum members
// and the destination prefixes are re-declared here from the requirements and
// the design document rather than imported from the modules under test, so a
// generator can never inherit a bug from the code it is exercising. Type-only
// imports from `@/types/clinicShop` and `@/lib/auth/adminAccessCore` are fine —
// they carry no behaviour.
//
// Nothing here reads a clock or a random source outside fast-check: timestamps
// are generated as offsets from a fixed anchor, so every counterexample replays
// exactly.
//
// _Requirements: 2.7, 7.6, 7.10, 11.2_

import * as fc from "fast-check";

import { CLINIC_SCOPED_GROUPS } from "@/lib/auth/adminAccessCore";
import type {
  AdminAccessLevel,
  OperationsAccess,
  OperationsGroup,
  PermissionLevel,
} from "@/lib/auth/adminAccessCore";
import type {
  ClinicLedgerDirection,
  ClinicLedgerEntry,
  ClinicMovementSource,
  ClinicProductOverlayRow,
} from "@/types/clinicShop";

// ─── 1. Reference bounds and enum members ────────────────────────────────────

/** Stock_Quantity_Maximum (Req 1.5, 2.2) — re-declared, not imported. */
export const REFERENCE_STOCK_QUANTITY_MAXIMUM = 1_000_000;

/** Lowest stored stock level (Req 1.5). */
export const REFERENCE_STOCK_QUANTITY_MINIMUM = 0;

/** Lowest movement quantity — a movement of 0 is not a movement (Req 2.2). */
export const REFERENCE_MOVEMENT_QUANTITY_MINIMUM = 1;

/** `clinic_movement_source` members that only ever appear on `IN` entries. */
export const IN_MOVEMENT_SOURCES = [
  "WAREHOUSE_STOCK_IN",
  "MIGRATION",
] as const satisfies readonly ClinicMovementSource[];

/** `clinic_movement_source` members that only ever appear on `OUT` entries. */
export const OUT_MOVEMENT_SOURCES = [
  "CUSTOMER_APP_SALE",
  "ASSISTED_SALE",
  "WALKIN_SALE",
] as const satisfies readonly ClinicMovementSource[];

/** The three selling channels of Requirement 11.3, as their Movement_Sources. */
export type SaleChannel = (typeof OUT_MOVEMENT_SOURCES)[number];

/** The `Stock_In_Reason_Prefix` written into `inventory_transactions.reason`. */
export const REFERENCE_STOCK_IN_REASON_PREFIX = "shop-clinic:";

// ─── 2. Deterministic fixture identifiers ────────────────────────────────────

/**
 * Deterministic, well-formed v4-shaped UUIDs, so fixtures satisfy the
 * `z.string().uuid()` schemas in `src/validations/clinicShopInventory.ts` while
 * staying readable in a shrunk counterexample.
 */
export function fixtureUuid(group: number, index: number): string {
  const tail = `${group}`.padStart(4, "0") + `${index}`.padStart(8, "0");
  return `00000000-0000-4000-8000-${tail}`;
}

/** Core Clinics — `clinics.franchise_id IS NULL`, ordered oldest-first. */
export const CORE_CLINIC_IDS = [
  fixtureUuid(11, 1),
  fixtureUuid(11, 2),
  fixtureUuid(11, 3),
] as const;

/** A Clinic whose `franchise_id` is set — never a valid overlay target (Req 1.9). */
export const FRANCHISE_CLINIC_ID = fixtureUuid(11, 9);

/** Active Franchises — valid Destination_Selector values, never stock-in targets. */
export const FRANCHISE_IDS = [fixtureUuid(22, 1), fixtureUuid(22, 2)] as const;

/** Shop Products (`public.products`). */
export const PRODUCT_IDS = [
  fixtureUuid(33, 1),
  fixtureUuid(33, 2),
  fixtureUuid(33, 3),
  fixtureUuid(33, 4),
] as const;

/** Master Catalog Products (`public.inventory_products`). */
export const INVENTORY_PRODUCT_IDS = [
  fixtureUuid(44, 1),
  fixtureUuid(44, 2),
] as const;

/** Acting admins recorded on a ledger entry. */
export const ACTOR_USER_IDS = [fixtureUuid(55, 1), fixtureUuid(55, 2)] as const;

/** Shop_Orders (`public.addon_orders`). */
export const ADDON_ORDER_IDS = [
  fixtureUuid(66, 1),
  fixtureUuid(66, 2),
  fixtureUuid(66, 3),
] as const;

/** A uuid that exists in no fixture set — the "reference not found" case. */
export const UNKNOWN_UUID = fixtureUuid(99, 99);

export const arbCoreClinicId: fc.Arbitrary<string> = fc.constantFrom(
  ...CORE_CLINIC_IDS,
);

export const arbProductId: fc.Arbitrary<string> = fc.constantFrom(
  ...PRODUCT_IDS,
);

export const arbInventoryProductId: fc.Arbitrary<string> = fc.constantFrom(
  ...INVENTORY_PRODUCT_IDS,
);

export const arbActorUserId: fc.Arbitrary<string> = fc.constantFrom(
  ...ACTOR_USER_IDS,
);

export const arbAddonOrderId: fc.Arbitrary<string> = fc.constantFrom(
  ...ADDON_ORDER_IDS,
);

// ─── 3. Quantities ───────────────────────────────────────────────────────────

/**
 * A valid stored stock level: a whole number in [0, 1,000,000], biased towards
 * the four values every bound check turns on — 0 (empty clinic), 1, 999,999
 * (one unit below the cap) and 1,000,000 (exactly at the cap). (Req 1.5)
 */
export const arbStockQuantity: fc.Arbitrary<number> = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      REFERENCE_STOCK_QUANTITY_MINIMUM,
      1,
      REFERENCE_STOCK_QUANTITY_MAXIMUM - 1,
      REFERENCE_STOCK_QUANTITY_MAXIMUM,
    ),
    weight: 4,
  },
  { arbitrary: fc.integer({ min: 0, max: 1_000 }), weight: 3 },
  {
    arbitrary: fc.integer({
      min: REFERENCE_STOCK_QUANTITY_MINIMUM,
      max: REFERENCE_STOCK_QUANTITY_MAXIMUM,
    }),
    weight: 2,
  },
);

/**
 * A valid movement quantity: a whole number in [1, 1,000,000], biased towards
 * the minimum, the cap, and one below the cap. (Req 2.2, 7.13, 10.7)
 */
export const arbMovementQuantity: fc.Arbitrary<number> = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      REFERENCE_MOVEMENT_QUANTITY_MINIMUM,
      2,
      REFERENCE_STOCK_QUANTITY_MAXIMUM - 1,
      REFERENCE_STOCK_QUANTITY_MAXIMUM,
    ),
    weight: 4,
  },
  { arbitrary: fc.integer({ min: 1, max: 500 }), weight: 4 },
  {
    arbitrary: fc.integer({
      min: REFERENCE_MOVEMENT_QUANTITY_MINIMUM,
      max: REFERENCE_STOCK_QUANTITY_MAXIMUM,
    }),
    weight: 2,
  },
);

/**
 * Any value a form, an action payload, or a JSON body could carry where a
 * movement quantity is expected — valid whole numbers alongside every rejection
 * shape the requirements name: 0 and negatives (below the minimum), values above
 * the cap, non-integral numbers, `NaN` / `Infinity`, numeric strings, `null` and
 * `undefined`. Used by Property 15, which asserts acceptance is *exactly*
 * "integer in [1, 1,000,000]". (Req 1.7, 1.8, 2.3, 7.13, 10.7)
 */
export const arbSubmittedQuantity: fc.Arbitrary<unknown> = fc.oneof(
  { arbitrary: arbMovementQuantity as fc.Arbitrary<unknown>, weight: 5 },
  {
    arbitrary: fc.constantFrom<unknown>(
      0,
      -1,
      -1_000,
      REFERENCE_STOCK_QUANTITY_MAXIMUM + 1,
      2_000_000,
      0.5,
      1.5,
      REFERENCE_STOCK_QUANTITY_MAXIMUM + 0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      "5",
      "",
      null,
      undefined,
      true,
    ),
    weight: 4,
  },
  {
    arbitrary: fc
      .double({ min: -10, max: 10, noNaN: true })
      .filter((value) => !Number.isInteger(value)) as fc.Arbitrary<unknown>,
    weight: 2,
  },
);

// ─── 4. Overlay rows and their absence ───────────────────────────────────────

/** A fixed anchor so generated timestamps never touch a clock. */
export const ANCHOR_TIMESTAMP_MS = Date.UTC(2025, 0, 15, 6, 0, 0);

/** An ISO-8601 UTC timestamp at `offsetSeconds` from the anchor. */
export function fixtureTimestamp(offsetSeconds: number): string {
  return new Date(ANCHOR_TIMESTAMP_MS + offsetSeconds * 1_000).toISOString();
}

/**
 * One `clinic_product_settings` row for a given (clinic, product) pair. Stock is
 * drawn from {@link arbStockQuantity} and visibility from both values, so a
 * visible-but-empty row (the "shown yet not exposed" case of Requirement 6.3)
 * and a hidden-but-stocked row both occur.
 */
export function arbOverlayRowFor(
  clinicId: string,
  productId: string,
): fc.Arbitrary<ClinicProductOverlayRow> {
  return fc
    .tuple(arbStockQuantity, fc.boolean(), fc.integer({ min: 0, max: 10_000 }))
    .map(([stockQuantity, isVisible, ageSeconds]) => ({
      id: fixtureUuid(77, ageSeconds),
      clinic_id: clinicId,
      product_id: productId,
      stock_quantity: stockQuantity,
      is_visible: isVisible,
      created_at: fixtureTimestamp(-ageSeconds),
      updated_at: fixtureTimestamp(0),
    }));
}

/** A `clinic_product_settings` row over any Core Clinic and any Shop Product. */
export const arbOverlayRow: fc.Arbitrary<ClinicProductOverlayRow> = fc
  .tuple(arbCoreClinicId, arbProductId)
  .chain(([clinicId, productId]) => arbOverlayRowFor(clinicId, productId));

/**
 * The absence of an overlay row, in every encoding a caller legitimately holds:
 * a repository that found nothing returns `null`, a `Map.get` miss yields
 * `undefined`. Both must read as stock 0 and hidden. (Req 1.13, 5.6, 9.5, 19.5)
 */
export const arbMissingOverlay: fc.Arbitrary<null | undefined> =
  fc.constantFrom<null | undefined>(null, undefined);

/**
 * An overlay *slot*: either a real row or its absence. This is the honest shape
 * of a per-clinic lookup, and it is what makes the aggregate-stock and exposure
 * properties cover clinics that hold no record at all. (Req 3.10, 5.3, 12)
 */
export const arbOverlaySlot: fc.Arbitrary<
  ClinicProductOverlayRow | null | undefined
> = fc.oneof(
  { arbitrary: arbOverlayRow, weight: 4 },
  { arbitrary: arbMissingOverlay, weight: 2 },
);

/**
 * One overlay slot per Core Clinic for a single Shop Product — the input shape
 * of Aggregate_Stock. The array length matches the clinic set, not the record
 * set, so "clinic with no record contributes 0" is exercised. (Req 3.10, 5.3)
 */
export function arbOverlaySlotsPerClinic(
  clinicIds: readonly string[] = CORE_CLINIC_IDS,
): fc.Arbitrary<Array<ClinicProductOverlayRow | null | undefined>> {
  return fc.tuple(
    ...clinicIds.map((clinicId) =>
      fc.oneof(
        { arbitrary: arbOverlayRowFor(clinicId, PRODUCT_IDS[0]), weight: 4 },
        { arbitrary: arbMissingOverlay, weight: 2 },
      ),
    ),
  ) as fc.Arbitrary<Array<ClinicProductOverlayRow | null | undefined>>;
}

// ─── 5. Warehouse lot sets ───────────────────────────────────────────────────

/** A lot available for FIFO depletion, in the shape `planFifoDepletion` reads. */
export interface LotSample {
  id: string;
  quantityRemaining: number;
}

/**
 * A warehouse lot set, **already ordered oldest-first** — the contract
 * `planFifoDepletion` and the RPCs both assume. The shapes are chosen so FIFO
 * behaviour is pinned from every angle: the empty set (nothing to deplete), a
 * single lot (no spanning), many small lots (a plan with many steps), one large
 * lot plus stragglers, and a set containing exhausted (0-remaining) lots that
 * must be skipped rather than counted. (Req 7.8, 7.16)
 */
export const arbLotSet: fc.Arbitrary<LotSample[]> = fc.oneof(
  // Empty: available is 0, every stock-in must be rejected.
  { arbitrary: fc.constant<LotSample[]>([]), weight: 2 },
  // Single lot.
  {
    arbitrary: fc
      .integer({ min: 1, max: 5_000 })
      .map((quantityRemaining) => [{ id: "lot-0", quantityRemaining }]),
    weight: 3,
  },
  // Many small lots — a depletion plan that spans several steps.
  {
    arbitrary: fc
      .array(fc.integer({ min: 1, max: 25 }), { minLength: 2, maxLength: 12 })
      .map((quantities) =>
        quantities.map((quantityRemaining, index) => ({
          id: `lot-${index}`,
          quantityRemaining,
        })),
      ),
    weight: 4,
  },
  // Mixed sizes with exhausted lots interleaved — the skip case.
  {
    arbitrary: fc
      .array(fc.integer({ min: 0, max: 400 }), { minLength: 1, maxLength: 8 })
      .map((quantities) =>
        quantities.map((quantityRemaining, index) => ({
          id: `lot-${index}`,
          quantityRemaining,
        })),
      ),
    weight: 3,
  },
);

/** Total base units a lot set can supply — the reference `available` figure. */
export function lotSetTotal(lots: readonly LotSample[]): number {
  return lots.reduce(
    (sum, lot) => sum + (lot.quantityRemaining > 0 ? lot.quantityRemaining : 0),
    0,
  );
}

// ─── 6. Movement sequences ───────────────────────────────────────────────────

/**
 * One command in a movement sequence, mirroring the three overlay-touching RPCs.
 * `stock-in` and `sale` may be rejected by the model; `set-visibility` never
 * changes stock, which is what makes it useful in a parity sequence.
 */
export type MovementCommand =
  | {
      kind: "stock-in";
      clinicId: string;
      productId: string;
      quantity: number;
      actorUserId: string;
    }
  | {
      kind: "sale";
      clinicId: string;
      productId: string;
      quantity: number;
      actorUserId: string;
      channel: SaleChannel;
      addonOrderId: string;
    }
  | {
      kind: "set-visibility";
      clinicId: string;
      productId: string;
      isVisible: boolean;
    };

/** The three selling channels, evenly weighted (Req 10.2–10.5, 11.3). */
export const arbSaleChannel: fc.Arbitrary<SaleChannel> = fc.constantFrom(
  ...OUT_MOVEMENT_SOURCES,
);

export interface MovementSequenceOptions {
  clinicIds?: readonly string[];
  productIds?: readonly string[];
  minLength?: number;
  maxLength?: number;
  /** Upper bound on a single movement quantity; small values keep sequences interesting. */
  maxQuantity?: number;
}

function arbMovementCommand(
  options: MovementSequenceOptions,
): fc.Arbitrary<MovementCommand> {
  const {
    clinicIds = [CORE_CLINIC_IDS[0]],
    productIds = [PRODUCT_IDS[0], PRODUCT_IDS[1]],
    maxQuantity = 50,
  } = options;

  const clinic = fc.constantFrom(...clinicIds);
  const product = fc.constantFrom(...productIds);
  // Quantities stay small relative to the cap on purpose: a sequence of large
  // movements would be rejected on the first cap breach and stop exploring.
  const quantity = fc.oneof(
    { arbitrary: fc.integer({ min: 1, max: maxQuantity }), weight: 6 },
    { arbitrary: fc.constantFrom(1, maxQuantity), weight: 2 },
  );

  return fc.oneof(
    {
      arbitrary: fc
        .tuple(clinic, product, quantity, arbActorUserId)
        .map(
          ([clinicId, productId, qty, actorUserId]): MovementCommand => ({
            kind: "stock-in",
            clinicId,
            productId,
            quantity: qty,
            actorUserId,
          }),
        ),
      weight: 4,
    },
    {
      arbitrary: fc
        .tuple(clinic, product, quantity, arbActorUserId, arbSaleChannel, arbAddonOrderId)
        .map(
          ([
            clinicId,
            productId,
            qty,
            actorUserId,
            channel,
            addonOrderId,
          ]): MovementCommand => ({
            kind: "sale",
            clinicId,
            productId,
            quantity: qty,
            actorUserId,
            channel,
            addonOrderId,
          }),
        ),
      weight: 4,
    },
    {
      arbitrary: fc
        .tuple(clinic, product, fc.boolean())
        .map(
          ([clinicId, productId, isVisible]): MovementCommand => ({
            kind: "set-visibility",
            clinicId,
            productId,
            isVisible,
          }),
        ),
      weight: 1,
    },
  );
}

/**
 * An arbitrary interleaving of stock-ins, sales, and visibility changes against
 * a small clinic × product grid. Sales that exceed the clinic's current stock
 * are *expected* and are rejected by the model, which is exactly what the
 * non-negative-stock and parity properties need to observe. (Properties 1, 2, 3, 16)
 *
 * The empty sequence is in range: a clinic that has seen no movement must still
 * satisfy every invariant.
 */
export function arbMovementSequence(
  options: MovementSequenceOptions = {},
): fc.Arbitrary<MovementCommand[]> {
  const { minLength = 0, maxLength = 14 } = options;
  return fc.array(arbMovementCommand(options), { minLength, maxLength });
}

// ─── 7. Ledger entry sets ────────────────────────────────────────────────────

/**
 * A ledger entry set for one clinic, honouring the two schema CHECKs the design
 * encodes: `IN` carries only `WAREHOUSE_STOCK_IN` / `MIGRATION`, `OUT` only the
 * three sale sources, and exactly the reference matching the source is set —
 * `inventory_transaction_id` for a stock-in, `addon_order_id` for a sale, and
 * neither for a migration. (Req 2.8, 2.10, 2.11, 2.12)
 *
 * Identifiers ascend with insertion order (mirroring `BIGINT IDENTITY`) while
 * timestamps are drawn from a *small* offset pool so duplicate `occurred_at`
 * values are common — that is what forces the identifier tie-break in the
 * ledger ordering property to matter. (Req 9.7)
 */
export function arbLedgerEntrySet(
  options: {
    clinicId?: string;
    productIds?: readonly string[];
    minLength?: number;
    maxLength?: number;
  } = {},
): fc.Arbitrary<ClinicLedgerEntry[]> {
  const {
    clinicId = CORE_CLINIC_IDS[0],
    productIds = PRODUCT_IDS,
    minLength = 0,
    maxLength = 12,
  } = options;

  const entrySeed = fc.record({
    productIndex: fc.integer({ min: 0, max: productIds.length - 1 }),
    direction: fc.constantFrom<ClinicLedgerDirection>("IN", "OUT"),
    quantity: fc.integer({ min: 1, max: 500 }),
    inSource: fc.constantFrom(...IN_MOVEMENT_SOURCES),
    outSource: arbSaleChannel,
    actorUserId: arbActorUserId,
    addonOrderId: arbAddonOrderId,
    // Deliberately few distinct values so ties are frequent.
    timestampSlot: fc.integer({ min: 0, max: 3 }),
  });

  return fc
    .array(entrySeed, { minLength, maxLength })
    .map((seeds) =>
      seeds.map((seed, index): ClinicLedgerEntry => {
        const productId = productIds[seed.productIndex];
        const source: ClinicMovementSource =
          seed.direction === "IN" ? seed.inSource : seed.outSource;
        const isWarehouseStockIn = source === "WAREHOUSE_STOCK_IN";
        const isSale = seed.direction === "OUT";
        return {
          id: String(index + 1),
          clinic_id: clinicId,
          product_id: productId,
          product_name: `Product ${seed.productIndex + 1}`,
          direction: seed.direction,
          quantity: seed.quantity,
          movement_source: source,
          actor_user_id: seed.actorUserId,
          actor_name: null,
          addon_order_id: isSale ? seed.addonOrderId : null,
          inventory_transaction_id: isWarehouseStockIn
            ? fixtureUuid(88, index + 1)
            : null,
          occurred_at: fixtureTimestamp(seed.timestampSlot * 60),
        };
      }),
    );
}

// ─── 8. Destination Selector parameters ──────────────────────────────────────

/** The destinations that exist, as `resolveDestination` receives them. */
export interface KnownDestinationsSample {
  clinicIds: readonly string[];
  franchiseIds: readonly string[];
  loadFailed?: boolean;
}

/**
 * Destination sets covering the shapes the requirements single out: the normal
 * case, no destinations at all (Req 5.10), clinics-only, franchises-only, and a
 * failed option-list load (Req 5.12).
 */
export const arbKnownDestinations: fc.Arbitrary<KnownDestinationsSample> =
  fc.oneof(
    {
      arbitrary: fc.constant({
        clinicIds: [...CORE_CLINIC_IDS],
        franchiseIds: [...FRANCHISE_IDS],
      }),
      weight: 5,
    },
    {
      arbitrary: fc.constant({ clinicIds: [], franchiseIds: [] }),
      weight: 2,
    },
    {
      arbitrary: fc.constant({
        clinicIds: [...CORE_CLINIC_IDS],
        franchiseIds: [],
      }),
      weight: 2,
    },
    {
      arbitrary: fc.constant({
        clinicIds: [],
        franchiseIds: [...FRANCHISE_IDS],
      }),
      weight: 1,
    },
    {
      arbitrary: fc.constant({
        clinicIds: [...CORE_CLINIC_IDS],
        franchiseIds: [...FRANCHISE_IDS],
        loadFailed: true,
      }),
      weight: 1,
    },
  );

/**
 * A raw `?destination=` search-param value. Covers, in roughly equal measure,
 * the values that resolve to a real destination and the values that must fall
 * back to All Clinics with a notice:
 *
 * - absent (`undefined`), empty, whitespace, `all`, `ALL` — All Clinics (Req 5.2)
 * - `clinic:<uuid>` / `franchise:<uuid>` naming a fixture destination
 * - a bare fixture uuid
 * - `clinic:<unknown uuid>` and a bare unknown uuid — unavailable (Req 5.11)
 * - a franchise id behind the `clinic:` prefix, and vice versa — mismatched
 * - malformed: prefix with no id, id with no prefix separator, junk text,
 *   a doubled separator, a non-uuid id, and a clinic whose `franchise_id` is set
 */
export const arbDestinationParam: fc.Arbitrary<string | undefined> = fc.oneof(
  {
    arbitrary: fc.constantFrom<string | undefined>(
      undefined,
      "",
      "   ",
      "all",
      "ALL",
      "All",
    ),
    weight: 4,
  },
  {
    arbitrary: fc
      .constantFrom(...CORE_CLINIC_IDS)
      .map((id) => `clinic:${id}`) as fc.Arbitrary<string | undefined>,
    weight: 4,
  },
  {
    arbitrary: fc
      .constantFrom(...FRANCHISE_IDS)
      .map((id) => `franchise:${id}`) as fc.Arbitrary<string | undefined>,
    weight: 3,
  },
  {
    arbitrary: fc.constantFrom<string | undefined>(
      ...CORE_CLINIC_IDS,
      ...FRANCHISE_IDS,
    ),
    weight: 2,
  },
  {
    arbitrary: fc.constantFrom<string | undefined>(
      `clinic:${UNKNOWN_UUID}`,
      `franchise:${UNKNOWN_UUID}`,
      UNKNOWN_UUID,
      `clinic:${FRANCHISE_CLINIC_ID}`,
      `clinic:${FRANCHISE_IDS[0]}`,
      `franchise:${CORE_CLINIC_IDS[0]}`,
    ),
    weight: 3,
  },
  {
    arbitrary: fc.constantFrom<string | undefined>(
      "clinic:",
      "franchise:",
      "clinic",
      ":",
      "::",
      "clinic::",
      "clinic:not-a-uuid",
      "CLINIC:" + CORE_CLINIC_IDS[0],
      "unknown:" + CORE_CLINIC_IDS[0],
      "all:all",
      "%%%",
    ),
    weight: 3,
  },
  { arbitrary: fc.string({ maxLength: 12 }) as fc.Arbitrary<string | undefined>, weight: 1 },
);

// ─── 9. Admin scopes ─────────────────────────────────────────────────────────

/**
 * A caller of a clinic-scoped read or a Stock In. `anonymous` is the
 * no-session case Requirement 16.4 names; `clinicId` non-null on an `operations`
 * admin is a Clinic_Scoped_Admin.
 */
export type AdminScopeSample =
  | { kind: "anonymous" }
  | {
      kind: "admin";
      level: AdminAccessLevel;
      groups: OperationsAccess;
      /** Clinic_Scope_Assignment — `users.admin_clinic_id`. */
      clinicId: string | null;
    };

const arbGroups = (
  keys: readonly OperationsGroup[],
): fc.Arbitrary<OperationsAccess> =>
  fc
    .subarray([...keys], { minLength: 1 })
    .chain((selected) =>
      fc
        .array(fc.constantFrom<PermissionLevel>("manage", "view"), {
          minLength: selected.length,
          maxLength: selected.length,
        })
        .map((levels) => {
          const groups: OperationsAccess = {};
          selected.forEach((group, index) => {
            groups[group] = levels[index];
          });
          return groups;
        }),
    );

/**
 * The four caller kinds Properties 17 and 18 quantify over: no session, an
 * `operations` admin with no scope (Unscoped_Operations_Admin), an `operations`
 * admin with a scope (Clinic_Scoped_Admin), and a warehouse admin
 * (`inventory` / `inventory_operations`). A `dietitian` level is included so
 * the "everything else is rejected" branch is not left to a single value.
 */
export const arbAdminScope: fc.Arbitrary<AdminScopeSample> = fc.oneof(
  { arbitrary: fc.constant<AdminScopeSample>({ kind: "anonymous" }), weight: 1 },
  {
    arbitrary: arbGroups(CLINIC_SCOPED_GROUPS).map(
      (groups): AdminScopeSample => ({
        kind: "admin",
        level: "operations",
        groups,
        clinicId: null,
      }),
    ),
    weight: 3,
  },
  {
    arbitrary: fc
      .tuple(arbGroups(CLINIC_SCOPED_GROUPS), arbCoreClinicId)
      .map(
        ([groups, clinicId]): AdminScopeSample => ({
          kind: "admin",
          level: "operations",
          groups,
          clinicId,
        }),
      ),
    weight: 3,
  },
  {
    arbitrary: fc
      .constantFrom<AdminAccessLevel>("inventory", "inventory_operations")
      .map(
        (level): AdminScopeSample => ({
          kind: "admin",
          level,
          groups: {},
          clinicId: null,
        }),
      ),
    weight: 3,
  },
  {
    arbitrary: fc.constant<AdminScopeSample>({
      kind: "admin",
      level: "dietitian",
      groups: {},
      clinicId: null,
    }),
    weight: 1,
  },
);

/** Whether a sampled scope is a Clinic_Scoped_Admin (Req 13 glossary). */
export function isClinicScopedSample(scope: AdminScopeSample): boolean {
  return (
    scope.kind === "admin" &&
    scope.level === "operations" &&
    scope.clinicId !== null
  );
}

/** Whether a sampled scope holds warehouse inventory access (Req 16.1, 16.2). */
export function isWarehouseAdminSample(scope: AdminScopeSample): boolean {
  return (
    scope.kind === "admin" &&
    (scope.level === "inventory" || scope.level === "inventory_operations")
  );
}

// ─── 10. Rejection causes ────────────────────────────────────────────────────

/**
 * Why a stock-in submission must be rejected in full. Property 5 generates the
 * cause and the offending line index rather than splitting into one test per
 * cause, so a single property covers every all-or-nothing path:
 *
 * - `WAREHOUSE_SHORTFALL` — the line exceeds available warehouse stock (Req 7.12)
 * - `EXCEEDS_MAXIMUM`     — the result would pass 1,000,000 (Req 7.14)
 * - `INVALID_QUANTITY`    — non-integral or out of [1, 1,000,000] (Req 7.13)
 * - `UNLINKED_PRODUCT`    — no Product_Link (Req 7.15)
 * - `FRANCHISE_DESTINATION` — a Franchise named as the destination (Req 19.4)
 * - `INJECTED_WRITE_FAILURE` — a mid-transaction failure (Req 7.10)
 */
export const REJECTION_CAUSES = [
  "WAREHOUSE_SHORTFALL",
  "EXCEEDS_MAXIMUM",
  "INVALID_QUANTITY",
  "UNLINKED_PRODUCT",
  "FRANCHISE_DESTINATION",
  "INJECTED_WRITE_FAILURE",
] as const;

export type RejectionCause = (typeof REJECTION_CAUSES)[number];

export const arbRejectionCause: fc.Arbitrary<RejectionCause> = fc.constantFrom(
  ...REJECTION_CAUSES,
);

/**
 * A rejection cause together with the index of the line that carries it. The
 * index is generated modulo the submission length by the consuming test, so it
 * is safe to draw before the lines are known.
 */
export const arbRejectionInjection: fc.Arbitrary<{
  cause: RejectionCause;
  lineIndex: number;
}> = fc.record({
  cause: arbRejectionCause,
  lineIndex: fc.nat({ max: 7 }),
});
