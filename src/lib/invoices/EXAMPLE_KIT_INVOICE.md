# Example KIT Invoice Output

## Sample Data

**KIT Product:** Weightloss Platinum  
**Base Price:** ₹28,080.00  
**Duration:** 30 Days  
**Customer:** Rajesh Kumar  
**Payment Status:** PAID  

## Invoice Display

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                                                            INVOICE
                                            INV-ABC123 
                                            Date: 15 Jan, 2024
                                            [✓ PAID]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BILLED TO                           SUBSCRIPTION DETAILS
─────────────────────────           ────────────────────────────
Rajesh Kumar                        Subscription ID — SUB-XYZ789
rajesh@example.com                  Weightloss Platinum - 30 Days
+91 9876543210                      
                                    Payment Method: RAZORPAY
123 MG Road
Koramangala
Bangalore, Karnataka, 560034

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LINE ITEMS
─────────────────────────────────────────────────────────────────

Description                                              Amount
─────────────────────────────────────────────────────────────────
Weightloss Platinum - 30 Days                         ₹28,080.00
Ready-to-eat meal package delivered to your address.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PRICING BREAKDOWN                                   (Right-aligned)
─────────────────────────────────────────────────────────────────
Base Price                                             ₹28,080.00
GST (5%)                                                ₹1,404.00
                                                       ──────────
TOTAL PAID                                             ₹29,484.00

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Comparison: KIT vs MEAL Invoice

### KIT Invoice
```
Line Item: "Weightloss Platinum - 30 Days"
Subtitle:  "Ready-to-eat meal package delivered to your address."
Base:      ₹28,080.00
Tax:       ₹1,404.00 (5%)
Total:     ₹29,484.00
```

### MEAL Invoice
```
Line Item: "ArogyaDiet 30 Days Standard Plan"
Subtitle:  "Includes daily meal delivery, pause credits, and dynamic address routing."
Base:      ₹15,000.00
Discount:  -₹1,500.00 (if applicable)
Price After Discount: ₹13,500.00
Tax:       ₹675.00 (5%)
Total:     ₹14,175.00
```

## Key Differences

| Feature | KIT Invoice | MEAL Invoice |
|---------|------------|--------------|
| Product Source | `kit_products` table | `subscription_plans` table |
| Duration Display | "30 Days" | "30 Days" |
| Subtitle | Ready-to-eat package | Daily delivery service |
| Discount Support | No | Yes |
| Tax Rate | Fixed 5% from `kit_products.tax_rate` | 5% (stored or calculated) |

## All Three KIT Products

### Weightloss Prime
```
Base Price:  ₹10,400.00
GST (5%):    ₹520.00
Total:       ₹10,920.00
```

### Weightloss Premium
```
Base Price:  ₹19,760.00
GST (5%):    ₹988.00
Total:       ₹20,748.00
```

### Weightloss Platinum
```
Base Price:  ₹28,080.00
GST (5%):    ₹1,404.00
Total:       ₹29,484.00
```

## Invoice States

### Paid Invoice
- Header: "INVOICE"
- Status Badge: Green "PAID"
- Total Label: "Total Paid"
- Auto-print: Enabled

### Pending Invoice
- Header: "PROFORMA"
- Status Badge: Amber "PAYMENT PENDING"
- Total Label: "Amount Due"
- Auto-print: Disabled
- Warning Banner: "Payment Pending - This subscription has been created but payment has not yet been collected."

## Data Flow

```
Payment ID
    ↓
generateInvoiceData()
    ↓
Check customer_category
    ↓
if (category === 'KIT')
    ↓
Fetch kit_products relation
    ↓
Extract:
  - kit_products.name
  - kit_products.base_price
  - kit_products.tax_rate
  - subscriptions.kit_duration_days
    ↓
Calculate:
  - taxAmount = base_price * tax_rate
  - totalAmount = base_price + taxAmount
    ↓
Format line item:
  - description: "{name} - {duration} Days"
  - subtitle: "Ready-to-eat meal package..."
  - amount: base_price
    ↓
Return InvoiceData
    ↓
Render Invoice Page
```

## Testing Scenarios

### Scenario 1: New KIT Customer
1. Admin onboards customer with "Weightloss Premium" (₹19,760)
2. Payment marked as PAID
3. Customer views invoice
4. **Expected:**
   - Shows "Weightloss Premium - 30 Days"
   - Base: ₹19,760.00
   - Tax: ₹988.00
   - Total: ₹20,748.00

### Scenario 2: Pending Payment
1. Admin creates KIT subscription
2. Payment status = PENDING
3. Customer views invoice
4. **Expected:**
   - Header shows "PROFORMA"
   - Amber "PAYMENT PENDING" badge
   - Warning banner displayed
   - "Amount Due" instead of "Total Paid"

### Scenario 3: Multiple Durations
1. Customer A: Weightloss Prime - 15 Days
2. Customer B: Weightloss Prime - 30 Days
3. Both view invoices
4. **Expected:**
   - Customer A sees "Weightloss Prime - 15 Days"
   - Customer B sees "Weightloss Prime - 30 Days"
   - Same base price, different duration labels

## Security Validation

✅ Customer can only view their own invoices  
✅ Authentication required before access  
✅ Admin client used safely (read-only for invoice generation)  
✅ No SQL injection risks (parameterized queries)  
✅ XSS protection (React escapes all output)  
