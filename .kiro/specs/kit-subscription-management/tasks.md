# Implementation Plan: KIT Subscription Management

## Overview

This implementation plan transforms the KIT Subscription Management design into discrete coding tasks. The feature introduces a completely isolated subscription category for one-time purchases of ready-to-eat meal packages (KITs), operating independently from the existing meal subscription system. The implementation maintains strict isolation between KIT and meal subscription business logic while reusing platform authentication, payment, and customer management infrastructure.

**Key Implementation Focus**:
- Database schema for KIT products and shipping information
- Admin portal extensions for KIT product management and onboarding
- Category-based validation logic with PIN code bypass for KIT customers
- Shipping dashboard for courier tracking management
- Customer portal view selection based on subscription category
- Complete business logic isolation between KIT and MEAL systems

## Tasks

- [x] 1. Create database schema for KIT products and shipping information
  - [x] 1.1 Create kit_products table with base price and tax rate fields
    - Write SQL migration script in `scripts/create-kit-products-table.sql`
    - Create table with id, name, base_price, tax_rate (default 0.05), is_active fields
    - Add CHECK constraint for positive base_price and non-negative tax_rate
    - Create index on is_active for active products listing
    - _Requirements: 1.4, 9.1_
  
  - [x] 1.2 Create kit_shipping_info table for courier tracking
    - Write SQL migration script in `scripts/create-kit-shipping-info-table.sql`
    - Create table with customer_profile_id, subscription_id, courier_partner, tracking_number, tracking_url fields
    - Add CHECK constraint for courier_partner enum values ('OTHER', 'APSRTC', 'TGSRTC', 'DTDC')
    - Add CHECK constraint enforcing tracking_url required when courier_partner = 'OTHER'
    - Create indexes on customer_profile_id and subscription_id
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 9.4_
  
  - [x] 1.3 Extend subscriptions table with KIT-specific fields
    - Write SQL migration script in `scripts/add-kit-fields-to-subscriptions.sql`
    - Add kit_product_id UUID column as foreign key to kit_products
    - Add kit_duration_days INTEGER column
    - Add CHECK constraint: KIT subscriptions must have kit_product_id and kit_duration_days
    - Add CHECK constraint: MEAL subscriptions must have plan_id
    - _Requirements: 7.1, 9.2_
  
  - [x] 1.4 Seed initial three KIT products
    - Write SQL seed script in `scripts/seed-initial-kit-products.sql`
    - Insert Weightloss Platinum (₹28,080.00)
    - Insert Weightloss Premium (₹19,760.00)
    - Insert Weightloss Prime (₹10,400.00)
    - All products with tax_rate = 0.05 and is_active = true
    - _Requirements: 1.2_

- [x] 2. Checkpoint - Verify database schema
  - Run all migration scripts and verify tables created successfully
  - Check constraints are enforced properly
  - Verify seed data inserted correctly
  - Ask the user if questions arise

- [x] 3. Implement KIT product management types and actions
  - [x] 3.1 Create TypeScript types for KIT products
    - Create `src/types/kitProduct.ts` with KitProduct interface
    - Define fields: id, name, base_price, tax_rate, created_at, is_active
    - Export type definitions for use across the application
    - _Requirements: 1.3, 1.4_
  
  - [x] 3.2 Create server actions for KIT product management
    - Create `src/actions/admin-actions/kitProductActions.ts`
    - Implement `createKitProductAction(name: string, price: number)` with server-side validation
    - Implement `listKitProductsAction()` to fetch all active products
    - Implement `calculateKitTax(basePrice: number)` utility function (basePrice * 0.05)
    - Use createAdminClient for database operations
    - Add proper error handling and return types
    - _Requirements: 1.3, 1.5, 9.1_
  
  - [x]* 3.3 Write unit tests for tax calculation logic
    - Create `src/actions/admin-actions/__tests__/kitProductActions.test.ts`
    - Test calculateKitTax with various price inputs
    - Test total price calculation (base + tax)
    - Test edge cases (zero, negative, very large numbers)
    - _Requirements: 1.5, 10.1_

- [x] 4. Build KIT products admin UI
  - [x] 4.1 Create KIT products list page
    - Create `src/app/admin/(main)/subscriptions/kits/page.tsx` as Server Component
    - Fetch active KIT products using listKitProductsAction
    - Display products in grid layout with card design
    - Show product name, base price, calculated tax, and total price
    - Add button to open create product dialog
    - _Requirements: 1.1, 1.2, 1.5_
  
  - [x] 4.2 Create KIT product card component
    - Create `src/app/admin/(main)/subscriptions/kits/KitProductCard.tsx`
    - Display product name, base price formatted as currency
    - Calculate and display tax amount (5%) and total price
    - Use Shadcn Card components for consistent styling
    - _Requirements: 1.2, 1.5_
  
  - [x] 4.3 Create add KIT product dialog
    - Create `src/app/admin/(main)/subscriptions/kits/AddKitProductDialog.tsx` as Client Component
    - Build form with name (text input) and price (number input) fields
    - Use React Hook Form with Zod validation schema
    - Validate name is non-empty, price is positive number
    - Call createKitProductAction on form submission
    - Show success/error toast notifications
    - Revalidate product list after successful creation
    - _Requirements: 1.3_
  
  - [-] 4.4 Add KITs submenu to admin navigation
    - Modify `src/app/admin/(main)/layout.tsx` or navigation component
    - Add "KITs" link under Subscriptions menu section
    - Route to `/admin/subscriptions/kits`
    - _Requirements: 1.1_

- [x] 5. Checkpoint - Test KIT product management UI
  - Verify KITs menu appears in admin navigation
  - Verify three initial products display correctly
  - Test creating new KIT product through dialog
  - Verify tax calculations display correctly
  - Ask the user if questions arise

- [x] 6. Extend Quick Onboarding validation and types
  - [x] 6.1 Extend onboarding Zod schema for KIT category
    - Modify `src/validations/onboardingSchema.ts`
    - Add optional fields: kitProductId (UUID string), kitDurationDays (positive integer)
    - Make planId conditional based on primaryCategory
    - When primaryCategory = 'KIT': require kitProductId and kitDurationDays, make planId optional
    - When primaryCategory = 'MEAL': require planId, make KIT fields optional
    - _Requirements: 2.1, 2.2, 2.3_
  
  - [x] 6.2 Create address validation service with category awareness
    - Create `src/lib/address/validatePincode.ts`
    - Implement `validateAddressForCategory(address: Address, category: CustomerCategory)` function
    - For KIT category: validate only PIN format (6 digits), skip serviceability check
    - For MEAL category: validate format AND enforce serviceability check
    - Return appropriate validation result object
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  
  - [x]* 6.3 Write property test for PIN validation bypass
    - Create `src/lib/address/__tests__/validatePincode.test.ts`
    - **Property 4: PIN Code Validation Bypass for KIT Customers**
    - **Validates: Requirements 3.1, 3.2, 3.3**
    - Use fast-check to generate random 6-digit PINs (100 iterations)
    - Verify KIT category accepts all valid PIN formats
    - Verify MEAL category enforces serviceability rules
    - Test that non-serviceable PINs are rejected for MEAL but accepted for KIT

- [x] 7. Modify Quick Onboarding Step 2 for category selection
  - [x] 7.1 Update Step 2 subscription form component
    - Modify `src/app/admin/(main)/customers/quick-onboard/Step2SubscriptionForm.tsx`
    - Add conditional rendering based on primaryCategory state
    - When category = 'KIT': show Kit name dropdown (fetched from listKitProductsAction)
    - When category = 'KIT': show Days text field for kit_duration_days input
    - When category = 'MEAL': show existing Plan dropdown
    - Keep meal preference selection (Veg, Egg, Chicken) visible for all categories
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  
  - [x] 7.2 Implement Kit name dropdown with pricing display
    - Modify Step2SubscriptionForm to fetch active KIT products
    - Populate dropdown with product names and formatted prices
    - Display format: "Product Name - ₹XX,XXX.XX"
    - Store selected kitProductId in form state
    - _Requirements: 2.2_

- [x] 8. Modify Quick Onboarding Step 3 for address validation bypass
  - [x] 8.1 Update Step 3 address form validation logic
    - Modify `src/app/admin/(main)/customers/quick-onboard/Step3AddressForm.tsx`
    - Pass primaryCategory to address validation function
    - Call validateAddressForCategory instead of direct serviceability check
    - For KIT category: allow any valid 6-digit PIN without serviceability error
    - For MEAL category: enforce existing PIN serviceability validation
    - Update error messages to be category-appropriate
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 9. Modify Quick Onboarding Step 4 for KIT payment and review
  - [x] 9.1 Update Step 4 payment review to show KIT-specific information
    - Modify `src/app/admin/(main)/customers/quick-onboard/Step4PaymentReview.tsx`
    - When category = 'KIT': display kit product name, base price, tax amount (5%), total price
    - When category = 'MEAL': display existing plan information
    - Keep payment status selection unchanged
    - _Requirements: 4.1_
  
  - [x] 9.2 Implement payment-gated completion for KIT customers
    - Modify Step 4 completion logic
    - Disable "Complete Onboarding" button when payment status != 'PAID'
    - Show tooltip: "Payment must be marked as PAID before completing onboarding"
    - Enable button only when payment status = 'PAID'
    - _Requirements: 4.2, 4.3_

- [x] 10. Modify onboarding server action for category-based logic
  - [x] 10.1 Update onboardCustomerAction to handle KIT category
    - Modify `src/actions/admin-actions/onboardingActions.ts`
    - Branch logic based on input.primaryCategory
    - For KIT category: validate kitProductId and kitDurationDays fields
    - For KIT category: skip PIN code serviceability validation
    - For KIT category: create subscription with kit_product_id and kit_duration_days
    - For KIT category: set customer_category = 'KIT' in customer_profiles
    - For MEAL category: use existing validation and creation logic
    - Ensure transaction consistency for all database inserts
    - _Requirements: 2.1, 3.1, 4.4, 7.1, 7.2, 9.2_
  
  - [x]* 10.2 Write property test for category-correct record creation
    - Create test file for onboarding actions
    - **Property 5: Category-Correct Customer Record Creation**
    - **Validates: Requirements 4.4, 9.2**
    - Generate random valid KIT onboarding payloads (100 iterations)
    - Execute onboarding action
    - Verify created customer has customer_category = 'KIT'
    - Verify subscription references valid kit_product_id
    - Verify no meal subscription artifacts created

- [x] 11. Checkpoint - Test complete KIT onboarding flow
  - Test category selection in Step 2
  - Verify Kit dropdown shows all products with prices
  - Test Days field accepts valid integers
  - Test address validation accepts non-serviceable PINs for KIT
  - Verify payment review shows correct KIT product details
  - Test completion button disabled until payment = PAID
  - Verify customer created with correct category
  - Ask the user if questions arise

- [x] 12. Implement shipping information types and actions
  - [x] 12.1 Create TypeScript types for shipping information
    - Create `src/types/kitShipping.ts`
    - Define CourierPartner type: 'OTHER' | 'APSRTC' | 'TGSRTC' | 'DTDC'
    - Define ShippingInfo interface with all fields
    - Export types for use across components
    - _Requirements: 6.2, 9.4_
  
  - [x] 12.2 Create server actions for shipping management
    - Create `src/actions/admin-actions/shippingActions.ts`
    - Implement `saveShippingInfoAction(customerId: string, shippingData: ShippingInfo)`
    - Implement `getShippingInfoAction(customerId: string)`
    - Validate tracking_url required when courier_partner = 'OTHER'
    - Use createAdminClient for database operations
    - Handle database constraint errors gracefully
    - _Requirements: 6.5, 9.4_
  
  - [x]* 12.3 Write property test for tracking URL enforcement
    - Create `src/actions/admin-actions/__tests__/shippingActions.test.ts`
    - **Property 7: Courier-Specific Tracking URL Enforcement**
    - **Validates: Requirements 6.3, 6.4**
    - Generate shipping records with various courier combinations (100 iterations)
    - When courier = 'OTHER': verify tracking_url is required
    - When courier != 'OTHER': verify tracking_url is optional
    - Test database constraint prevents invalid records

- [x] 13. Build shipping dashboard UI
  - [x] 13.1 Create shipping dashboard page
    - Create `src/app/admin/(main)/customers/[id]/shipping/page.tsx` as Server Component
    - Fetch customer profile and subscription data
    - Verify customer has category = 'KIT'
    - Fetch existing shipping information if available
    - Pass data to CourierForm component
    - _Requirements: 5.3, 6.1_
  
  - [x] 13.2 Create courier form component
    - Create `src/app/admin/(main)/customers/[id]/shipping/CourierForm.tsx` as Client Component
    - Build form with courier partner dropdown, tracking number input, conditional tracking URL field
    - Populate dropdown with exactly: Other shipping, APSRTC Logistics, TGSRTC Logistics, DTDC
    - Show tracking URL field only when courier = 'Other shipping'
    - Use React Hook Form with Zod validation
    - Validate tracking URL required when courier = 'Other shipping'
    - Call saveShippingInfoAction on form submission
    - Show success/error notifications
    - _Requirements: 6.2, 6.3, 6.4, 6.5_
  
  - [x] 13.3 Add shipped_at and delivered_at date fields
    - Add optional date picker fields to CourierForm
    - Use React Day Picker for date selection
    - Store timestamps in shipping info record
    - Display in admin-friendly format
    - _Requirements: 9.4_

- [x] 14. Extend customer list with shipping button
  - [x] 14.1 Modify customer list to show category-based actions
    - Modify `src/app/admin/(main)/customers/page.tsx` or CustomerListItem component
    - Conditionally render "Shipping" button for customers with category = 'KIT'
    - Hide "Shipping" button for customers with category = 'MEAL'
    - Use Truck icon from lucide-react
    - Link to `/admin/customers/[id]/shipping` route
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 15. Checkpoint - Test shipping management workflow
  - Verify Shipping button appears only for KIT customers
  - Test opening shipping dashboard
  - Verify courier dropdown has exactly 4 options
  - Test URL field shows only for "Other shipping"
  - Test saving shipping information
  - Verify validation prevents saving "Other shipping" without URL
  - Ask the user if questions arise

- [x] 16. Implement customer portal category-based view selection
  - [x] 16.1 Create KIT-specific customer dashboard component
    - Create `src/app/customer/(main)/dashboard/KitDashboard.tsx` as Server Component
    - Fetch customer's KIT subscription data
    - Display KIT product name, purchase date, duration
    - Fetch and display shipping status information
    - Show order status (paid, shipped, delivered)
    - Hide all meal subscription UI elements
    - _Requirements: 8.1, 8.3_
  
  - [x] 16.2 Create shipping status display component
    - Create `src/app/customer/(main)/dashboard/ShippingTracker.tsx`
    - Display courier partner name
    - Display tracking number
    - For 'OTHER' courier: display clickable tracking URL link
    - For other couriers: generate tracking URL based on courier partner
    - Show shipping and delivery timestamps if available
    - Use timeline or status bar visualization
    - _Requirements: 8.3_
  
  - [x] 16.3 Modify customer dashboard to route based on category
    - Modify `src/app/customer/(main)/dashboard/page.tsx`
    - Fetch current customer profile and subscriptions
    - Determine primary category from active subscription
    - If category = 'KIT': render KitDashboard component
    - If category = 'MEAL': render existing MealDashboard component
    - Ensure complete isolation of category-specific UI
    - _Requirements: 8.1, 8.2, 8.4_

- [x] 17. Implement business logic isolation safeguards
  - [x] 17.1 Add category checks to meal subscription operations
    - Audit existing meal subscription server actions
    - Add category validation to prevent KIT customers from accessing meal operations
    - Actions to protect: pause/resume, daily preferences updates, delivery address changes
    - Return appropriate error: "This operation is only available for meal subscriptions"
    - _Requirements: 7.2, 7.5_
  
  - [x] 17.2 Add category checks to KIT operations
    - Add category validation to shipping and KIT-specific actions
    - Prevent MEAL customers from accessing KIT operations
    - Return appropriate error: "This operation is only available for KIT subscriptions"
    - _Requirements: 7.3_
  
  - [x]* 17.3 Write property tests for business rule isolation
    - Create integration test file for category isolation
    - **Property 8: Business Rule Isolation for KIT Customers**
    - **Validates: Requirements 7.2, 7.5**
    - Generate KIT customer data, verify no meal artifacts created
    - Verify KIT customers cannot trigger meal subscription operations
    - **Property 9: Business Rule Isolation for MEAL Customers**
    - **Validates: Requirements 7.3**
    - Generate MEAL customer data, verify no KIT artifacts created
    - Verify MEAL customers cannot trigger KIT operations

- [x] 18. Implement invoice generation for KIT orders
  - [x] 18.1 Create KIT invoice generation function
    - Create or modify invoice generation logic in `src/lib/invoices/`
    - Branch logic based on subscription category
    - For KIT orders: fetch kit_product details
    - Calculate tax amount as base_price * 0.05
    - Display base price, tax amount (5%), and total separately
    - Include kit product name and duration in invoice details
    - Use existing invoice template infrastructure
    - _Requirements: 10.1, 10.2, 10.3_
  
  - [x] 18.2 Add payment status check for invoice generation
    - Ensure invoices only generated for orders marked as 'PAID'
    - Display error if attempting to generate invoice for unpaid order
    - _Requirements: 10.4_

- [x] 19. Add database Row Level Security policies for KIT tables
  - [x] 19.1 Create RLS policies for kit_products table
    - Write SQL script in `scripts/create-kit-products-rls-policies.sql`
    - Admin users: full read/write access
    - Customers: read-only access to active products
    - Apply policies and enable RLS on table
    - _Requirements: Security considerations_
  
  - [x] 19.2 Create RLS policies for kit_shipping_info table
    - Write SQL script in `scripts/create-kit-shipping-rls-policies.sql`
    - Admin users: full read/write access
    - Customers: read-only access to their own shipping information
    - Filter by customer_profile_id matching authenticated user
    - Apply policies and enable RLS on table
    - _Requirements: Security considerations, 8.3_

- [x] 20. Final checkpoint and integration testing
  - Verify complete KIT onboarding workflow end-to-end
  - Test KIT customer cannot access meal subscription features
  - Test MEAL customer cannot access KIT features
  - Verify shipping information appears in customer portal
  - Test invoice generation with correct tax calculations
  - Verify database constraints prevent invalid data states
  - Run property-based tests (minimum 100 iterations each)
  - Ensure all tests pass, ask the user if questions arise

## Notes

- Tasks marked with `*` are optional testing tasks that can be skipped for faster MVP delivery
- Each task references specific requirements for complete traceability
- The implementation maintains strict separation between KIT and MEAL business logic using the customer_category discriminator
- All database operations use Supabase client with appropriate RLS policies
- Server Components are used by default, with Client Components only for interactive forms
- Zod validation schemas provide runtime type safety for all form inputs and server actions
- The codebase follows Next.js 16 App Router conventions with Server Actions for mutations
- Property-based tests use fast-check library with minimum 100 iterations per property
- Checkpoints ensure incremental validation and allow for user feedback between major phases

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "3.1"] },
    { "id": 2, "tasks": ["3.2", "12.1"] },
    { "id": 3, "tasks": ["3.3", "4.1", "6.1", "12.2"] },
    { "id": 4, "tasks": ["4.2", "4.3", "6.2", "12.3"] },
    { "id": 5, "tasks": ["4.4", "6.3", "7.1"] },
    { "id": 6, "tasks": ["7.2", "8.1", "13.1"] },
    { "id": 7, "tasks": ["9.1", "9.2", "13.2", "13.3"] },
    { "id": 8, "tasks": ["10.1", "14.1"] },
    { "id": 9, "tasks": ["10.2", "16.1"] },
    { "id": 10, "tasks": ["16.2", "17.1"] },
    { "id": 11, "tasks": ["16.3", "17.2", "19.1"] },
    { "id": 12, "tasks": ["17.3", "18.1", "19.2"] },
    { "id": 13, "tasks": ["18.2"] }
  ]
}
```
