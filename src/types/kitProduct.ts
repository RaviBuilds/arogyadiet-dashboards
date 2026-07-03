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
 */
export interface KitProductWithCalculations extends KitProduct {
  tax_amount: number;
  total_price: number;
}

/**
 * Calculate tax and total for a KIT product
 */
export function calculateKitProductPrice(basePrice: number, taxRate: number = 0.05): {
  tax_amount: number;
  total_price: number;
} {
  const tax_amount = basePrice * taxRate;
  const total_price = basePrice + tax_amount;
  
  return {
    tax_amount: Number(tax_amount.toFixed(2)),
    total_price: Number(total_price.toFixed(2)),
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
  const { tax_amount, total_price } = calculateKitProductPrice(product.base_price, product.tax_rate);
  
  return {
    ...product,
    tax_amount,
    total_price,
  };
}
