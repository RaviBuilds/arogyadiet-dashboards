/**
 * KIT Product Type Definitions
 * 
 * Represents ready-to-eat meal packages sold as one-time purchases (e.g., 30-day kits).
 * These are separate from recurring meal subscription plans.
 * 
 * Requirements: 1.3, 1.4
 */

export interface KitProduct {
  id: string;
  name: string;
  base_price: number;
  tax_rate: number;
  created_at: Date;
  is_active: boolean;
}

/**
 * Database row representation with timestamp strings
 * Used when reading directly from Supabase
 */
export interface KitProductRow {
  id: string;
  name: string;
  base_price: number;
  tax_rate: number;
  created_at: string;
  is_active: boolean;
}

/**
 * Helper type for KIT product creation
 */
export interface CreateKitProductInput {
  name: string;
  base_price: number;
  tax_rate?: number; // Optional, defaults to 0.05 (5%)
}

/**
 * KIT product with calculated tax and total
 * Used in UI displays and invoices
 * 
 * Note: base_price in the database is the TOTAL inclusive price.
 * The display breaks it down into exclusive base + tax.
 */
export interface KitProductWithCalculations extends KitProduct {
  /** The pre-tax (exclusive) amount derived from the inclusive base_price */
  exclusive_base: number;
  /** Tax portion extracted from the inclusive base_price */
  tax_amount: number;
  /** Total price (same as base_price since it's already inclusive) */
  total_price: number;
}

/**
 * Calculate the tax breakup from an INCLUSIVE price.
 * 
 * The base_price stored in the database is the total inclusive of tax.
 * This function reverse-calculates the exclusive base and tax portion.
 * 
 * Example: base_price = ₹10,400 (inclusive of 5% tax)
 *   exclusive_base = 10400 / 1.05 = ₹9,904.76
 *   tax_amount = 10400 - 9904.76 = ₹495.24
 *   total_price = ₹10,400
 */
export function calculateKitProductPrice(inclusivePrice: number, taxRate: number = 0.05): {
  exclusive_base: number;
  tax_amount: number;
  total_price: number;
} {
  const exclusive_base = inclusivePrice / (1 + taxRate);
  const tax_amount = inclusivePrice - exclusive_base;
  
  return {
    exclusive_base: Number(exclusive_base.toFixed(2)),
    tax_amount: Number(tax_amount.toFixed(2)),
    total_price: Number(inclusivePrice.toFixed(2)),
  };
}

/**
 * Transform database row to KitProduct with parsed dates
 */
export function transformKitProductRow(row: KitProductRow): KitProduct {
  return {
    ...row,
    created_at: new Date(row.created_at),
  };
}

/**
 * Transform KitProduct to include calculations
 */
export function addCalculationsToKitProduct(product: KitProduct): KitProductWithCalculations {
  const { exclusive_base, tax_amount, total_price } = calculateKitProductPrice(product.base_price, product.tax_rate);
  
  return {
    ...product,
    exclusive_base,
    tax_amount,
    total_price,
  };
}
