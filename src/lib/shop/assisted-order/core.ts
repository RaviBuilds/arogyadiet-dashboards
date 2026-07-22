/**
 * Assisted shop-order — portal-agnostic pure core logic.
 *
 * Feature: admin-place-shop-order-for-customer.
 *
 * These functions are dependency-free and perform NO I/O. They encode the
 * decision logic shared by the admin and franchise portals (module boundaries
 * forbid cross-portal imports, so both portals import this single core):
 *
 *   - cart mutation + quantity validation (Req 1.1–1.6),
 *   - the franchise add precondition guard (Req 1.9, 1.10),
 *   - customer search-query validation/normalization (Req 2.1–2.3),
 *   - eligibility comparison (Req 3.1–3.4),
 *   - operator scope membership (Req 8.3, 8.4),
 *   - placement gating on a PAID payment status (Req 5.2, 5.4, 5.5, 5.7).
 *
 * Everything here is unit/property testable without a database.
 */

/** The role of the operator placing an order on behalf of a customer. */
export type OperatorRole = "ADMIN" | "FRANCHISE_ADMIN";

/**
 * The scope an operator is allowed to act within.
 * - `CORE`: an Admin serves only core-business customers (`franchise_id === null`).
 * - `FRANCHISE`: a Franchise_Admin serves only customers of their own franchise.
 */
export type OperatorScope =
  | { kind: "CORE" }
  | { kind: "FRANCHISE"; franchiseId: string };

/** A single line in the operator-built cart. */
export type CartLine = { productId: string; quantity: number };

/** Minimum orderable quantity for a single cart line. */
export const MIN_QTY = 1;
/** Maximum orderable quantity for a single cart line. */
export const MAX_QTY = 999;

const QUANTITY_RANGE_ERROR = `Quantity must be a whole number between ${MIN_QTY} and ${MAX_QTY}.`;

/**
 * Validate a requested quantity: it must be an integer within `[MIN_QTY, MAX_QTY]`.
 * (Req 1.3)
 */
export function validateQuantity(
  qty: number,
): { ok: true; value: number } | { ok: false; error: string } {
  if (
    typeof qty !== "number" ||
    !Number.isFinite(qty) ||
    !Number.isInteger(qty) ||
    qty < MIN_QTY ||
    qty > MAX_QTY
  ) {
    return { ok: false, error: QUANTITY_RANGE_ERROR };
  }
  return { ok: true, value: qty };
}

/** Return the quantity currently recorded for `productId`, or 0 when absent. */
function existingQuantity(cart: CartLine[], productId: string): number {
  const line = cart.find((l) => l.productId === productId);
  return line ? line.quantity : 0;
}

/**
 * Add `qty` of `productId` to the cart.
 * - When the product is not already present, a new line with quantity `qty`
 *   is created (Req 1.1).
 * - When the product is already present, its quantity is increased by `qty`,
 *   clamped to `MAX_QTY` (Req 1.2).
 * - An invalid `qty` is rejected and the cart is left unchanged (Req 1.3).
 */
export function addToCart(
  cart: CartLine[],
  productId: string,
  qty: number,
): { ok: true; cart: CartLine[] } | { ok: false; error: string } {
  const validated = validateQuantity(qty);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const existing = cart.find((l) => l.productId === productId);
  if (!existing) {
    return { ok: true, cart: [...cart, { productId, quantity: validated.value }] };
  }

  const merged = Math.min(existing.quantity + validated.value, MAX_QTY);
  const next = cart.map((l) =>
    l.productId === productId ? { ...l, quantity: merged } : l,
  );
  return { ok: true, cart: next };
}

/**
 * Set the quantity of `productId` to an exact value.
 * - `qty === 0` removes the line entirely (Req 1.5).
 * - A valid non-zero `qty` replaces the recorded quantity (Req 1.4). When the
 *   product is not yet present it is added with that quantity.
 * - Any other invalid `qty` (non-integer, negative, or > `MAX_QTY`) is rejected
 *   and the cart is left unchanged (Req 1.3).
 */
export function setCartQuantity(
  cart: CartLine[],
  productId: string,
  qty: number,
): { ok: true; cart: CartLine[] } | { ok: false; error: string } {
  if (qty === 0) {
    return { ok: true, cart: removeFromCart(cart, productId) };
  }

  const validated = validateQuantity(qty);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const exists = cart.some((l) => l.productId === productId);
  const next = exists
    ? cart.map((l) =>
        l.productId === productId ? { ...l, quantity: validated.value } : l,
      )
    : [...cart, { productId, quantity: validated.value }];
  return { ok: true, cart: next };
}

/** Remove a product's line from the cart, leaving all other lines unchanged. (Req 1.6) */
export function removeFromCart(cart: CartLine[], productId: string): CartLine[] {
  return cart.filter((l) => l.productId !== productId);
}

/** Availability of a product within a specific franchise's catalog overlay. */
export type FranchiseProductAvailability = {
  /** Whether the product is visible/selectable for the franchise (Req 1.8, 1.9). */
  visible: boolean;
  /** The stock currently available for the product in the franchise (Req 1.10). */
  availableStock: number;
};

const PRODUCT_NOT_AVAILABLE_ERROR =
  "This product is not available for the franchise.";

/**
 * Franchise add precondition guard (Req 1.9, 1.10).
 *
 * Adds `qty` of `productId` to the cart ONLY when the franchise precondition
 * holds: the product must be visible for the franchise, and the resulting line
 * quantity (existing in cart + `qty`) must not exceed the product's available
 * franchise stock. When either check fails — or the quantity itself is invalid
 * — the add is rejected and the cart is returned unchanged. On success the add
 * is delegated to {@link addToCart} (merge + clamp semantics preserved).
 */
export function addToCartForFranchise(
  cart: CartLine[],
  productId: string,
  qty: number,
  availability: FranchiseProductAvailability,
): { ok: true; cart: CartLine[] } | { ok: false; error: string } {
  const validated = validateQuantity(qty);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  if (!availability.visible) {
    return { ok: false, error: PRODUCT_NOT_AVAILABLE_ERROR };
  }

  const requestedTotal = existingQuantity(cart, productId) + validated.value;
  if (requestedTotal > availability.availableStock) {
    return {
      ok: false,
      error: `Only ${availability.availableStock} in stock for this product.`,
    };
  }

  return addToCart(cart, productId, validated.value);
}

/** Minimum digit count for a mobile-number search query. */
export const MIN_MOBILE_DIGITS = 3;
/** Minimum character count for a name search query. */
export const MIN_NAME_CHARS = 2;

/**
 * Validate and normalize a customer search query by kind (Req 2.1–2.3).
 *
 * - `MOBILE`: accepted only when it contains at least {@link MIN_MOBILE_DIGITS}
 *   digits after trimming. The normalized value is the extracted digit sequence
 *   (surrounding whitespace and separators removed) used for the `ILIKE` match.
 * - `NAME`: accepted only when its trimmed length is at least
 *   {@link MIN_NAME_CHARS}. The normalized value is the trimmed string.
 *
 * A too-short query is rejected with a minimum-length message and performs no
 * lookup.
 */
export function validateSearchQuery(
  query: string,
  kind: "MOBILE" | "NAME",
): { ok: true; normalized: string } | { ok: false; error: string } {
  const trimmed = (query ?? "").trim();

  if (kind === "MOBILE") {
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length < MIN_MOBILE_DIGITS) {
      return {
        ok: false,
        error: `Enter at least ${MIN_MOBILE_DIGITS} digits to search by mobile number.`,
      };
    }
    return { ok: true, normalized: digits };
  }

  if (trimmed.length < MIN_NAME_CHARS) {
    return {
      ok: false,
      error: `Enter at least ${MIN_NAME_CHARS} characters to search by name.`,
    };
  }
  return { ok: true, normalized: trimmed };
}

/**
 * Customer eligibility (Req 3.1–3.4).
 *
 * A customer is eligible if and only if the Active_Subscription's
 * Effective_End_Date is strictly greater than the Current_IST_Date. Both are
 * ISO `YYYY-MM-DD` strings, for which a lexicographic comparison is equivalent
 * to a chronological one. A missing/blank Effective_End_Date (no active
 * subscription) is ineligible, and a date equal to today (Expiring_Today) is
 * ineligible because there is no next available delivery day.
 */
export function isCustomerEligible(
  effectiveEndDate: string | null | undefined,
  currentISTDate: string,
): boolean {
  if (!effectiveEndDate) {
    return false;
  }
  return effectiveEndDate > currentISTDate;
}

/**
 * Whether the target customer's `franchise_id` falls within the operator's
 * scope (Req 8.3, 8.4).
 *
 * - `CORE` (Admin): the target must be a core customer (`franchise_id === null`).
 * - `FRANCHISE` (Franchise_Admin): the target's franchise must equal the
 *   operator's franchise.
 */
export function isTargetInScope(
  scope: OperatorScope,
  targetFranchiseId: string | null,
): boolean {
  if (scope.kind === "CORE") {
    return targetFranchiseId === null;
  }
  return targetFranchiseId === scope.franchiseId;
}

/** The payment status that gates placement. */
export const PAID_STATUS = "PAID" as const;

/**
 * Placement gating (Req 5.2, 5.4, 5.5, 5.7): placement is enabled if and only
 * if the payment status is exactly PAID. Every other status (including before
 * Mark-Paid) leaves placement disabled.
 */
export function canPlaceOrder(paymentStatus: string): boolean {
  return paymentStatus === PAID_STATUS;
}
