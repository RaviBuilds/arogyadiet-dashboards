# Invoice Generation Library

## Overview

This library provides unified invoice generation logic with category-based branching for MEAL, KIT, and ADDON subscriptions. It centralizes the invoice data construction logic that was previously embedded in the invoice page component.

## Requirements

Validates Requirements: **10.1, 10.2, 10.3** from kit-subscription-management spec.

## Architecture

### Category-Based Branching

The invoice generation logic uses the `customer_category` field from the subscription to determine which pricing logic to apply:

1. **KIT Subscriptions** (`customer_category === 'KIT'`)
   - Fetches `kit_products` relation data
   - Uses `kit_products.base_price` as the base amount
   - Calculates tax as `base_price * kit_products.tax_rate` (typically 5%)
   - Includes kit product name and `kit_duration_days` in line item
   - No discount logic applied

2. **MEAL Subscriptions** (`customer_category === 'MEAL'`)
   - Uses existing `subscription_plans` pricing
   - Supports stored breakdown columns (`base_amount`, `tax_amount`)
   - Falls back to 5% reverse-calculation for legacy records
   - Supports discount logic

3. **ADDON Orders** (detected by `addon_orders` relation)
   - Uses addon order total amount
   - Supports stored breakdown or 5% reverse-calculation
   - Simple single-item invoice

## Key Functions

### `generateInvoiceData(paymentId: string): Promise<InvoiceData | null>`

Main function that constructs complete invoice data structure from a payment ID.

**Process:**
1. Fetches payment with relations:
   - `subscriptions` (includes `kit_products` and `subscription_plans`)
   - `customer_profiles` (includes `users` and `addresses`)
   - `addon_orders` (separate query)

2. Determines category and branches logic:
   - Checks for addon order first
   - If subscription exists, checks `customer_category`
   - Applies appropriate pricing calculations

3. Returns structured `InvoiceData` object with:
   - Customer information
   - Line items with descriptions
   - Pricing breakdown (base, tax, discount, total)
   - Payment details

### `calculateKitTax(basePrice: number): number`

Helper function for calculating 5% tax on KIT products.

**Features:**
- Fixed 5% tax rate
- Rounds to 2 decimal places
- Handles edge cases (zero, small amounts, decimals)

**Example:**
```typescript
const tax = calculateKitTax(10400); // Returns 520.00
const total = 10400 + tax; // 10920.00
```

## Data Structures

### InvoiceLineItem
```typescript
interface InvoiceLineItem {
  description: string;  // Product name or plan description
  subtitle: string;     // Additional details
  amount: number;       // Base amount before tax
}
```

### InvoicePricing
```typescript
interface InvoicePricing {
  baseAmount: number;      // Base price before tax and discount
  taxAmount: number;       // Calculated tax amount
  taxPercent: number;      // Tax percentage (5 for KIT)
  discountAmount: number;  // Discount applied (0 for KIT)
  finalPrice: number;      // Price after discount, before tax
  totalAmount: number;     // Final total including tax
}
```

### InvoiceData
Complete invoice representation with customer details, line items, and pricing breakdown.

## Database Query

The library uses the Supabase Admin Client to bypass RLS and fetch complete invoice data:

```typescript
const { data: payment } = await supabaseAdmin
  .from("payments")
  .select(`
    *,
    subscriptions (
      subscription_code,
      total_days,
      customer_category,
      kit_product_id,
      kit_duration_days,
      subscription_plans ( price, base_price ),
      kit_products ( name, base_price, tax_rate )
    ),
    customer_profiles (...)
  `)
  .eq("id", paymentId)
  .single();
```

**Key Relations:**
- `subscriptions.kit_products`: Joined for KIT subscriptions
- `subscriptions.subscription_plans`: Joined for MEAL subscriptions
- `customer_profiles.users`: Customer contact information
- `customer_profiles.addresses`: Billing address

## KIT-Specific Implementation

### Line Item Format
```
Description: "{Product Name} - {Duration} Days"
Example: "Weightloss Platinum - 30 Days"

Subtitle: "Ready-to-eat meal package delivered to your address."
```

### Pricing Display
For a KIT product with base price ₹10,400:
- Base Price: ₹10,400.00
- GST (5%): ₹520.00
- Total: ₹10,920.00

### Database Fields Used
- `kit_products.name`: Product name
- `kit_products.base_price`: Base amount
- `kit_products.tax_rate`: Tax rate (default 0.05)
- `subscriptions.kit_duration_days`: Duration for display

## Testing

Unit tests cover:
- Standard KIT product prices (Prime, Premium, Platinum)
- Various price points
- Decimal handling
- Edge cases (zero, small amounts)
- Rounding consistency

Run tests:
```bash
npm test -- src/lib/invoices/__tests__/index.test.ts --run
```

## Usage in Invoice Page

The invoice page (`src/app/customer/(main)/subscription/manage/billing/invoice/[id]/page.tsx`) uses this library:

```typescript
import { generateInvoiceData } from "@/lib/invoices";

// Fetch invoice data
const invoiceData = await generateInvoiceData(paymentId);

// Render with structured data
<div>
  {lineItems.map(item => (
    <div>
      <p>{item.description}</p>
      <p>₹{item.amount.toFixed(2)}</p>
    </div>
  ))}
</div>
```

## Benefits

1. **Separation of Concerns**: Business logic separated from UI rendering
2. **Type Safety**: Structured interfaces for all data
3. **Testability**: Pure functions easy to unit test
4. **Maintainability**: Single source of truth for invoice logic
5. **Extensibility**: Easy to add new subscription categories

## Future Enhancements

- Support for multiple line items per invoice
- Support for ACCOMMODATION category
- Invoice template variations by category
- PDF generation support
- Multi-currency support
