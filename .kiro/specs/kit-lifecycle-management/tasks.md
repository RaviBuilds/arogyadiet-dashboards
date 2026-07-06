# Implementation Plan: KIT Lifecycle Management

## Overview

This plan implements the full KIT lifecycle management system: automated expiration cron, admin expired filtering and Send New KIT workflow, customer-facing arrival/start/expiration flows, KIT History page, and PDF report generation. Tasks are structured to build incrementally from data layer → services → actions → UI components.

## Tasks

- [x] 1. Database migration and type foundations
  - [x] 1.1 Create database migration script for KIT lifecycle support
    - Create `scripts/add-kit-lifecycle-support.sql`
    - Add `kit_report_cache` table with columns: id (UUID PK), subscription_id (UUID FK UNIQUE), pdf_data (BYTEA), generated_at (TIMESTAMPTZ)
    - Add `CREATE UNIQUE INDEX IF NOT EXISTS uq_active_subscription_per_category` partial unique index on subscriptions(customer_profile_id, customer_category) WHERE status IN ('PENDING', 'ACTIVE')
    - Add appropriate comments on the new table
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 1.2 Create KIT lifecycle TypeScript types
    - Create `src/types/kitLifecycle.ts`
    - Define `KitSubscriptionStatus`, `KitSubscriptionSummary`, `KitHistoryEntry`, `SendNewKitInput`, `KitEligibility`, `ExpireCronsResult` interfaces as specified in the design
    - Export all types for use across services, actions, and components
    - _Requirements: 11.1, 11.6, 11.7_

  - [x] 1.3 Create Zod validation schemas for KIT lifecycle
    - Create `src/validations/kitLifecycleSchema.ts`
    - Define `sendNewKitSchema` with: kitProductId (UUID), kitDurationDays (integer 1-365), mealPreference (enum Veg/Egg/Chicken), addressId (UUID), newAddress (optional object with addressLine min 5 chars, city, state, pinCode exactly 6 digits), courierPartner (enum OTHER/APSRTC/TGSRTC/DTDC), trackingNumber (min 1 char), trackingUrl (optional, required when courierPartner is OTHER)
    - Define `startNewKitSchema` with: subscriptionId (UUID), startDate (ISO date string)
    - _Requirements: 4.3, 4.5, 4.6, 4.7_

- [x] 2. Repository layer
  - [x] 2.1 Create KIT lifecycle repository
    - Create `src/repositories/kitLifecycleRepository.ts`
    - Implement `findExpiredKitSubscriptions(currentISTDate: string)`: query subscriptions WHERE status='ACTIVE', customer_category='KIT', kit_received_date IS NOT NULL, and computed tracker_end_date < currentISTDate
    - Implement `batchUpdateStatus(ids: string[], newStatus: string)`: atomically update all matching subscription IDs to the new status
    - Implement `hasActiveOrPending(customerProfileId: string)`: check if customer has any PENDING or ACTIVE KIT subscription
    - Implement `createKitSubscription(data)`: insert new subscription with status PENDING
    - Implement `createShippingInfo(data)`: insert kit_shipping_info record
    - Implement `getKitHistory(customerProfileId: string)`: fetch all KIT subscriptions with joined kit_products, kit_daily_logs counts, and kit_shipping_info
    - Implement `getSubscriptionWithOwner(subscriptionId: string)`: fetch subscription with customer_profile_id for authorization
    - Implement `getDailyLogsForSubscription(subscriptionId: string)`: fetch all kit_daily_logs for a subscription ordered by log_date
    - Implement `getCachedReport(subscriptionId: string)`: fetch from kit_report_cache
    - Implement `saveCachedReport(subscriptionId: string, pdfData: Buffer)`: insert/upsert into kit_report_cache
    - Implement `markKitDelivered(subscriptionId: string)`: update kit_shipping_info.delivered_at
    - Implement `startKit(subscriptionId: string, startDate: string, endDate: string)`: update kit_received_date, kit_tracker_end_date, status='ACTIVE'
    - Implement `getMostRecentKitSubscription(customerProfileId: string)`: get latest KIT subscription by created_at
    - Implement `getShippingInfo(subscriptionId: string)`: fetch kit_shipping_info for a subscription
    - Implement `getCustomerKitSubscriptions(customerProfileId: string)`: fetch all KIT subscriptions ordered by created_at DESC for customer-facing display
    - Use Supabase client with appropriate admin/server client patterns
    - _Requirements: 1.2, 1.3, 2.1, 2.3, 8.2, 8.3, 11.5, 11.6, 11.7, 12.1_

  - [x]* 2.2 Write property tests for repository query logic (expiration filter)
    - **Property 1: Expiration Filter Biconditional**
    - **Validates: Requirements 1.2, 1.7**
    - Create `src/repositories/__tests__/kitLifecycleRepository.property.test.ts`
    - Use fast-check to generate random subscription records with varying status, category, kit_received_date, and tracker_end_date
    - Verify filter selects a record IFF status=ACTIVE, category=KIT, kit_received_date not null, and current_date > tracker_end_date

- [x] 3. Service layer — KIT Lifecycle Service
  - [x] 3.1 Implement KitLifecycleService — expiration logic
    - Create `src/services/KitLifecycleService.ts`
    - Implement `expireEligibleKits()`: call repository to find expired subscriptions, then batch update to EXPIRED
    - Ensure IST date computation using date-fns (UTC+5:30 offset)
    - Return `ExpireCronsResult` with success flag and count
    - Handle empty result (0 expired) as success
    - _Requirements: 1.2, 1.3, 1.6, 1.7, 1.8, 12.1_

  - [x] 3.2 Implement KitLifecycleService — eligibility check
    - Implement `checkEligibility(customerProfileId: string)`: determine if Send New KIT button should show
    - Check most recent KIT subscription status and days remaining
    - Return eligible=true when: (a) most recent is EXPIRED, OR (b) most recent is ACTIVE with ≤5 days remaining, AND no PENDING exists, AND at least one KIT subscription exists
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 3.3 Implement KitLifecycleService — create new KIT
    - Implement `createNewKit(input: SendNewKitInput)`: validate no existing PENDING/ACTIVE, create subscription + shipping info
    - Set subscription status=PENDING, associate kit_product_id, kit_duration_days, meal_preference
    - Create kit_shipping_info with courier_partner, tracking_number, tracking_url, shipped_at=NOW()
    - Return subscriptionId on success or error message
    - _Requirements: 4.9, 4.10, 4.11, 4.12, 11.3, 11.4_

  - [x] 3.4 Implement KitLifecycleService — mark received and start KIT
    - Implement `markKitReceived(subscriptionId, customerId)`: validate ownership + category, set delivered_at timestamp
    - Implement `startNewKit(subscriptionId, startDate, customerId)`: validate date bounds, check no other ACTIVE KIT, compute end_date = startDate + (duration - 1) + skipped_days, update record to ACTIVE
    - Validate startDate ≤ current IST date AND startDate ≥ delivered_at date
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 3.5 Implement KitLifecycleService — KIT history
    - Implement `getKitHistory(customerProfileId: string)`: fetch all KIT subscriptions, compute derived fields (daysTakenMeal, shippingStatus, canDownloadReport)
    - Derive shippingStatus: "Not Shipped" | "Shipped" | "Delivered" from kit_shipping_info timestamps
    - Set canDownloadReport=false for PENDING subscriptions
    - Order by created_at descending
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x]* 3.6 Write property tests for KitLifecycleService
    - Create `src/services/__tests__/kitLifecycle.property.test.ts`
    - **Property 5: Send New KIT Eligibility** — generate subscription histories, verify eligibility function returns correct result
    - **Property 12: Start KIT Computes Correct End Date** — generate random duration/skipped values, verify end_date = received_date + (duration - 1) + skipped
    - **Property 14: Shipping Status Derivation** — generate random shipped_at/delivered_at combinations, verify status derivation
    - **Validates: Requirements 3.1-3.6, 6.4, 8.5**

- [x] 4. Service layer — KIT Report Service
  - [x] 4.1 Implement KitReportService — PDF generation
    - Create `src/services/KitReportService.ts`
    - Install `@react-pdf/renderer` dependency (add to package.json)
    - Implement `generateReport(subscriptionId, customerProfileId)`: authorize ownership, fetch subscription + daily logs + customer name
    - For ACTIVE KIT: generate PDF from kit_received_date through current date (dynamic)
    - For EXPIRED KIT: check cache first, generate if not cached, cache after generation
    - Return PDF as Buffer
    - _Requirements: 9.1, 9.5, 10.1, 10.4, 9.7, 12.3_

  - [x] 4.2 Create PDF document template components
    - Create PDF React components using @react-pdf/renderer (Document, Page, View, Text, StyleSheet)
    - Header section: customer name, KIT product name, duration, start date, status
    - Day-wise entries: date, status, all activity/nutrition fields for FOOD_TAKEN, date+status only for FOOD_SKIPPED, "No Data Logged" for missing days
    - Summary section (EXPIRED only): total days taken meal, total days skipped, total duration, completion date
    - _Requirements: 9.2, 9.3, 9.4, 10.2, 10.3_

  - [x]* 4.3 Write property tests for KitReportService
    - Create `src/services/__tests__/kitReport.property.test.ts`
    - **Property 16: Report Date Range Coverage** — generate random date ranges, verify all days from start to end (or current) are covered
    - **Property 17: Report Daily Log Formatting** — generate daily log variants, verify correct formatting rules applied
    - **Property 18: Report Summary Totals Correctness** — generate random log sets, verify computed totals match expectations
    - **Validates: Requirements 9.1, 9.2, 9.3, 10.1, 10.2, 10.3**

- [x] 5. Checkpoint — Core services complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Server Actions
  - [x] 6.1 Create admin KIT lifecycle actions
    - Create `src/actions/admin-actions/kitLifecycleActions.ts`
    - Implement `sendNewKitAction(formData)`: validate with Zod schema, call KitLifecycleService.createNewKit, return success/error
    - Implement `checkKitEligibilityAction(customerProfileId)`: call KitLifecycleService.checkEligibility
    - Implement `getExpiredKitCustomersAction()`: query for KIT customers with most recent EXPIRED status
    - Use `createAdminClient` for admin-level operations
    - _Requirements: 4.9, 4.10, 4.11, 4.12, 3.1-3.6, 2.1, 2.3_

  - [x] 6.2 Create customer KIT lifecycle actions
    - Create `src/actions/kitLifecycleActions.ts`
    - Implement `markKitReceivedAction(subscriptionId)`: authenticate customer, call service
    - Implement `startNewKitAction(subscriptionId, startDate)`: authenticate customer, validate with Zod, call service
    - Implement `getKitHistoryAction()`: authenticate customer, get profile, call service
    - Implement `getKitTrackerStateAction()`: determine which display state to show on KIT Tracker page (priority: start flow → receipt flow → expiration message)
    - Use server-side auth to get customer_profile_id
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.3, 7.4, 7.5_

  - [x]* 6.3 Write property tests for actions layer
    - Create `src/actions/__tests__/kitLifecycle.property.test.ts`
    - **Property 6: KIT Duration Validation** — generate random integers, verify Zod accepts only 1-365
    - **Property 7: Address Validation** — generate random strings/numbers, verify addressLine ≥5 chars and pinCode exactly 6 digits
    - **Property 9: KIT Tracker Display State Machine** — generate subscription state combinations, verify priority-based display selection
    - **Property 11: Start Date Validation Bounds** — generate random dates relative to delivered_at and today, verify acceptance rules
    - **Validates: Requirements 4.3, 4.6, 5.2-5.4, 6.3, 7.1-7.5**

- [x] 7. API Routes
  - [x] 7.1 Create expiration cron API route
    - Create `src/app/api/cron/expire-kits/route.ts`
    - Implement GET handler: validate CRON_SECRET query parameter, call KitLifecycleService.expireEligibleKits
    - Return 401 for invalid secret, 500 for errors (with rollback), 200 with expired count on success
    - _Requirements: 1.1, 1.4, 1.5, 1.6, 1.8_

  - [x] 7.2 Create PDF report API route
    - Create `src/app/api/kit-report/[subscriptionId]/route.ts`
    - Implement GET handler: authenticate customer via session, call KitReportService.generateReport
    - Return 403 for authorization failure or category mismatch, 404 for not found, 400 for PENDING subscriptions
    - Set Content-Type: application/pdf and Content-Disposition for download
    - Handle 30s timeout with 500 error
    - _Requirements: 9.1, 9.6, 9.7, 10.1, 10.5, 10.6, 12.3_

  - [x] 7.3 Update vercel.json with expire-kits cron schedule
    - Add new cron entry for `/api/cron/expire-kits?secret=arogyadietcron-123` at schedule `0 18 * * *` (approximately 18:00 UTC = 23:30 IST)
    - _Requirements: 1.1_

- [x] 8. Checkpoint — Backend complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Admin Portal — Expired filtering UI
  - [x] 9.1 Add "Show Expired" toggle to KIT Customer List
    - Modify `src/shared/components/admin/customers/KitCustomerSection.tsx`
    - Add "Show Expired" toggle button adjacent to existing "Show Archived" button
    - Use same Button component and size, "default" variant when active, "outline" when inactive
    - Toggles operate independently — both can be active simultaneously
    - When "Show Expired" active: display only customers whose most recent KIT subscription is EXPIRED
    - When both active: display union of archived + expired customers (each appearing at most once)
    - Show existing empty-state message when no matching customers
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 12.4_

- [x] 10. Admin Portal — Send New KIT workflow
  - [x] 10.1 Add KIT eligibility badge and Send New KIT button to Customer 360
    - Modify `src/shared/components/admin/customers/Customer360Dashboard.tsx`
    - Create `src/shared/components/admin/customers/KitEligibilityBadge.tsx`
    - Call `checkKitEligibilityAction` on load to determine button visibility
    - Show "Send New KIT" button when eligible (expired OR ≤5 days remaining, no PENDING)
    - Hide button when not eligible (>5 days remaining, PENDING exists, no KIT subscriptions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 10.2 Create Send New KIT multi-section workflow form
    - Create `src/shared/components/admin/customers/SendNewKitForm.tsx`
    - KIT Product section: dropdown of active kit_products with name and price
    - KIT Duration section: number input (1-365)
    - Meal Preference section: radio/select with Veg, Egg, Chicken options
    - Address section: list customer's existing addresses + "Add new address" option with inline fields
    - Shipping section: courier partner dropdown (Other shipping, APSRTC Logistics, TGSRTC Logistics, DTDC), tracking number input, tracking URL (shown/required only when "Other shipping")
    - Payment section: "Mark as Paid" toggle switch
    - Submit button disabled until all required fields complete
    - Use React Hook Form + Zod schema for validation
    - On submit: call `sendNewKitAction`, show success or preserve form on error
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12_

  - [x]* 10.3 Write property tests for Send New KIT form validation
    - **Property 8: Form Submission Creates Correct Records**
    - **Property 21: At-Most-One Active/Pending Constraint**
    - **Validates: Requirements 4.9, 4.10, 11.2, 11.3, 11.4**
    - Verify valid form input with no existing PENDING/ACTIVE creates correct subscription+shipping records
    - Verify attempting to create when PENDING exists is rejected

- [x] 11. Customer Portal — New KIT arrival and start flow
  - [x] 11.1 Create KIT arrival notification banner
    - Create `src/shared/components/customer/kit-tracker/NewKitArrivalBanner.tsx`
    - Display "New KIT has been sent" message with shipping info
    - Show "Mark as KIT Received" button when shipped_at set and delivered_at null
    - Show "order being processed" message when no shipping info
    - _Requirements: 5.2, 5.3, 5.4_

  - [x] 11.2 Create Start New KIT flow component
    - Create `src/shared/components/customer/kit-tracker/StartNewKitFlow.tsx`
    - Display date picker calendar (React Day Picker) defaulting to current IST date
    - Disable future dates and dates before delivered_at
    - "Start New KIT" button calls `startNewKitAction`
    - On success: transition to Daily Tracker Calendar
    - On error: show error message, preserve selected date
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 11.3 Create KIT expiration message component
    - Create `src/shared/components/customer/kit-tracker/KitExpirationMessage.tsx`
    - Display "KIT has been expired, contact the admin to issue new KIT" message
    - Include "Contact Admin" CTA button linking to WhatsApp support (same URL pattern as FloatingSupportMenu)
    - _Requirements: 7.1, 7.2_

  - [x] 11.4 Integrate lifecycle state handling into KIT Tracker page
    - Modify `src/app/customer/(main)/kit-tracker/page.tsx`
    - Call `getKitTrackerStateAction` to determine display state
    - Priority order: (1) new KIT received → StartNewKitFlow, (2) new KIT shipped → NewKitArrivalBanner, (3) expired with no new KIT → KitExpirationMessage, (4) active → existing Daily Tracker
    - _Requirements: 7.3, 7.4, 7.5_

  - [x] 11.5 Update Customer Dashboard with new KIT shipping info
    - Modify `src/app/customer/(main)/dashboard/KitDashboard.tsx`
    - When customer has EXPIRED KIT and a newer PENDING subscription: display new KIT's shipping and product info instead of expired KIT details
    - _Requirements: 5.1, 5.2_

- [x] 12. Checkpoint — Customer arrival/start flow complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Customer Portal — KIT History page
  - [x] 13.1 Create KIT History page and table component
    - Create `src/app/customer/(main)/kit-history/page.tsx` as server component
    - Create `src/shared/components/customer/kit-history/KitHistoryTable.tsx`
    - Fetch KIT history via `getKitHistoryAction`
    - Display table with columns: Order Date, KIT Package Name, KIT Days, Days Taken Meal, Days Skipped, KIT Status (color badges), Shipping Status, Kit Report (PDF icon)
    - ACTIVE=green badge, PENDING=yellow badge, EXPIRED=gray badge
    - Disable PDF icon for PENDING subscriptions
    - Show empty state message when no KIT subscriptions
    - Responsive cards layout for viewports < 768px
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [x] 13.2 Create PDF download button component
    - Create `src/shared/components/customer/kit-history/KitReportDownloadButton.tsx`
    - Trigger download from `/api/kit-report/[subscriptionId]` endpoint
    - Show loading indicator during generation
    - Handle error states (display error message)
    - Disabled state for PENDING subscriptions
    - _Requirements: 9.1, 9.6, 10.5, 10.6_

  - [x] 13.3 Add KIT History navigation item to customer sidebar
    - Modify `src/shared/components/layout/customer-sidebar.tsx`
    - Add "KIT History" nav item in the KIT TRACKER section
    - Visible only to customers with customer_category "KIT"
    - Link to `/customer/kit-history`
    - _Requirements: 8.1_

  - [x]* 13.4 Write property tests for KIT History data
    - **Property 15: KIT History Ordering** — generate sets of KIT subscriptions, verify descending created_at order
    - **Property 4: KIT Customer List Filter Correctness** — generate customers with varying statuses, verify default vs expired filter
    - **Property 22: Data Isolation Per Subscription Period** — verify daily logs and shipping info are scoped to specific subscription_id
    - **Property 23: Category Isolation** — verify only KIT subscriptions are processed
    - **Validates: Requirements 8.2, 2.1, 2.3, 2.6, 11.6, 11.7, 12.1-12.6**

- [x] 14. Integration and wiring
  - [x] 14.1 Wire all components together and verify end-to-end flows
    - Verify cron endpoint → service → repository chain works
    - Verify admin Send New KIT → customer arrival → start flow chain works
    - Verify KIT History page loads and PDF download triggers correctly
    - Verify "Show Expired" toggle on admin list filters correctly
    - Ensure all cross-component state transitions are coherent
    - _Requirements: 1.1-1.8, 4.9-4.10, 6.4, 8.2-8.5_

  - [x]* 14.2 Write integration tests for critical flows
    - Test expiration cron end-to-end with mock Supabase client
    - Test Send New KIT action with eligibility guard
    - Test mark received → start KIT → verify ACTIVE transition
    - Test PDF generation for both ACTIVE and EXPIRED subscriptions
    - **Property 2: Expiration Idempotence** — run cron twice on same data, verify second returns 0
    - **Property 3: Atomicity of Batch Expiration** — verify all-or-nothing batch update
    - **Property 13: Start KIT Rejected With Existing ACTIVE** — verify rejection when ACTIVE exists
    - **Property 19: PDF Authorization** — verify only owner can download
    - **Property 20: Expired Report Caching Idempotence** — verify cache hit on second request
    - **Validates: Requirements 1.3, 1.5, 1.8, 6.5, 9.7, 10.4**

- [x] 15. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The `@react-pdf/renderer` package needs to be installed as part of task 4.1
- IST date computation (UTC+5:30) is critical for expiration logic and date validation
- All server actions must authenticate the calling user before performing operations
- The partial unique index ensures data integrity at the database level for the one-active-or-pending constraint

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "3.2", "3.3", "3.4", "3.5"] },
    { "id": 3, "tasks": ["3.6", "4.1", "4.2"] },
    { "id": 4, "tasks": ["4.3", "6.1", "6.2"] },
    { "id": 5, "tasks": ["6.3", "7.1", "7.2", "7.3"] },
    { "id": 6, "tasks": ["9.1", "10.1"] },
    { "id": 7, "tasks": ["10.2", "11.1", "11.2", "11.3"] },
    { "id": 8, "tasks": ["10.3", "11.4", "11.5"] },
    { "id": 9, "tasks": ["13.1", "13.2", "13.3"] },
    { "id": 10, "tasks": ["13.4", "14.1"] },
    { "id": 11, "tasks": ["14.2"] }
  ]
}
```
