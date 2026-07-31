// src/lib/shop/clinicStock.ts
// Pure decision layer for per-clinic shop stock (clinic-scoped-shop-inventory
// spec — Task 2.3). This is the module every property test in the spec targets,
// so it is strictly pure: no Supabase import, no I/O, no `Date.now`, no
// randomness, and every function is total — malformed, missing, or out-of-range
// input yields a defined verdict instead of a throw.
//
// The Postgres RPCs (`clinic_shop_stock_in`, `clinic_shop_apply_sale`) execute
// the plan these functions produce and re-validate the same rules under row
// locks; this module exists so the rules can be reasoned about and tested
// without a database.
//
// Requirements validated: 1.13, 3.10, 5.3, 5.6, 5.11, 5.12, 6.3, 7.4, 7.8,
// 7.12, 7.14, 9.5, 10.7, 11.1, 19.5

import type { ClinicProductOverlayRow } from "@/types/clinicShop";

// ─────────────────────────────────────────────────────────────────────────────
// Bounds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stock_Quantity_Maximum — the inclusive upper bound applied to any single
 * clinic shop stock level and to any single stock movement quantity.
 * Mirrors the `stock_quantity` CHECK on `clinic_product_settings` and the
 * quantity CHECK on `clinic_product_ledger`. (Req 1.5, 2.2)
 */
export const STOCK_QUANTITY_MAXIMUM = 1_000_000;

/** Lowest accepted stored stock level. (Req 1.5, 1.6) */
export const STOCK_QUANTITY_MINIMUM = 0;

/** Lowest accepted movement quantity — a movement of 0 is not a movement. (Req 2.2) */
export const MOVEMENT_QUANTITY_MINIMUM = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers (not exported — keep the public surface to the spec's list)
// ─────────────────────────────────────────────────────────────────────────────

function asArray<T>(value: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(value) ? (value as readonly T[]) : [];
}

/**
 * Normalise a *stored* stock level read back from the database. A value that is
 * not a non-negative integer cannot be a real stock level, so it reads as 0 —
 * the same treatment Requirement 20.5 gives a negative or non-integral
 * `products.stock_quantity`. Values above the maximum are passed through
 * unchanged rather than clamped, so a data problem stays visible instead of
 * being silently rewritten.
 */
function normaliseStoredStock(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Effective overlay resolution (Req 1.13, 5.6, 9.5, 19.5)
// ─────────────────────────────────────────────────────────────────────────────

/** A clinic's resolved shop stock and visibility for one Shop Product. */
export interface ClinicOverlay {
  stockQuantity: number;
  isVisible: boolean;
}

/**
 * Anything callers legitimately hold as an overlay: the camelCase shape, the
 * snake_case `clinic_product_settings` row a repository returns, or nothing at
 * all when the clinic holds no record for the product.
 */
export type ClinicOverlayInput =
  | ClinicOverlay
  | Pick<ClinicProductOverlayRow, "stock_quantity" | "is_visible">
  | null
  | undefined;

/**
 * Resolve Effective_Clinic_Stock and Effective_Clinic_Visibility for one
 * (Core Clinic, Shop Product) pair.
 *
 * Absence of an overlay record is meaningful, not an error: it reads as stock 0
 * and hidden. This single resolver backs every stock display, availability
 * decision, and deduction in the feature, so a missing record can never read as
 * "visible" anywhere. (Req 1.13, 5.6, 9.5, 19.5)
 *
 * Pure. Total. Returns a fresh object on every call.
 */
export function resolveEffectiveOverlay(row: ClinicOverlayInput): ClinicOverlay {
  if (row === null || row === undefined || typeof row !== "object") {
    return { stockQuantity: 0, isVisible: false };
  }

  const rawStock =
    "stockQuantity" in row
      ? row.stockQuantity
      : "stock_quantity" in row
        ? row.stock_quantity
        : undefined;

  const rawVisible =
    "isVisible" in row
      ? row.isVisible
      : "is_visible" in row
        ? row.is_visible
        : undefined;

  return {
    stockQuantity: normaliseStoredStock(rawStock),
    isVisible: rawVisible === true,
  };
}

/**
 * Aggregate_Stock — the sum of one Shop Product's Effective_Clinic_Stock across
 * every Core Clinic. Clinics with no overlay record contribute 0, so the sum is
 * taken over the clinic set, not over the records that happen to exist.
 * (Req 3.10, 5.3)
 *
 * Pure. Total: a missing or non-array input aggregates to 0.
 */
export function computeAggregateStock(
  overlays: ReadonlyArray<ClinicOverlayInput> | null | undefined,
): number {
  let total = 0;
  for (const overlay of asArray(overlays)) {
    total += resolveEffectiveOverlay(overlay).stockQuantity;
  }
  return total;
}

/** Inputs to the customer-facing shop exposure decision. */
export interface ClinicShopExposureInput {
  /** `products.deleted_at` — non-null means soft-deleted. */
  deletedAt: string | null | undefined;
  /** Global_Visibility — the `products.is_active` flag. */
  isActive: boolean;
  /** The clinic's overlay record, or nothing when it holds none. */
  overlay: ClinicOverlayInput;
}

/**
 * Decide whether a Shop Product is exposed in one Core Clinic's customer-facing
 * shop. All four conditions must hold: the product is not soft-deleted, its
 * Global_Visibility is shown, that clinic's Effective_Clinic_Visibility is
 * shown, and that clinic's Effective_Clinic_Stock is greater than 0. Negating
 * any single condition removes the product from the shop. (Req 6.3)
 *
 * Pure. Total: malformed input resolves to "not exposed".
 */
export function isExposedInClinicShop(
  input: ClinicShopExposureInput | null | undefined,
): boolean {
  if (input === null || input === undefined || typeof input !== "object") {
    return false;
  }
  if (input.deletedAt !== null && input.deletedAt !== undefined) return false;
  if (input.isActive !== true) return false;

  const effective = resolveEffectiveOverlay(input.overlay);
  return effective.isVisible && effective.stockQuantity > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quantity validation (Req 1.7, 1.8, 2.2, 2.3, 7.13, 10.7)
// ─────────────────────────────────────────────────────────────────────────────

/** Why a submitted quantity was refused. */
export type QuantityRejection =
  | "NOT_INTEGER"
  | "BELOW_MINIMUM"
  | "ABOVE_MAXIMUM";

export type QuantityValidation =
  | { ok: true; value: number }
  | { ok: false; reason: QuantityRejection };

function validateIntegerInRange(
  value: unknown,
  minimum: number,
): QuantityValidation {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return { ok: false, reason: "NOT_INTEGER" };
  }
  if (value < minimum) return { ok: false, reason: "BELOW_MINIMUM" };
  if (value > STOCK_QUANTITY_MAXIMUM) {
    return { ok: false, reason: "ABOVE_MAXIMUM" };
  }
  return { ok: true, value };
}

/**
 * Validate a stock *movement* quantity: accepted exactly when the value is an
 * integer in [1, 1,000,000]. Integrality is checked first, so `1_000_000.5`
 * reports `NOT_INTEGER` rather than `ABOVE_MAXIMUM`, and every rejection says
 * which of the three rules was broken. Strings, `null`, `NaN`, and `Infinity`
 * are `NOT_INTEGER` — no coercion. (Req 2.2, 2.3, 7.13, 10.7)
 *
 * Pure. Total.
 */
export function validateMovementQuantity(value: unknown): QuantityValidation {
  return validateIntegerInRange(value, MOVEMENT_QUANTITY_MINIMUM);
}

/**
 * Validate a stored stock *level*: accepted exactly when the value is an
 * integer in [0, 1,000,000]. Same rejection taxonomy and same integrality-first
 * ordering as {@link validateMovementQuantity}; only the minimum differs, since
 * a clinic legitimately holds 0. (Req 1.5, 1.6, 1.7, 1.8)
 *
 * Pure. Total.
 */
export function validateStockLevel(value: unknown): QuantityValidation {
  return validateIntegerInRange(value, STOCK_QUANTITY_MINIMUM);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stock-in cart line merging (Req 7.3, 7.4)
// ─────────────────────────────────────────────────────────────────────────────

/** The identity of a pending stock-in line: one per destination clinic + product. */
export interface StockInLineKey {
  clinicId: string;
  productId: string;
}

/** A pending Stock_In line held in the Shop_Products_Cart. */
export interface StockInLine extends StockInLineKey {
  quantity: number;
}

/**
 * Add a pending Stock_In line to the cart, keeping exactly one line per
 * (destination Core Clinic, Shop Product) pair. A repeat entry for a pair
 * replaces that pair's line — the newest quantity wins — and keeps the line in
 * its original position so the cart does not reorder under the user. Lines for
 * other pairs are untouched, so several products can be held pending at once.
 * (Req 7.3, 7.4)
 *
 * Generic over the line shape so the `useInventoryStore` slice can carry its own
 * `id` / `name` / display fields alongside the key.
 *
 * Pure. Total: never mutates `lines`, always returns a new array.
 */
export function mergeStockInLine<T extends StockInLineKey>(
  lines: readonly T[] | null | undefined,
  incoming: T,
): T[] {
  const existing = [...asArray(lines)];
  if (incoming === null || incoming === undefined) return existing;

  const index = existing.findIndex(
    (line) =>
      line !== null &&
      line !== undefined &&
      line.clinicId === incoming.clinicId &&
      line.productId === incoming.productId,
  );

  if (index === -1) {
    existing.push(incoming);
    return existing;
  }

  existing[index] = incoming;
  return existing;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIFO depletion planning (Req 7.8)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A warehouse lot available for depletion. Callers MUST pass lots already
 * ordered oldest-first — this function preserves the given order and does not
 * sort, matching the existing `computeFifoDepletion` contract in
 * `src/lib/franchise-inventory/fifo-depletion.ts`.
 */
export interface DepletableLot {
  id: string;
  quantityRemaining: number;
}

/** One step of a depletion plan: take `deduct` units from lot `lotId`. */
export interface FifoDepletionStep {
  lotId: string;
  deduct: number;
}

export type FifoDepletionPlan =
  | { ok: true; plan: FifoDepletionStep[] }
  | { ok: false; available: number };

/**
 * Plan an oldest-lot-first depletion of `quantity` units across `lots`.
 *
 * Lots with a non-positive or unusable `quantityRemaining` are skipped, so an
 * empty lot set, an all-zero lot set, and a missing lot list all resolve to
 * `available: 0` rather than throwing. A quantity outside [1, 1,000,000] is not
 * plannable and returns the same failure shape — validate it first with
 * {@link validateMovementQuantity} when the caller needs to know *why*.
 *
 * The steps sum to exactly `quantity` on success, which is what makes the
 * warehouse decrement equal the clinic increment. (Req 7.8, 7.16)
 *
 * Pure. Total.
 */
export function planFifoDepletion(
  lots: readonly DepletableLot[] | null | undefined,
  quantity: number,
): FifoDepletionPlan {
  const usable = asArray(lots).filter(
    (lot) =>
      lot !== null &&
      lot !== undefined &&
      typeof lot.quantityRemaining === "number" &&
      Number.isFinite(lot.quantityRemaining) &&
      lot.quantityRemaining > 0,
  );

  const available = usable.reduce((sum, lot) => sum + lot.quantityRemaining, 0);

  const validated = validateMovementQuantity(quantity);
  if (!validated.ok) return { ok: false, available };
  if (validated.value > available) return { ok: false, available };

  const plan: FifoDepletionStep[] = [];
  let remaining = validated.value;

  for (const lot of usable) {
    if (remaining <= 0) break;
    const deduct = Math.min(remaining, lot.quantityRemaining);
    plan.push({ lotId: lot.id, deduct });
    remaining -= deduct;
  }

  return { ok: true, plan };
}

// ─────────────────────────────────────────────────────────────────────────────
// Destination resolution (Req 5.2, 5.4, 5.7, 5.8, 5.11, 5.12, 19.2, 19.3)
// ─────────────────────────────────────────────────────────────────────────────

/** The `destination` search-param value meaning All_Clinics_Mode. */
export const ALL_CLINICS_DESTINATION_VALUE = "all";

/** Shown when the requested destination does not exist. (Req 5.11) */
export const DESTINATION_UNAVAILABLE_NOTICE =
  "The selected destination is unavailable. Showing All Clinics.";

/** Shown when the destination option list itself could not be loaded. (Req 5.12) */
export const DESTINATION_LIST_LOAD_FAILED_NOTICE =
  "The destination list could not be loaded. Showing All Clinics.";

/**
 * A fully resolved Destination_Selector value. Always one of the three
 * renderable modes — there is no unresolved or partially-resolved state. The
 * All Clinics variant carries the fallback notice (or `null` when All Clinics
 * was genuinely requested).
 */
export type Destination =
  | { kind: "all-clinics"; notice: string | null }
  | { kind: "clinic"; clinicId: string }
  | { kind: "franchise"; franchiseId: string };

/** The destinations that actually exist, as loaded server-side. */
export interface KnownDestinations {
  /** Core Clinic ids (`clinics.franchise_id IS NULL`). */
  clinicIds: readonly string[];
  /** Active Franchise ids. */
  franchiseIds: readonly string[];
  /** Set when the option list could not be loaded at all. (Req 5.12) */
  loadFailed?: boolean;
}

/** A per-row action the Warehouse Shop Products page may offer in a given mode. */
export type ShopProductRowAction =
  | "edit"
  | "delete"
  | "franchises"
  | "global-visibility"
  | "clinic-visibility"
  | "franchise-visibility"
  | "stock-in";

/**
 * Resolve the raw `destination` search-param value into a renderable mode.
 *
 * - absent, empty, or `all` → All Clinics with no notice (Req 5.2)
 * - `clinic:<id>` / `franchise:<id>` naming a known destination → that mode
 * - a bare id matching a known Core Clinic or active Franchise → that mode
 * - an unknown id or a malformed value → All Clinics with the unavailable
 *   notice (Req 5.11)
 * - a failed option-list load → All Clinics with the load-failure notice,
 *   regardless of the raw value (Req 5.12)
 *
 * Pure. Total: every possible input yields one of the three modes.
 */
export function resolveDestination(
  raw: string | null | undefined,
  known: KnownDestinations | null | undefined,
): Destination {
  if (known?.loadFailed === true) {
    return { kind: "all-clinics", notice: DESTINATION_LIST_LOAD_FAILED_NOTICE };
  }

  const clinicIds = new Set(asArray(known?.clinicIds));
  const franchiseIds = new Set(asArray(known?.franchiseIds));

  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "" || value.toLowerCase() === ALL_CLINICS_DESTINATION_VALUE) {
    return { kind: "all-clinics", notice: null };
  }

  const separator = value.indexOf(":");
  if (separator !== -1) {
    const prefix = value.slice(0, separator).trim().toLowerCase();
    const id = value.slice(separator + 1).trim();
    if (prefix === "clinic" && clinicIds.has(id)) {
      return { kind: "clinic", clinicId: id };
    }
    if (prefix === "franchise" && franchiseIds.has(id)) {
      return { kind: "franchise", franchiseId: id };
    }
    return { kind: "all-clinics", notice: DESTINATION_UNAVAILABLE_NOTICE };
  }

  if (clinicIds.has(value)) return { kind: "clinic", clinicId: value };
  if (franchiseIds.has(value)) return { kind: "franchise", franchiseId: value };

  return { kind: "all-clinics", notice: DESTINATION_UNAVAILABLE_NOTICE };
}

/**
 * Format a Destination back into the `destination` search-param value, so the
 * prefix format lives in exactly one place. (Req 5.9)
 *
 * Pure.
 */
export function formatDestinationParam(destination: Destination): string {
  switch (destination.kind) {
    case "clinic":
      return `clinic:${destination.clinicId}`;
    case "franchise":
      return `franchise:${destination.franchiseId}`;
    default:
      return ALL_CLINICS_DESTINATION_VALUE;
  }
}

/**
 * The per-row actions a destination mode offers — All Clinics keeps the
 * catalogue actions and the global visibility toggle with no stock entry
 * (Req 5.4, 5.6), Clinic mode offers exactly two (Req 5.7, 5.8), and Franchise
 * mode offers exactly one (Req 19.2, 19.3).
 *
 * Pure.
 */
export function rowActionsForDestination(
  destination: Destination,
): readonly ShopProductRowAction[] {
  switch (destination.kind) {
    case "clinic":
      return ["clinic-visibility", "stock-in"];
    case "franchise":
      return ["franchise-visibility"];
    default:
      return ["global-visibility", "edit", "delete", "franchises"];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stock-in submission evaluation (Req 7.12, 7.14, 7.15, 19.4)
// ─────────────────────────────────────────────────────────────────────────────

/** A submitted line: how much of one Shop Product to move. */
export interface SubmissionLine {
  productId: string;
  quantity: number;
}

/** What the evaluator needs to know about one Shop Product on a stock-in. */
export interface StockInProductContext {
  productId: string;
  /** Display name, used by the action layer to build the error message. */
  productName?: string | null;
  /** Product_Link — `null` for an Unlinked_Shop_Product. (Req 7.15) */
  inventoryProductId: string | null;
  /** Base units of the linked Master Catalog Product available in the warehouse. */
  warehouseAvailable: number;
  /** The destination clinic's current overlay, or nothing when it holds none. */
  overlay?: ClinicOverlayInput;
}

export interface StockInSubmission {
  /** The resolved Destination_Selector value; only Clinic mode can stock in. */
  destination: Destination;
  lines: readonly SubmissionLine[];
  products: readonly StockInProductContext[];
}

export type StockInRejectionCode =
  | "INVALID_DESTINATION"
  | "NO_LINES"
  | "DUPLICATE_LINE"
  | "UNKNOWN_PRODUCT"
  | "INVALID_QUANTITY"
  | "UNLINKED_PRODUCT"
  | "INSUFFICIENT_WAREHOUSE"
  | "EXCEEDS_MAXIMUM";

export interface StockInLineRejection {
  productId: string;
  productName: string | null;
  code: StockInRejectionCode;
  /** Exactly what was submitted, unnormalised, for the error message. */
  requested: unknown;
  /** Warehouse base units available — set for `INSUFFICIENT_WAREHOUSE`. */
  available?: number;
  /** Set for `EXCEEDS_MAXIMUM`. */
  currentStock?: number;
  /** Set for `EXCEEDS_MAXIMUM`: what the level would have become. */
  resultingStock?: number;
  /** Set for `INVALID_QUANTITY`. */
  reason?: QuantityRejection;
}

export interface StockInAppliedLine {
  productId: string;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  /** Warehouse availability for the linked product before this line. */
  warehouseAvailableBefore: number;
  /** …and after it, accounting for earlier lines drawing on the same pool. */
  warehouseAvailableAfter: number;
}

export type StockInVerdict =
  | {
      ok: true;
      clinicId: string;
      applied: StockInAppliedLine[];
      totalQuantity: number;
    }
  | { ok: false; code: StockInRejectionCode; rejections: StockInLineRejection[] };

function normaliseAvailable(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function nameOf(context: { productName?: string | null } | undefined): string | null {
  return context?.productName ?? null;
}

/**
 * Evaluate a whole Shop_Products_Cart submission all-or-nothing.
 *
 * Every line is checked before any is accepted, so the verdict is either "apply
 * all of these" or "apply none of these" — which is what lets the RPC validate
 * first and mutate second, and what keeps pending cart lines intact on
 * rejection (Req 7.10, 7.12, 7.14).
 *
 * Checks run in fixed categories and the first category with any failure decides
 * the verdict, reporting *every* line that failed that check so the error names
 * each offending product:
 *
 * 1. `INVALID_DESTINATION` — All Clinics has no stock entry (Req 5.4) and a
 *    Franchise destination is stocked from the franchise portal (Req 19.4).
 * 2. `NO_LINES` — nothing pending (Req 7.5).
 * 3. `DUPLICATE_LINE` — a pair appears twice; callers merge with
 *    {@link mergeStockInLine} first (Req 7.4).
 * 4. `UNKNOWN_PRODUCT` — a line names a product the caller supplied no context for.
 * 5. `INVALID_QUANTITY` — outside [1, 1,000,000] or non-integral (Req 7.13).
 * 6. `UNLINKED_PRODUCT` — no Product_Link (Req 7.15).
 * 7. `INSUFFICIENT_WAREHOUSE` — demand exceeds warehouse stock, summed per
 *    linked Master Catalog Product since several Shop Products may share one
 *    (Req 3.9, 7.12).
 * 8. `EXCEEDS_MAXIMUM` — the resulting clinic level would pass 1,000,000 (Req 7.14).
 *
 * Pure. Total.
 */
export function evaluateStockInSubmission(
  input: StockInSubmission | null | undefined,
): StockInVerdict {
  const destination = input?.destination;
  if (!destination || destination.kind !== "clinic") {
    return { ok: false, code: "INVALID_DESTINATION", rejections: [] };
  }

  const lines = asArray(input?.lines).filter(
    (line) => line !== null && line !== undefined,
  );
  if (lines.length === 0) {
    return { ok: false, code: "NO_LINES", rejections: [] };
  }

  const contexts = new Map<string, StockInProductContext>();
  for (const product of asArray(input?.products)) {
    if (product !== null && product !== undefined) {
      contexts.set(product.productId, product);
    }
  }

  // 3. Duplicate pairs — the cart guarantees uniqueness, so a duplicate is a
  //    caller error rather than a quantity to sum.
  const seen = new Set<string>();
  const duplicates: StockInLineRejection[] = [];
  for (const line of lines) {
    if (seen.has(line.productId)) {
      duplicates.push({
        productId: line.productId,
        productName: nameOf(contexts.get(line.productId)),
        code: "DUPLICATE_LINE",
        requested: line.quantity,
      });
    }
    seen.add(line.productId);
  }
  if (duplicates.length > 0) {
    return { ok: false, code: "DUPLICATE_LINE", rejections: duplicates };
  }

  // 4. Unknown products.
  const unknown: StockInLineRejection[] = lines
    .filter((line) => !contexts.has(line.productId))
    .map((line) => ({
      productId: line.productId,
      productName: null,
      code: "UNKNOWN_PRODUCT" as const,
      requested: line.quantity,
    }));
  if (unknown.length > 0) {
    return { ok: false, code: "UNKNOWN_PRODUCT", rejections: unknown };
  }

  // 5. Quantity range and integrality.
  const badQuantities: StockInLineRejection[] = [];
  for (const line of lines) {
    const validated = validateMovementQuantity(line.quantity);
    if (!validated.ok) {
      badQuantities.push({
        productId: line.productId,
        productName: nameOf(contexts.get(line.productId)),
        code: "INVALID_QUANTITY",
        requested: line.quantity,
        reason: validated.reason,
      });
    }
  }
  if (badQuantities.length > 0) {
    return { ok: false, code: "INVALID_QUANTITY", rejections: badQuantities };
  }

  // 6. Product_Link present.
  const unlinked: StockInLineRejection[] = [];
  for (const line of lines) {
    const context = contexts.get(line.productId);
    const link = context?.inventoryProductId;
    if (typeof link !== "string" || link.trim() === "") {
      unlinked.push({
        productId: line.productId,
        productName: nameOf(context),
        code: "UNLINKED_PRODUCT",
        requested: line.quantity,
      });
    }
  }
  if (unlinked.length > 0) {
    return { ok: false, code: "UNLINKED_PRODUCT", rejections: unlinked };
  }

  // 7. Warehouse availability, pooled per linked Master Catalog Product.
  const demandByInventoryProduct = new Map<string, number>();
  const availableByInventoryProduct = new Map<string, number>();
  for (const line of lines) {
    const context = contexts.get(line.productId)!;
    const link = context.inventoryProductId as string;
    demandByInventoryProduct.set(
      link,
      (demandByInventoryProduct.get(link) ?? 0) + line.quantity,
    );
    const reported = normaliseAvailable(context.warehouseAvailable);
    const known = availableByInventoryProduct.get(link);
    // Several Shop Products can name the same warehouse item; take the most
    // conservative figure the caller supplied for that shared pool.
    availableByInventoryProduct.set(
      link,
      known === undefined ? reported : Math.min(known, reported),
    );
  }

  const shortfalls: StockInLineRejection[] = [];
  for (const line of lines) {
    const context = contexts.get(line.productId)!;
    const link = context.inventoryProductId as string;
    const demand = demandByInventoryProduct.get(link) ?? 0;
    const available = availableByInventoryProduct.get(link) ?? 0;
    if (demand > available) {
      shortfalls.push({
        productId: line.productId,
        productName: nameOf(context),
        code: "INSUFFICIENT_WAREHOUSE",
        requested: line.quantity,
        available,
      });
    }
  }
  if (shortfalls.length > 0) {
    return {
      ok: false,
      code: "INSUFFICIENT_WAREHOUSE",
      rejections: shortfalls,
    };
  }

  // 8. Resulting clinic level within Stock_Quantity_Maximum.
  const overflows: StockInLineRejection[] = [];
  for (const line of lines) {
    const context = contexts.get(line.productId)!;
    const currentStock = resolveEffectiveOverlay(context.overlay).stockQuantity;
    const resultingStock = currentStock + line.quantity;
    if (resultingStock > STOCK_QUANTITY_MAXIMUM) {
      overflows.push({
        productId: line.productId,
        productName: nameOf(context),
        code: "EXCEEDS_MAXIMUM",
        requested: line.quantity,
        currentStock,
        resultingStock,
      });
    }
  }
  if (overflows.length > 0) {
    return { ok: false, code: "EXCEEDS_MAXIMUM", rejections: overflows };
  }

  // Accepted: build the plan the RPC executes.
  const poolRemaining = new Map(availableByInventoryProduct);
  const applied: StockInAppliedLine[] = [];
  let totalQuantity = 0;

  for (const line of lines) {
    const context = contexts.get(line.productId)!;
    const link = context.inventoryProductId as string;
    const before = poolRemaining.get(link) ?? 0;
    const after = before - line.quantity;
    poolRemaining.set(link, after);

    const stockBefore = resolveEffectiveOverlay(context.overlay).stockQuantity;
    applied.push({
      productId: line.productId,
      quantity: line.quantity,
      stockBefore,
      stockAfter: stockBefore + line.quantity,
      warehouseAvailableBefore: before,
      warehouseAvailableAfter: after,
    });
    totalQuantity += line.quantity;
  }

  return {
    ok: true,
    clinicId: destination.clinicId,
    applied,
    totalQuantity,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sale submission evaluation (Req 10.7, 10.11, 11.1)
// ─────────────────────────────────────────────────────────────────────────────

/** What the evaluator needs to know about one Shop Product on a sale. */
export interface SaleProductContext {
  productId: string;
  productName?: string | null;
  /** The fulfilling clinic's overlay, or nothing when it holds none (reads as 0). */
  overlay?: ClinicOverlayInput;
}

export interface SaleSubmission {
  /** The fulfilling Core Clinic — the Order_Clinic_Stamp to be recorded. */
  clinicId: string | null | undefined;
  lines: readonly SubmissionLine[];
  products: readonly SaleProductContext[];
}

export type SaleRejectionCode =
  | "NO_FULFILLING_CLINIC"
  | "NO_LINES"
  | "DUPLICATE_LINE"
  | "UNKNOWN_PRODUCT"
  | "INVALID_QUANTITY"
  | "INSUFFICIENT_CLINIC_STOCK";

export interface SaleLineRejection {
  productId: string;
  productName: string | null;
  code: SaleRejectionCode;
  requested: unknown;
  /** Effective_Clinic_Stock — set for `INSUFFICIENT_CLINIC_STOCK`. (Req 11.1) */
  available?: number;
  /** Set for `INVALID_QUANTITY`. */
  reason?: QuantityRejection;
}

export interface SaleAppliedLine {
  productId: string;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
}

export type SaleVerdict =
  | {
      ok: true;
      clinicId: string;
      applied: SaleAppliedLine[];
      totalQuantity: number;
    }
  | { ok: false; code: SaleRejectionCode; rejections: SaleLineRejection[] };

/**
 * Evaluate a whole Shop_Order all-or-nothing against the fulfilling clinic's
 * Effective_Clinic_Stock.
 *
 * Identical in shape to {@link evaluateStockInSubmission}, and identical for all
 * three selling channels — customer-app purchase, assisted order, walk-in sale
 * (Req 11.3). Checks run in categories, first failure decides, and every line
 * failing that check is reported so the error can name each product with
 * insufficient stock together with the quantity available (Req 11.1):
 *
 * 1. `NO_FULFILLING_CLINIC` — no clinic resolved or selected (Req 10.6).
 * 2. `NO_LINES` — nothing to sell.
 * 3. `DUPLICATE_LINE` — merge per product before submitting.
 * 4. `UNKNOWN_PRODUCT` — a line names a product the caller supplied no context for.
 * 5. `INVALID_QUANTITY` — outside [1, 1,000,000] or non-integral (Req 10.7).
 * 6. `INSUFFICIENT_CLINIC_STOCK` — requested above Effective_Clinic_Stock, which
 *    is 0 when the clinic holds no overlay record (Req 10.11, 11.1, 11.5).
 *
 * On success every `stockAfter` is greater than or equal to 0, so an accepted
 * verdict can never oversell (Req 11.4).
 *
 * Pure. Total.
 */
export function evaluateSaleSubmission(
  input: SaleSubmission | null | undefined,
): SaleVerdict {
  const clinicId = input?.clinicId;
  if (typeof clinicId !== "string" || clinicId.trim() === "") {
    return { ok: false, code: "NO_FULFILLING_CLINIC", rejections: [] };
  }

  const lines = asArray(input?.lines).filter(
    (line) => line !== null && line !== undefined,
  );
  if (lines.length === 0) {
    return { ok: false, code: "NO_LINES", rejections: [] };
  }

  const contexts = new Map<string, SaleProductContext>();
  for (const product of asArray(input?.products)) {
    if (product !== null && product !== undefined) {
      contexts.set(product.productId, product);
    }
  }

  const seen = new Set<string>();
  const duplicates: SaleLineRejection[] = [];
  for (const line of lines) {
    if (seen.has(line.productId)) {
      duplicates.push({
        productId: line.productId,
        productName: nameOf(contexts.get(line.productId)),
        code: "DUPLICATE_LINE",
        requested: line.quantity,
      });
    }
    seen.add(line.productId);
  }
  if (duplicates.length > 0) {
    return { ok: false, code: "DUPLICATE_LINE", rejections: duplicates };
  }

  const unknown: SaleLineRejection[] = lines
    .filter((line) => !contexts.has(line.productId))
    .map((line) => ({
      productId: line.productId,
      productName: null,
      code: "UNKNOWN_PRODUCT" as const,
      requested: line.quantity,
    }));
  if (unknown.length > 0) {
    return { ok: false, code: "UNKNOWN_PRODUCT", rejections: unknown };
  }

  const badQuantities: SaleLineRejection[] = [];
  for (const line of lines) {
    const validated = validateMovementQuantity(line.quantity);
    if (!validated.ok) {
      badQuantities.push({
        productId: line.productId,
        productName: nameOf(contexts.get(line.productId)),
        code: "INVALID_QUANTITY",
        requested: line.quantity,
        reason: validated.reason,
      });
    }
  }
  if (badQuantities.length > 0) {
    return { ok: false, code: "INVALID_QUANTITY", rejections: badQuantities };
  }

  const shortfalls: SaleLineRejection[] = [];
  const applied: SaleAppliedLine[] = [];
  let totalQuantity = 0;

  for (const line of lines) {
    const context = contexts.get(line.productId)!;
    const available = resolveEffectiveOverlay(context.overlay).stockQuantity;
    if (line.quantity > available) {
      shortfalls.push({
        productId: line.productId,
        productName: nameOf(context),
        code: "INSUFFICIENT_CLINIC_STOCK",
        requested: line.quantity,
        available,
      });
      continue;
    }
    applied.push({
      productId: line.productId,
      quantity: line.quantity,
      stockBefore: available,
      stockAfter: available - line.quantity,
    });
    totalQuantity += line.quantity;
  }

  if (shortfalls.length > 0) {
    return {
      ok: false,
      code: "INSUFFICIENT_CLINIC_STOCK",
      rejections: shortfalls,
    };
  }

  return { ok: true, clinicId, applied, totalQuantity };
}
