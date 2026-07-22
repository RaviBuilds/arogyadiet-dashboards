import {
  calculateShopOrderBreakdown,
  type ShopOrderDiscount,
} from "@/lib/pricing/inclusive-tax";

/**
 * Feature: admin-place-shop-order-for-customer
 *
 * Pricing adapter for the assisted (admin/franchise placed) shop order flow.
 *
 * This module wraps the customer-checkout pricing logic
 * (`calculateShopOrderBreakdown`) and enforces the two assisted-order pricing
 * rules that differ from the customer checkout:
 *   1. The delivery fee is ALWAYS 0 and is never added to the total (Req 4.2/4.3).
 *   2. Each unit price is resolved from the server-side catalog
 *      (`sale_price ?? original_price`) and any client-supplied price is ignored
 *      (Req 4.5).
 */

/** A single order line whose unit price has already been resolved server-side. */
export type PricedLine = {
  productId: string;
  quantity: number;
  /** Resolved server-side: `sale_price ?? original_price` (never client-supplied). */
  unitPrice: number;
  taxPercent: number;
  /** `unitPrice * quantity`. */
  gross: number;
};

/**
 * The pricing presented to the operator and stored on the addon order.
 * `deliveryFee` is typed as the literal `0` — it can never be anything else.
 */
export type AssistedOrderPricing = {
  subtotal: number; // breakdown.baseSubtotal (inclusive-tax base)
  tax: number; // breakdown.tax
  discount: number; // breakdown.discount (0 when none applies)
  deliveryFee: 0; // always 0 (Req 4.2)
  total: number; // breakdown.total (delivery fee excluded)
};

/**
 * The minimal server-catalog shape needed to resolve a unit price. Mirrors the
 * `products` columns selected by `fetchProductForCheckout`.
 */
export type AssistedCatalogProduct = {
  productId: string;
  salePrice: number | null | undefined;
  originalPrice: number | null | undefined;
  taxPercent: number | null | undefined;
};

export type AssistedPricingResult =
  | { ok: true; pricing: AssistedOrderPricing }
  | { ok: false; error: string };

export type PricedLinesResult =
  | { ok: true; lines: PricedLine[] }
  | { ok: false; error: string };

function isResolvablePrice(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Resolve a product's unit price from the server catalog: use `sale_price` when
 * it is a valid (finite, non-negative) number, otherwise fall back to
 * `original_price`. Returns `null` when neither price can be resolved. Any
 * client-supplied price is intentionally never consulted here (Req 4.5).
 */
export function resolveCatalogUnitPrice(
  product: Pick<AssistedCatalogProduct, "salePrice" | "originalPrice">,
): number | null {
  if (isResolvablePrice(product.salePrice)) {
    return product.salePrice;
  }
  if (isResolvablePrice(product.originalPrice)) {
    return product.originalPrice;
  }
  return null;
}

/**
 * Build resolved `PricedLine`s from cart lines and the server catalog. The unit
 * price for each line is resolved via {@link resolveCatalogUnitPrice}, ignoring
 * any client-supplied price. Returns an error when the cart is empty or when any
 * cart product's catalog price cannot be resolved (Req 4.5, 4.6).
 */
export function buildPricedLines(
  cart: ReadonlyArray<{ productId: string; quantity: number }>,
  catalog: ReadonlyMap<string, AssistedCatalogProduct>,
): PricedLinesResult {
  if (cart.length === 0) {
    return { ok: false, error: "At least one product is required to price the order." };
  }

  const lines: PricedLine[] = [];

  for (const { productId, quantity } of cart) {
    const product = catalog.get(productId);
    if (!product) {
      return {
        ok: false,
        error: `Unable to resolve catalog price for product ${productId}.`,
      };
    }

    const unitPrice = resolveCatalogUnitPrice(product);
    if (unitPrice === null) {
      return {
        ok: false,
        error: `Unable to resolve catalog price for product ${productId}.`,
      };
    }

    const taxPercent = isResolvablePrice(product.taxPercent)
      ? product.taxPercent
      : 0;

    lines.push({
      productId,
      quantity,
      unitPrice,
      taxPercent,
      gross: unitPrice * quantity,
    });
  }

  return { ok: true, lines };
}

/**
 * Compute the assisted-order pricing for a set of resolved lines using the same
 * inclusive-tax breakdown as the customer checkout, then force the delivery fee
 * to 0 and exclude it from the total (Req 4.1, 4.2, 4.3, 4.7).
 *
 * Returns an error when there are no lines or when a line carries an
 * unresolvable (non-finite / negative) unit price (Req 4.6).
 */
export function computeAssistedOrderPricing(
  lines: PricedLine[],
  discount?: ShopOrderDiscount,
): AssistedPricingResult {
  if (lines.length === 0) {
    return { ok: false, error: "At least one product is required to price the order." };
  }

  for (const line of lines) {
    if (!isResolvablePrice(line.unitPrice)) {
      return {
        ok: false,
        error: `Unable to resolve catalog price for product ${line.productId}.`,
      };
    }
  }

  const breakdown = calculateShopOrderBreakdown(
    lines.map((line) => ({ gross: line.gross, taxPercent: line.taxPercent })),
    discount,
  );

  return {
    ok: true,
    pricing: {
      subtotal: breakdown.baseSubtotal,
      tax: breakdown.tax,
      discount: breakdown.discount,
      deliveryFee: 0,
      total: breakdown.total,
    },
  };
}
