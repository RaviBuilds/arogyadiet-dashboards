// src/test/shop/clinicStockModel.ts
// Feature: clinic-scoped-shop-inventory — TypeScript model of the RPC semantics
// (Task 2.4).
//
// WHY THIS EXISTS
// Properties 1, 2, 4, 5, 16, 20, 24 and 25 are about *transactional* behaviour:
// stock never goes negative across an arbitrary movement sequence, stored stock
// always equals ledger IN − OUT, a rejected submission changes nothing, a second
// migration run changes nothing. Running 100–500 iterations of those against a
// real Postgres would be slow and flaky, so they run against this model instead
// — the model-based testing pattern the design calls for. Task 4.14 pins the
// model to the real RPCs with a small set of integration tests; those, not this
// file, are the authority on the SQL.
//
// WHAT IT MODELS
// Exactly the five mutating routines the design specifies, and nothing else:
//
//   clinic_shop_stock_in(p_clinic_id, p_lines, p_actor_user_id)
//   clinic_shop_apply_sale(p_clinic_id, p_addon_order_id, p_lines,
//                          p_movement_source, p_actor_user_id)
//   set_clinic_product_visibility(p_clinic_id, p_product_id, p_is_visible)
//   franchise_shop_stock_in(p_franchise_id, p_product_id, p_quantity,
//                           p_actor_user_id)
//   migrate_shop_stock_to_clinics()
//
// plus the read helpers a property needs to state its invariant
// (`effectiveOverlay`, `aggregateStock`, `warehouseAvailable`,
// `verifyLedgerParity`, the latter modelling
// `verify_clinic_stock_ledger_parity()`).
//
// HOW IT MODELS IT
//   * Every operation is all-or-nothing. It computes against a private draft of
//     the world and commits only on success, so a rejected or failed operation
//     leaves the passed-in world byte-for-byte unchanged — the model's stand-in
//     for the implicit single transaction each RPC relies on (Req 7.10, 10.9).
//   * The *decision* is delegated to `src/lib/shop/clinicStock.ts`, which is the
//     module the RPCs mirror. The model owns only the state transitions: lot
//     depletion, warehouse transaction rows, overlay upserts, ledger inserts.
//     Duplicating the decision rules here would test the duplicate, not the code.
//   * Errors carry the design's stable `RAISE EXCEPTION` prefixes, so an action
//     layer message-mapping test can use the same values.
//   * Time is a logical counter, never a clock, so a counterexample replays
//     exactly and `occurred_at` ties are reproducible.
//   * Operations are serial by construction. Requirement 7.11 / 10.10 / 18.5
//     concurrency is therefore modelled as "some serialisation of the submitted
//     movements", which is precisely what `SELECT ... FOR UPDATE` guarantees and
//     what Property 16 asserts.
//
// _Requirements: 2.7, 7.6, 7.10, 11.2_

import {
  STOCK_QUANTITY_MAXIMUM,
  evaluateSaleSubmission,
  evaluateStockInSubmission,
  planFifoDepletion,
  resolveEffectiveOverlay,
  validateMovementQuantity,
  type SaleProductContext,
  type StockInProductContext,
} from "@/lib/shop/clinicStock";
import type {
  ClinicLedgerDirection,
  ClinicMovementSource,
} from "@/types/clinicShop";

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * The stable exception prefixes the design's message-mapping table defines. The
 * franchise twin deliberately reuses the clinic prefixes for the cap and
 * unlinked-product cases, exactly as that table does (Req 18.8, 18.9), and for
 * the warehouse shortfall, whose required wording is identical (Req 18.6).
 */
export const MODEL_ERROR_PREFIXES = [
  "CLINIC_STOCK_INSUFFICIENT_WAREHOUSE:",
  "CLINIC_STOCK_EXCEEDS_MAXIMUM:",
  "CLINIC_STOCK_UNLINKED_PRODUCT:",
  "CLINIC_STOCK_INSUFFICIENT_CLINIC:",
  "CLINIC_STOCK_INVALID_QUANTITY:",
  "CLINIC_STOCK_INVALID_SUBMISSION:",
  "CLINIC_STOCK_FRANCHISE_DESTINATION:",
  "CLINIC_STOCK_WRITE_FAILED:",
  "CLINIC_NOT_CORE:",
  "CLINIC_REFERENCE_NOT_FOUND:",
] as const;

export type ModelErrorPrefix = (typeof MODEL_ERROR_PREFIXES)[number];

/** One product named in a rejection, with the quantity that was available. */
export interface ModelErrorProduct {
  productId: string;
  requested?: number;
  available?: number;
}

export interface ModelError {
  prefix: ModelErrorPrefix;
  message: string;
  /** Every offending product, so a caller can build the per-product wording. */
  products: ModelErrorProduct[];
}

export type ModelResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ModelError };

function fail(
  prefix: ModelErrorPrefix,
  message: string,
  products: ModelErrorProduct[] = [],
): { ok: false; error: ModelError } {
  return { ok: false, error: { prefix, message, products } };
}

// ─── World records ───────────────────────────────────────────────────────────

export interface ClinicRecord {
  id: string;
  /** `clinics.franchise_id` — `null` marks a Core Clinic (Req 1.9). */
  franchiseId: string | null;
  /** Ordering key for Migration_Target_Clinic resolution (Req 20, step 3). */
  createdAtTick: number;
}

export interface ProductRecord {
  id: string;
  /** Product_Link — `null` for an Unlinked_Shop_Product (Req 3.1). */
  inventoryProductId: string | null;
  /** Global_Visibility (`products.is_active`). */
  isActive: boolean;
  /** Non-null marks a soft-deleted Shop Product (Req 1.14, 20.12). */
  deletedAt: string | null;
  /**
   * `products.stock_quantity` — the frozen pre-migration value. May be `null`,
   * negative, or non-integral, which is what Requirements 20.4–20.6 turn on.
   */
  legacyStockQuantity: number | null;
}

export interface OverlayRecord {
  clinicId: string;
  productId: string;
  stockQuantity: number;
  isVisible: boolean;
}

export interface LotRecord {
  id: string;
  quantityRemaining: number;
}

export interface ModelLedgerEntry {
  /** `BIGINT GENERATED ALWAYS AS IDENTITY` — monotonic, the ordering tie-break. */
  id: number;
  clinicId: string;
  productId: string;
  direction: ClinicLedgerDirection;
  /** Always positive; `direction` carries the sign (Req 2.2). */
  quantity: number;
  movementSource: ClinicMovementSource;
  actorUserId: string;
  addonOrderId: string | null;
  inventoryTransactionId: string | null;
  /** Logical tick, mirroring `occurred_at`. */
  occurredAtTick: number;
}

export interface ModelInventoryTransaction {
  id: string;
  inventoryProductId: string;
  lotId: string;
  transactionType: "OUT";
  /** Negative for an OUT entry, matching `inventoryEngine.dispatchInventoryStock`. */
  quantityChanged: number;
  /** `shop-clinic:<clinic_uuid>` for a Stock In (Req 7.9). */
  reason: string;
  occurredAtTick: number;
}

export interface ModelFranchiseLedgerEntry {
  id: number;
  franchiseId: string;
  productId: string;
  direction: ClinicLedgerDirection;
  quantity: number;
  /** `franchise_inventory_ledger.stock_out_reason`. */
  stockOutReason: string | null;
  occurredAtTick: number;
}

export interface FranchiseSettingRecord {
  franchiseId: string;
  productId: string;
  stockQuantity: number;
  isVisible: boolean;
}

/** The `Stock_In_Reason_Prefix` (Req 7.9). */
export const STOCK_IN_REASON_PREFIX = "shop-clinic:";

/** The franchise ledger reason a shop stock-in writes (Req 18.2). */
export const FRANCHISE_SHOP_STOCK_IN_REASON = "SHOP_STOCK_IN";

// ─── The world ───────────────────────────────────────────────────────────────

export interface World {
  clock: number;
  ledgerSequence: number;
  franchiseLedgerSequence: number;
  transactionSequence: number;
  clinics: Map<string, ClinicRecord>;
  products: Map<string, ProductRecord>;
  /** Keyed `${clinicId}|${productId}` — at most one record per pair (Req 1.3). */
  overlays: Map<string, OverlayRecord>;
  ledger: ModelLedgerEntry[];
  /** Keyed by Master Catalog Product id; lots are ordered oldest-first. */
  lots: Map<string, LotRecord[]>;
  transactions: ModelInventoryTransaction[];
  franchiseIds: Set<string>;
  /** Keyed `${franchiseId}|${productId}`. */
  franchiseSettings: Map<string, FranchiseSettingRecord>;
  /** Keyed `${franchiseId}|${inventoryProductId}`; lots ordered oldest-first. */
  franchiseLots: Map<string, LotRecord[]>;
  franchiseLedger: ModelFranchiseLedgerEntry[];
  /**
   * Declared reference universes. `null` means "not declared", in which case the
   * model skips that foreign-key check — a deliberate convenience so a property
   * about stock arithmetic need not enumerate order and user rows.
   */
  addonOrderIds: Set<string> | null;
  actorUserIds: Set<string> | null;
}

export interface WorldSpec {
  clinics: ReadonlyArray<{
    id: string;
    franchiseId?: string | null;
    createdAtTick?: number;
  }>;
  products: ReadonlyArray<{
    id: string;
    inventoryProductId?: string | null;
    isActive?: boolean;
    deletedAt?: string | null;
    legacyStockQuantity?: number | null;
  }>;
  overlays?: ReadonlyArray<{
    clinicId: string;
    productId: string;
    stockQuantity?: number;
    isVisible?: boolean;
  }>;
  /** Master Catalog Product id → lots, oldest-first. */
  lots?: Readonly<Record<string, ReadonlyArray<LotRecord>>>;
  franchiseIds?: readonly string[];
  franchiseSettings?: ReadonlyArray<{
    franchiseId: string;
    productId: string;
    stockQuantity?: number;
    isVisible?: boolean;
  }>;
  /** `${franchiseId}|${inventoryProductId}` → lots, oldest-first. */
  franchiseLots?: Readonly<Record<string, ReadonlyArray<LotRecord>>>;
  addonOrderIds?: readonly string[];
  actorUserIds?: readonly string[];
}

export function overlayKey(clinicId: string, productId: string): string {
  return `${clinicId}|${productId}`;
}

/**
 * Build a world. Clinics default to Core (`franchiseId: null`) and to a
 * `createdAtTick` equal to their position in the list, so the first clinic
 * listed is the Migration_Target_Clinic unless a spec says otherwise.
 */
export function createWorld(spec: WorldSpec): World {
  const clinics = new Map<string, ClinicRecord>();
  spec.clinics.forEach((clinic, index) => {
    clinics.set(clinic.id, {
      id: clinic.id,
      franchiseId: clinic.franchiseId ?? null,
      createdAtTick: clinic.createdAtTick ?? index,
    });
  });

  const products = new Map<string, ProductRecord>();
  for (const product of spec.products) {
    products.set(product.id, {
      id: product.id,
      inventoryProductId: product.inventoryProductId ?? null,
      isActive: product.isActive ?? true,
      deletedAt: product.deletedAt ?? null,
      legacyStockQuantity: product.legacyStockQuantity ?? null,
    });
  }

  const overlays = new Map<string, OverlayRecord>();
  for (const overlay of spec.overlays ?? []) {
    overlays.set(overlayKey(overlay.clinicId, overlay.productId), {
      clinicId: overlay.clinicId,
      productId: overlay.productId,
      stockQuantity: overlay.stockQuantity ?? 0,
      isVisible: overlay.isVisible ?? true,
    });
  }

  const lots = new Map<string, LotRecord[]>();
  for (const [inventoryProductId, lotList] of Object.entries(spec.lots ?? {})) {
    lots.set(
      inventoryProductId,
      lotList.map((lot) => ({ ...lot })),
    );
  }

  const franchiseSettings = new Map<string, FranchiseSettingRecord>();
  for (const setting of spec.franchiseSettings ?? []) {
    franchiseSettings.set(
      overlayKey(setting.franchiseId, setting.productId),
      {
        franchiseId: setting.franchiseId,
        productId: setting.productId,
        stockQuantity: setting.stockQuantity ?? 0,
        // Matches the existing `franchise_product_settings` default (Req 18.3).
        isVisible: setting.isVisible ?? false,
      },
    );
  }

  const franchiseLots = new Map<string, LotRecord[]>();
  for (const [key, lotList] of Object.entries(spec.franchiseLots ?? {})) {
    franchiseLots.set(
      key,
      lotList.map((lot) => ({ ...lot })),
    );
  }

  return {
    clock: 0,
    ledgerSequence: 0,
    franchiseLedgerSequence: 0,
    transactionSequence: 0,
    clinics,
    products,
    overlays,
    ledger: [],
    lots,
    transactions: [],
    franchiseIds: new Set(spec.franchiseIds ?? []),
    franchiseSettings,
    franchiseLots,
    franchiseLedger: [],
    addonOrderIds: spec.addonOrderIds ? new Set(spec.addonOrderIds) : null,
    actorUserIds: spec.actorUserIds ? new Set(spec.actorUserIds) : null,
  };
}

/** A structural copy — the unit of transactional isolation in this model. */
export function cloneWorld(world: World): World {
  const copyLots = (source: Map<string, LotRecord[]>) => {
    const target = new Map<string, LotRecord[]>();
    for (const [key, lotList] of source) {
      target.set(
        key,
        lotList.map((lot) => ({ ...lot })),
      );
    }
    return target;
  };

  return {
    clock: world.clock,
    ledgerSequence: world.ledgerSequence,
    franchiseLedgerSequence: world.franchiseLedgerSequence,
    transactionSequence: world.transactionSequence,
    clinics: new Map(
      [...world.clinics].map(([id, clinic]) => [id, { ...clinic }]),
    ),
    products: new Map(
      [...world.products].map(([id, product]) => [id, { ...product }]),
    ),
    overlays: new Map(
      [...world.overlays].map(([key, overlay]) => [key, { ...overlay }]),
    ),
    ledger: world.ledger.map((entry) => ({ ...entry })),
    lots: copyLots(world.lots),
    transactions: world.transactions.map((entry) => ({ ...entry })),
    franchiseIds: new Set(world.franchiseIds),
    franchiseSettings: new Map(
      [...world.franchiseSettings].map(([key, setting]) => [
        key,
        { ...setting },
      ]),
    ),
    franchiseLots: copyLots(world.franchiseLots),
    franchiseLedger: world.franchiseLedger.map((entry) => ({ ...entry })),
    addonOrderIds:
      world.addonOrderIds === null ? null : new Set(world.addonOrderIds),
    actorUserIds:
      world.actorUserIds === null ? null : new Set(world.actorUserIds),
  };
}

/** Commit a draft over the live world. Called only on a successful operation. */
function commit(world: World, draft: World): void {
  world.clock = draft.clock;
  world.ledgerSequence = draft.ledgerSequence;
  world.franchiseLedgerSequence = draft.franchiseLedgerSequence;
  world.transactionSequence = draft.transactionSequence;
  world.clinics = draft.clinics;
  world.products = draft.products;
  world.overlays = draft.overlays;
  world.ledger = draft.ledger;
  world.lots = draft.lots;
  world.transactions = draft.transactions;
  world.franchiseIds = draft.franchiseIds;
  world.franchiseSettings = draft.franchiseSettings;
  world.franchiseLots = draft.franchiseLots;
  world.franchiseLedger = draft.franchiseLedger;
  world.addonOrderIds = draft.addonOrderIds;
  world.actorUserIds = draft.actorUserIds;
}

// ─── Read helpers ────────────────────────────────────────────────────────────

/**
 * Effective_Clinic_Stock and Effective_Clinic_Visibility for one pair — a
 * missing overlay reads as stock 0 and hidden. Delegates to the shipped
 * resolver so the model and the application agree by construction.
 * (Req 1.13, 5.6, 9.5)
 */
export function effectiveOverlay(
  world: World,
  clinicId: string,
  productId: string,
): { stockQuantity: number; isVisible: boolean } {
  return resolveEffectiveOverlay(world.overlays.get(overlayKey(clinicId, productId)));
}

/** Every Core Clinic (`franchise_id IS NULL`), ordered oldest-first then by id. */
export function coreClinics(world: World): ClinicRecord[] {
  return [...world.clinics.values()]
    .filter((clinic) => clinic.franchiseId === null)
    .sort((a, b) =>
      a.createdAtTick === b.createdAtTick
        ? a.id.localeCompare(b.id)
        : a.createdAtTick - b.createdAtTick,
    );
}

/** Aggregate_Stock — the sum over every Core Clinic, records or not (Req 3.10). */
export function aggregateStock(world: World, productId: string): number {
  return coreClinics(world).reduce(
    (total, clinic) => total + effectiveOverlay(world, clinic.id, productId).stockQuantity,
    0,
  );
}

/** Base units of a Master Catalog Product available across its active lots. */
export function warehouseAvailable(
  world: World,
  inventoryProductId: string | null,
): number {
  if (inventoryProductId === null) return 0;
  return (world.lots.get(inventoryProductId) ?? []).reduce(
    (sum, lot) => sum + (lot.quantityRemaining > 0 ? lot.quantityRemaining : 0),
    0,
  );
}

/** Base units available in one Franchise's warehouse for a Master Catalog Product. */
export function franchiseWarehouseAvailable(
  world: World,
  franchiseId: string,
  inventoryProductId: string | null,
): number {
  if (inventoryProductId === null) return 0;
  return (world.franchiseLots.get(overlayKey(franchiseId, inventoryProductId)) ?? []).reduce(
    (sum, lot) => sum + (lot.quantityRemaining > 0 ? lot.quantityRemaining : 0),
    0,
  );
}

/**
 * Ledger entries for one clinic in the order the ledger view renders them:
 * `occurred_at DESC, id DESC` (Req 9.7).
 */
export function ledgerFor(
  world: World,
  clinicId: string,
  filter?: { direction?: ClinicLedgerDirection; productId?: string },
): ModelLedgerEntry[] {
  return world.ledger
    .filter(
      (entry) =>
        entry.clinicId === clinicId &&
        (filter?.direction === undefined || entry.direction === filter.direction) &&
        (filter?.productId === undefined || entry.productId === filter.productId),
    )
    .sort((a, b) =>
      a.occurredAtTick === b.occurredAtTick
        ? b.id - a.id
        : b.occurredAtTick - a.occurredAtTick,
    );
}

export interface ParityDivergence {
  clinicId: string;
  productId: string;
  stockQuantity: number;
  /** Ledger IN total minus ledger OUT total for the pair. */
  ledgerBalance: number;
}

/**
 * Models `verify_clinic_stock_ledger_parity()`: every (clinic, product) pair
 * whose stored `stock_quantity` diverges from ledger IN − OUT. A detector, not a
 * repair tool. An empty result is the parity invariant of Requirement 2.7.
 *
 * Pairs are considered from both directions — an overlay with no ledger history
 * and ledger history with no overlay row are both divergences worth surfacing.
 */
export function verifyLedgerParity(world: World): ParityDivergence[] {
  const balances = new Map<string, number>();
  const pairs = new Map<string, { clinicId: string; productId: string }>();

  for (const overlay of world.overlays.values()) {
    const key = overlayKey(overlay.clinicId, overlay.productId);
    pairs.set(key, { clinicId: overlay.clinicId, productId: overlay.productId });
    balances.set(key, balances.get(key) ?? 0);
  }
  for (const entry of world.ledger) {
    const key = overlayKey(entry.clinicId, entry.productId);
    pairs.set(key, { clinicId: entry.clinicId, productId: entry.productId });
    const signed = entry.direction === "IN" ? entry.quantity : -entry.quantity;
    balances.set(key, (balances.get(key) ?? 0) + signed);
  }

  const divergences: ParityDivergence[] = [];
  for (const [key, pair] of pairs) {
    const stored = world.overlays.get(key)?.stockQuantity ?? 0;
    const balance = balances.get(key) ?? 0;
    if (stored !== balance) {
      divergences.push({
        clinicId: pair.clinicId,
        productId: pair.productId,
        stockQuantity: stored,
        ledgerBalance: balance,
      });
    }
  }
  return divergences;
}

// ─── Shared internals ────────────────────────────────────────────────────────

/** Resolve a Core Clinic, or the reason it is not usable as an overlay target. */
function requireCoreClinic(
  world: World,
  clinicId: string,
): ModelResult<ClinicRecord> {
  if (world.franchiseIds.has(clinicId)) {
    return fail(
      "CLINIC_STOCK_FRANCHISE_DESTINATION:",
      "Franchise shop stock-in is performed from the franchise portal",
    );
  }
  const clinic = world.clinics.get(clinicId);
  if (clinic === undefined) {
    return fail("CLINIC_REFERENCE_NOT_FOUND:", `Clinic ${clinicId} was not found`);
  }
  if (clinic.franchiseId !== null) {
    return fail(
      "CLINIC_NOT_CORE:",
      "Clinic shop stock applies to Core Clinics only",
    );
  }
  return { ok: true, value: clinic };
}

/** Foreign-key check for every product a submission names. */
function requireProducts(
  world: World,
  productIds: readonly string[],
): ModelResult<ProductRecord[]> {
  const missing = productIds.filter((id) => !world.products.has(id));
  if (missing.length > 0) {
    return fail(
      "CLINIC_REFERENCE_NOT_FOUND:",
      `Shop product ${missing[0]} was not found`,
      missing.map((productId) => ({ productId })),
    );
  }
  return {
    ok: true,
    value: productIds.map((id) => world.products.get(id)!),
  };
}

function requireActor(world: World, actorUserId: string): ModelError | null {
  if (world.actorUserIds !== null && !world.actorUserIds.has(actorUserId)) {
    return {
      prefix: "CLINIC_REFERENCE_NOT_FOUND:",
      message: `Acting user ${actorUserId} was not found`,
      products: [],
    };
  }
  return null;
}

/** Upsert an overlay row on a draft, returning it. Creation defaults per spec. */
function upsertOverlay(
  draft: World,
  clinicId: string,
  productId: string,
  defaults: { stockQuantity: number; isVisible: boolean },
): { record: OverlayRecord; created: boolean } {
  const key = overlayKey(clinicId, productId);
  const existing = draft.overlays.get(key);
  if (existing !== undefined) return { record: existing, created: false };
  const record: OverlayRecord = {
    clinicId,
    productId,
    stockQuantity: defaults.stockQuantity,
    isVisible: defaults.isVisible,
  };
  draft.overlays.set(key, record);
  return { record, created: true };
}

function appendLedger(
  draft: World,
  entry: Omit<ModelLedgerEntry, "id" | "occurredAtTick">,
): ModelLedgerEntry {
  draft.ledgerSequence += 1;
  const record: ModelLedgerEntry = {
    ...entry,
    id: draft.ledgerSequence,
    occurredAtTick: draft.clock,
  };
  draft.ledger.push(record);
  return record;
}

// ─── clinic_shop_stock_in ────────────────────────────────────────────────────

export interface StockInLineInput {
  productId: string;
  quantity: number;
}

export interface StockInInput {
  clinicId: string;
  lines: readonly StockInLineInput[];
  actorUserId: string;
}

export interface StockInOptions {
  /**
   * Abort as the applier reaches this submission line, modelling a failed write
   * mid-transaction. The whole operation rolls back, so the stage of the failure
   * is not observable — which is the point of Requirement 7.10.
   */
  failAtLineIndex?: number;
}

export interface StockInAppliedLine {
  productId: string;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  /** One id per lot the line depleted, oldest-first (Req 7.8). */
  transactionIds: string[];
  ledgerEntryId: number;
  overlayCreated: boolean;
}

export interface StockInReport {
  clinicId: string;
  applied: StockInAppliedLine[];
  totalQuantity: number;
}

/**
 * `clinic_shop_stock_in(p_clinic_id, p_lines, p_actor_user_id)`.
 *
 * Validates **every** line before mutating anything, then for each accepted line
 * depletes warehouse lots oldest-first, writes one `OUT`
 * `inventory_transactions` row per depleted lot carrying
 * `shop-clinic:<clinic_uuid>`, raises the clinic overlay (creating it at stock 0
 * and visible when absent), and writes exactly one `IN` ledger entry referencing
 * the first of those transactions.
 *
 * Requirements 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.14, 7.15, 7.16, 2.5,
 * 2.8, 2.11, 3.6, 19.4.
 */
export function clinicShopStockIn(
  world: World,
  input: StockInInput,
  options: StockInOptions = {},
): ModelResult<StockInReport> {
  const clinic = requireCoreClinic(world, input.clinicId);
  if (!clinic.ok) return clinic;

  const actorError = requireActor(world, input.actorUserId);
  if (actorError !== null) return { ok: false, error: actorError };

  const lines = [...input.lines];
  const products = requireProducts(
    world,
    lines.map((line) => line.productId),
  );
  if (!products.ok) return products;

  // Build the decision context from the world, then let the shipped evaluator
  // decide. Availability is the real lot total, so the evaluator's per-link
  // pooling sees a consistent figure.
  const contexts: StockInProductContext[] = [];
  for (const line of lines) {
    const product = world.products.get(line.productId)!;
    contexts.push({
      productId: product.id,
      inventoryProductId: product.inventoryProductId,
      warehouseAvailable: warehouseAvailable(world, product.inventoryProductId),
      overlay: world.overlays.get(overlayKey(input.clinicId, product.id)),
    });
  }

  const verdict = evaluateStockInSubmission({
    destination: { kind: "clinic", clinicId: input.clinicId },
    lines,
    products: contexts,
  });

  if (!verdict.ok) {
    const products_ = verdict.rejections.map((rejection) => ({
      productId: rejection.productId,
      requested:
        typeof rejection.requested === "number" ? rejection.requested : undefined,
      available: rejection.available,
    }));
    switch (verdict.code) {
      case "INSUFFICIENT_WAREHOUSE":
        return fail(
          "CLINIC_STOCK_INSUFFICIENT_WAREHOUSE:",
          "Warehouse stock is insufficient for one or more products",
          products_,
        );
      case "EXCEEDS_MAXIMUM":
        return fail(
          "CLINIC_STOCK_EXCEEDS_MAXIMUM:",
          `The maximum stock quantity is ${STOCK_QUANTITY_MAXIMUM.toLocaleString("en-US")}`,
          products_,
        );
      case "UNLINKED_PRODUCT":
        return fail(
          "CLINIC_STOCK_UNLINKED_PRODUCT:",
          "The shop product must be linked to a Master Catalog Product before stock-in",
          products_,
        );
      case "INVALID_QUANTITY":
        return fail(
          "CLINIC_STOCK_INVALID_QUANTITY:",
          "Quantity must be a whole number between 1 and 1,000,000",
          products_,
        );
      case "INVALID_DESTINATION":
        return fail(
          "CLINIC_STOCK_FRANCHISE_DESTINATION:",
          "Franchise shop stock-in is performed from the franchise portal",
        );
      default:
        return fail(
          "CLINIC_STOCK_INVALID_SUBMISSION:",
          `The stock-in submission was rejected (${verdict.code})`,
          products_,
        );
    }
  }

  // Accepted — apply on a draft so a mid-flight failure rolls everything back.
  const draft = cloneWorld(world);
  draft.clock += 1;
  const applied: StockInAppliedLine[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (options.failAtLineIndex === index) {
      return fail(
        "CLINIC_STOCK_WRITE_FAILED:",
        "The stock-in submission failed",
        [{ productId: lines[index].productId }],
      );
    }

    const line = lines[index];
    const product = draft.products.get(line.productId)!;
    const inventoryProductId = product.inventoryProductId as string;
    const lotList = draft.lots.get(inventoryProductId) ?? [];

    const plan = planFifoDepletion(lotList, line.quantity);
    if (!plan.ok) {
      // Unreachable given the evaluator accepted the submission; kept so a future
      // change to either side surfaces as a rejection rather than silent drift.
      return fail(
        "CLINIC_STOCK_INSUFFICIENT_WAREHOUSE:",
        "Warehouse stock is insufficient for one or more products",
        [{ productId: line.productId, requested: line.quantity, available: plan.available }],
      );
    }

    const transactionIds: string[] = [];
    for (const step of plan.plan) {
      const lot = lotList.find((candidate) => candidate.id === step.lotId)!;
      lot.quantityRemaining -= step.deduct;
      draft.transactionSequence += 1;
      const transactionId = `itx-${draft.transactionSequence}`;
      draft.transactions.push({
        id: transactionId,
        inventoryProductId,
        lotId: step.lotId,
        transactionType: "OUT",
        quantityChanged: -step.deduct,
        reason: `${STOCK_IN_REASON_PREFIX}${input.clinicId}`,
        occurredAtTick: draft.clock,
      });
      transactionIds.push(transactionId);
    }

    const { record, created } = upsertOverlay(draft, input.clinicId, line.productId, {
      stockQuantity: 0,
      isVisible: true,
    });
    const stockBefore = record.stockQuantity;
    record.stockQuantity = stockBefore + line.quantity;

    const entry = appendLedger(draft, {
      clinicId: input.clinicId,
      productId: line.productId,
      direction: "IN",
      quantity: line.quantity,
      movementSource: "WAREHOUSE_STOCK_IN",
      actorUserId: input.actorUserId,
      addonOrderId: null,
      inventoryTransactionId: transactionIds[0] ?? null,
    });

    applied.push({
      productId: line.productId,
      quantity: line.quantity,
      stockBefore,
      stockAfter: record.stockQuantity,
      transactionIds,
      ledgerEntryId: entry.id,
      overlayCreated: created,
    });
  }

  commit(world, draft);
  return {
    ok: true,
    value: {
      clinicId: input.clinicId,
      applied,
      totalQuantity: applied.reduce((sum, line) => sum + line.quantity, 0),
    },
  };
}

// ─── clinic_shop_apply_sale ──────────────────────────────────────────────────

/** The three Movement_Sources a sale may carry (Req 2.8, 11.3). */
export type SaleMovementSource = Extract<
  ClinicMovementSource,
  "CUSTOMER_APP_SALE" | "ASSISTED_SALE" | "WALKIN_SALE"
>;

export interface ApplySaleInput {
  clinicId: string;
  /** The Shop_Order the `OUT` entries reference (Req 2.10). */
  addonOrderId: string;
  lines: readonly StockInLineInput[];
  movementSource: SaleMovementSource;
  actorUserId: string;
}

export interface ApplySaleAppliedLine {
  productId: string;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  ledgerEntryId: number;
}

export interface ApplySaleReport {
  clinicId: string;
  addonOrderId: string;
  applied: ApplySaleAppliedLine[];
  totalQuantity: number;
}

/**
 * `clinic_shop_apply_sale(p_clinic_id, p_addon_order_id, p_lines,
 *                         p_movement_source, p_actor_user_id)`.
 *
 * Models the RPC's conditional `UPDATE ... WHERE stock_quantity >= qty`: a line
 * asking for more than the clinic holds cannot apply, so the whole sale is
 * rejected naming every shortfall product and the quantity available, and stock
 * can never fall below 0. A clinic holding no overlay row for an ordered product
 * has an Effective_Clinic_Stock of 0 and is therefore always a shortfall.
 *
 * Requirements 10.8, 10.9, 10.10, 10.11, 11.1, 11.2, 11.3, 11.4.
 */
export function clinicShopApplySale(
  world: World,
  input: ApplySaleInput,
): ModelResult<ApplySaleReport> {
  const clinic = requireCoreClinic(world, input.clinicId);
  if (!clinic.ok) return clinic;

  const actorError = requireActor(world, input.actorUserId);
  if (actorError !== null) return { ok: false, error: actorError };

  if (
    world.addonOrderIds !== null &&
    !world.addonOrderIds.has(input.addonOrderId)
  ) {
    return fail(
      "CLINIC_REFERENCE_NOT_FOUND:",
      `Shop order ${input.addonOrderId} was not found`,
    );
  }

  const lines = [...input.lines];
  const products = requireProducts(
    world,
    lines.map((line) => line.productId),
  );
  if (!products.ok) return products;

  const contexts: SaleProductContext[] = lines.map((line) => ({
    productId: line.productId,
    overlay: world.overlays.get(overlayKey(input.clinicId, line.productId)),
  }));

  const verdict = evaluateSaleSubmission({
    clinicId: input.clinicId,
    lines,
    products: contexts,
  });

  if (!verdict.ok) {
    const products_ = verdict.rejections.map((rejection) => ({
      productId: rejection.productId,
      requested:
        typeof rejection.requested === "number" ? rejection.requested : undefined,
      available: rejection.available,
    }));
    switch (verdict.code) {
      case "INSUFFICIENT_CLINIC_STOCK":
        return fail(
          "CLINIC_STOCK_INSUFFICIENT_CLINIC:",
          "Clinic stock is insufficient for one or more products",
          products_,
        );
      case "INVALID_QUANTITY":
        return fail(
          "CLINIC_STOCK_INVALID_QUANTITY:",
          "Each ordered quantity must be a whole number between 1 and 1,000,000",
          products_,
        );
      default:
        return fail(
          "CLINIC_STOCK_INVALID_SUBMISSION:",
          `The sale was rejected (${verdict.code})`,
          products_,
        );
    }
  }

  const draft = cloneWorld(world);
  draft.clock += 1;
  const applied: ApplySaleAppliedLine[] = [];

  for (const line of lines) {
    // Guaranteed to exist: a missing overlay reads as 0 and would have been a
    // shortfall above, so acceptance implies a record with enough stock.
    const record = draft.overlays.get(overlayKey(input.clinicId, line.productId))!;
    const stockBefore = record.stockQuantity;
    record.stockQuantity = stockBefore - line.quantity;

    const entry = appendLedger(draft, {
      clinicId: input.clinicId,
      productId: line.productId,
      direction: "OUT",
      quantity: line.quantity,
      movementSource: input.movementSource,
      actorUserId: input.actorUserId,
      addonOrderId: input.addonOrderId,
      inventoryTransactionId: null,
    });

    applied.push({
      productId: line.productId,
      quantity: line.quantity,
      stockBefore,
      stockAfter: record.stockQuantity,
      ledgerEntryId: entry.id,
    });
  }

  commit(world, draft);
  return {
    ok: true,
    value: {
      clinicId: input.clinicId,
      addonOrderId: input.addonOrderId,
      applied,
      totalQuantity: applied.reduce((sum, line) => sum + line.quantity, 0),
    },
  };
}

// ─── set_clinic_product_visibility ───────────────────────────────────────────

export interface SetVisibilityInput {
  clinicId: string;
  productId: string;
  isVisible: boolean;
}

export interface SetVisibilityReport {
  clinicId: string;
  productId: string;
  isVisible: boolean;
  /** True when the upsert created the overlay row (Req 6.4). */
  overlayCreated: boolean;
}

/**
 * `set_clinic_product_visibility(p_clinic_id, p_product_id, p_is_visible)`.
 *
 * Upsert-shaped: a missing overlay row is created at `stock_quantity = 0` with
 * the submitted visibility, so setting visibility never invents stock and never
 * writes a ledger entry. Idempotent — setting the same value twice leaves one
 * record with that value, which is what makes double-toggling an involution.
 *
 * Requirements 6.2, 6.4, 6.5, 6.6.
 */
export function setClinicProductVisibility(
  world: World,
  input: SetVisibilityInput,
): ModelResult<SetVisibilityReport> {
  const clinic = requireCoreClinic(world, input.clinicId);
  if (!clinic.ok) return clinic;

  const products = requireProducts(world, [input.productId]);
  if (!products.ok) return products;

  const draft = cloneWorld(world);
  draft.clock += 1;
  const { record, created } = upsertOverlay(
    draft,
    input.clinicId,
    input.productId,
    { stockQuantity: 0, isVisible: input.isVisible },
  );
  record.isVisible = input.isVisible;

  commit(world, draft);
  return {
    ok: true,
    value: {
      clinicId: input.clinicId,
      productId: input.productId,
      isVisible: record.isVisible,
      overlayCreated: created,
    },
  };
}

// ─── franchise_shop_stock_in ─────────────────────────────────────────────────

export interface FranchiseStockInInput {
  franchiseId: string;
  productId: string;
  quantity: number;
  actorUserId: string;
}

export interface FranchiseStockInReport {
  franchiseId: string;
  productId: string;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  transactionLotIds: string[];
  ledgerEntryId: number;
  settingsCreated: boolean;
}

/**
 * `franchise_shop_stock_in(p_franchise_id, p_product_id, p_quantity,
 *                          p_actor_user_id)`.
 *
 * The franchise twin of {@link clinicShopStockIn} over `franchise_inventory_lots`
 * and `franchise_product_settings`. Note the asymmetry the requirements specify:
 * a newly created franchise settings row defaults to `is_visible = false`,
 * whereas a clinic overlay defaults to visible (Req 18.3).
 *
 * Requirements 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9.
 */
export function franchiseShopStockIn(
  world: World,
  input: FranchiseStockInInput,
): ModelResult<FranchiseStockInReport> {
  if (!world.franchiseIds.has(input.franchiseId)) {
    return fail(
      "CLINIC_REFERENCE_NOT_FOUND:",
      `Franchise ${input.franchiseId} was not found`,
    );
  }

  const actorError = requireActor(world, input.actorUserId);
  if (actorError !== null) return { ok: false, error: actorError };

  const products = requireProducts(world, [input.productId]);
  if (!products.ok) return products;
  const product = products.value[0];

  const quantity = validateMovementQuantity(input.quantity);
  if (!quantity.ok) {
    return fail(
      "CLINIC_STOCK_INVALID_QUANTITY:",
      "Quantity must be a whole number between 1 and 1,000,000",
      [{ productId: input.productId }],
    );
  }

  if (product.inventoryProductId === null) {
    return fail(
      "CLINIC_STOCK_UNLINKED_PRODUCT:",
      "The shop product must be linked to a Master Catalog Product before stock-in",
      [{ productId: input.productId }],
    );
  }

  const settingsKey = overlayKey(input.franchiseId, input.productId);
  const stockBefore = world.franchiseSettings.get(settingsKey)?.stockQuantity ?? 0;
  if (stockBefore + quantity.value > STOCK_QUANTITY_MAXIMUM) {
    return fail(
      "CLINIC_STOCK_EXCEEDS_MAXIMUM:",
      `The maximum stock quantity is ${STOCK_QUANTITY_MAXIMUM.toLocaleString("en-US")}`,
      [{ productId: input.productId, requested: quantity.value }],
    );
  }

  const lotsKey = overlayKey(input.franchiseId, product.inventoryProductId);
  const draft = cloneWorld(world);
  const lotList = draft.franchiseLots.get(lotsKey) ?? [];
  const plan = planFifoDepletion(lotList, quantity.value);
  if (!plan.ok) {
    return fail(
      "CLINIC_STOCK_INSUFFICIENT_WAREHOUSE:",
      "Franchise warehouse stock is insufficient",
      [
        {
          productId: input.productId,
          requested: quantity.value,
          available: plan.available,
        },
      ],
    );
  }

  draft.clock += 1;
  const transactionLotIds: string[] = [];
  for (const step of plan.plan) {
    const lot = lotList.find((candidate) => candidate.id === step.lotId)!;
    lot.quantityRemaining -= step.deduct;
    transactionLotIds.push(step.lotId);
  }
  draft.franchiseLots.set(lotsKey, lotList);

  const existing = draft.franchiseSettings.get(settingsKey);
  const settingsCreated = existing === undefined;
  const setting: FranchiseSettingRecord = existing ?? {
    franchiseId: input.franchiseId,
    productId: input.productId,
    stockQuantity: 0,
    isVisible: false,
  };
  setting.stockQuantity += quantity.value;
  draft.franchiseSettings.set(settingsKey, setting);

  draft.franchiseLedgerSequence += 1;
  const ledgerEntryId = draft.franchiseLedgerSequence;
  draft.franchiseLedger.push({
    id: ledgerEntryId,
    franchiseId: input.franchiseId,
    productId: input.productId,
    direction: "OUT",
    quantity: quantity.value,
    stockOutReason: FRANCHISE_SHOP_STOCK_IN_REASON,
    occurredAtTick: draft.clock,
  });

  commit(world, draft);
  return {
    ok: true,
    value: {
      franchiseId: input.franchiseId,
      productId: input.productId,
      quantity: quantity.value,
      stockBefore,
      stockAfter: setting.stockQuantity,
      transactionLotIds,
      ledgerEntryId,
      settingsCreated,
    },
  };
}

// ─── migrate_shop_stock_to_clinics ───────────────────────────────────────────

export interface MigrationInput {
  /** The actor recorded on every `MIGRATION` ledger entry. */
  actorUserId: string;
}

export interface MigrationReport {
  /**
   * `APPLIED`         — overlays created (possibly none, when they all existed).
   * `NO_CORE_CLINIC`  — nothing created, nothing to target (Req 20.13).
   * `EXCEEDS_MAXIMUM` — pre-scan abort, nothing created (Req 20.6).
   *
   * Only `APPLIED` changes the world; the other two are reports over an
   * untouched world, mirroring the RPC's "abort with a report" behaviour.
   */
  status: "APPLIED" | "NO_CORE_CLINIC" | "EXCEEDS_MAXIMUM";
  targetClinicId: string | null;
  overlaysCreated: number;
  ledgerEntriesWritten: number;
  /** Products whose legacy quantity was negative or non-integral (Req 20.5). */
  clampedProductIds: string[];
  /** Products whose legacy quantity exceeded the maximum (Req 20.6). */
  exceedingProductIds: string[];
}

/**
 * `migrate_shop_stock_to_clinics()`.
 *
 * Idempotent by construction: overlay creation is `INSERT ... ON CONFLICT DO
 * NOTHING` over every (Core Clinic × non-deleted product) pair, and ledger
 * writes are driven off the rows the run actually inserted. A pre-existing pair
 * is therefore left untouched and a second run is a no-op.
 *
 * The Migration_Target_Clinic — the earliest-created Core Clinic — receives each
 * product's `products.stock_quantity` (null, negative, or non-integral clamped to
 * 0); every other Core Clinic receives 0. Aggregate_Stock afterwards equals the
 * pre-migration value because exactly one clinic takes the whole amount.
 *
 * Requirements 20.1, 20.2, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9, 20.10, 20.12, 20.13.
 */
export function migrateShopStockToClinics(
  world: World,
  input: MigrationInput,
): ModelResult<MigrationReport> {
  const clinics = coreClinics(world);
  if (clinics.length === 0) {
    return {
      ok: true,
      value: {
        status: "NO_CORE_CLINIC",
        targetClinicId: null,
        overlaysCreated: 0,
        ledgerEntriesWritten: 0,
        clampedProductIds: [],
        exceedingProductIds: [],
      },
    };
  }

  const liveProducts = [...world.products.values()]
    .filter((product) => product.deletedAt === null)
    .sort((a, b) => a.id.localeCompare(b.id));

  const exceedingProductIds = liveProducts
    .filter(
      (product) =>
        typeof product.legacyStockQuantity === "number" &&
        Number.isInteger(product.legacyStockQuantity) &&
        product.legacyStockQuantity > STOCK_QUANTITY_MAXIMUM,
    )
    .map((product) => product.id);

  if (exceedingProductIds.length > 0) {
    return {
      ok: true,
      value: {
        status: "EXCEEDS_MAXIMUM",
        targetClinicId: null,
        overlaysCreated: 0,
        ledgerEntriesWritten: 0,
        clampedProductIds: [],
        exceedingProductIds,
      },
    };
  }

  const targetClinicId = clinics[0].id;
  const draft = cloneWorld(world);
  draft.clock += 1;

  const clampedProductIds: string[] = [];
  let overlaysCreated = 0;
  let ledgerEntriesWritten = 0;

  for (const product of liveProducts) {
    const legacy = product.legacyStockQuantity;
    const usable =
      typeof legacy === "number" && Number.isInteger(legacy) && legacy >= 0
        ? legacy
        : 0;
    if (usable !== (legacy ?? 0)) clampedProductIds.push(product.id);

    for (const clinic of clinics) {
      const key = overlayKey(clinic.id, product.id);
      if (draft.overlays.has(key)) continue; // ON CONFLICT DO NOTHING (Req 20.9)

      const stockQuantity = clinic.id === targetClinicId ? usable : 0;
      draft.overlays.set(key, {
        clinicId: clinic.id,
        productId: product.id,
        stockQuantity,
        isVisible: product.isActive, // Req 20.1
      });
      overlaysCreated += 1;

      if (stockQuantity > 0) {
        appendLedger(draft, {
          clinicId: clinic.id,
          productId: product.id,
          direction: "IN",
          quantity: stockQuantity,
          movementSource: "MIGRATION",
          actorUserId: input.actorUserId,
          addonOrderId: null,
          inventoryTransactionId: null,
        });
        ledgerEntriesWritten += 1;
      }
    }
  }

  commit(world, draft);
  return {
    ok: true,
    value: {
      status: "APPLIED",
      targetClinicId,
      overlaysCreated,
      ledgerEntriesWritten,
      clampedProductIds,
      exceedingProductIds: [],
    },
  };
}
