# Implementation Plan: Accommodation Customer Flow

## Overview

This plan implements the complete ACCOMMODATION customer category lifecycle: database schema, types/validations, service layer, server actions, cron job, customer portal pages, admin portal components, and sidebar navigation. Each task builds incrementally, wiring components together as they are created.

## Tasks

- [x] 1. Database schema and core types
  - [x] 1.1 Create database migration script for accommodation tables
    - Create `scripts/create-accommodation-tables.sql` with `stay_entries`, `customer_health_logs`, `admin_health_logs`, `addon_service_requests` tables and indexes
    - Add `medical_history_notes`, `medical_history_confirmed`, `medical_documents` columns to `customer_profiles`
    - Include all CHECK constraints, UNIQUE constraints, and foreign keys as defined in the design
    - _Requirements: 4.5, 4.6, 9.2, 5.1, 5.2, 5.3_

  - [x] 1.2 Create TypeScript types for accommodation domain
    - Create `src/types/accommodation.ts` with `StayEntry`, `CustomerHealthLog`, `AdminHealthLog`, `AddonServiceRequest` interfaces
    - Include all enums: `StayStatus`, `StayType`, `OccupancyType`, `MealPreference`, `AddonServiceStatus`
    - _Requirements: 1.1, 4.1, 9.1, 11.1_

  - [x] 1.3 Create Zod validation schemas
    - Create `src/validations/accommodationSchema.ts` with all schemas: `accommodationOnboardingSchema`, `extendStaySchema`, `createStaySchema`, `customerHealthLogSchema`, `adminHealthLogSchema`, `addonServiceRequestSchema`
    - Include superRefine for shared payment conditional logic and activity name/duration dependency
    - _Requirements: 1.2, 1.3, 1.7, 2.1, 2.2, 5.6, 9.1, 9.4, 13.5, 14.1_

- [x] 2. Repository layer
  - [x] 2.1 Create stay repository
    - Create `src/repositories/stayRepository.ts` with functions: `createStayEntry`, `getActiveStay`, `getPendingStays`, `getStayHistory`, `updateStayStatus`, `extendStay`, `getStaysForTransition`
    - Use Supabase client with proper typing
    - _Requirements: 3.4, 4.1, 4.2, 4.3, 8.1, 8.2, 8.3, 14.1, 14.3, 14.5_

  - [x] 2.2 Create health log repository
    - Create `src/repositories/healthLogRepository.ts` with functions: `upsertCustomerHealthLog`, `getCustomerHealthLogs`, `insertAdminHealthLog`, `getAdminHealthLogs`
    - Implement upsert using ON CONFLICT for customer health logs (unique on stay_entry_id + log_date)
    - _Requirements: 9.2, 9.3, 9.5, 10.1, 13.5, 13.6_

  - [x] 2.3 Create addon service repository
    - Create `src/repositories/addonServiceRepository.ts` with functions: `createServiceRequest`, `getServiceRequests`, `updateServiceStatus`
    - _Requirements: 11.2, 11.3_

- [x] 3. Service layer
  - [x] 3.1 Implement AccommodationService core logic
    - Create `src/services/AccommodationService.ts` with `calculateGstBreakup`, `computeEndDate`, `determineInitialStatus`, `transitionStatus` functions
    - Implement VALID_TRANSITIONS map and enforcement logic
    - _Requirements: 4.1, 4.5, 4.6, 5.1, 5.2, 5.3_

  - [ ]* 3.2 Write property tests for GST breakup (Property 1)
    - **Property 1: GST Breakup Invariant**
    - Test that for any amount in [1, 9999999], baseAmount + taxAmount equals totalAmount within ±0.01
    - Use fast-check with minimum 100 iterations
    - Create `src/services/__tests__/AccommodationService.property.test.ts`
    - **Validates: Requirements 5.1, 5.2, 14.6**

  - [ ]* 3.3 Write property tests for end date computation (Property 6)
    - **Property 6: End Date Computation**
    - Test that for any valid startDate and totalNights (1-365), computed end date covers exactly totalNights calendar days
    - **Validates: Requirements 4.5**

  - [ ]* 3.4 Write property tests for initial status assignment (Property 4)
    - **Property 4: Initial Stay Status Assignment**
    - Test that start date after today yields PENDING, start date equals today yields ACTIVE
    - **Validates: Requirements 3.4, 4.1**

  - [ ]* 3.5 Write property tests for status transition enforcement (Property 7)
    - **Property 7: Status Transition Enforcement**
    - Test that only valid transitions (PENDING→ACTIVE, PENDING→EXPIRED, ACTIVE→FINISHED) are accepted and all others rejected
    - **Validates: Requirements 4.6**

  - [x] 3.6 Implement stay lifecycle methods in AccommodationService
    - Add methods: `createStay`, `extendStay`, `transitionStays` (batch for cron), `markExpired`
    - Include shared payment detection logic (skip billing when paymentHostProfileId is set)
    - _Requirements: 2.6, 2.7, 3.4, 4.2, 4.3, 4.4, 14.1, 14.2, 14.3, 14.4_

  - [ ]* 3.7 Write property tests for stay extension (Property 8)
    - **Property 8: Stay Extension Recalculates End Date**
    - Test that extending an active stay recalculates end date correctly and records proper GST breakup
    - **Validates: Requirements 14.1**

  - [ ]* 3.8 Write property tests for cron transitions (Property 5)
    - **Property 5: Cron Stay Status Transitions**
    - Test that PENDING stays whose date range includes today become ACTIVE, ACTIVE stays past end date become FINISHED, no other stays are modified
    - **Validates: Requirements 4.2, 4.3**

  - [ ]* 3.9 Write property test for shared payment billing skip (Property 3)
    - **Property 3: Shared Payment Skips Billing**
    - Test that stays with payment_host_profile_id set do not generate payment/invoice records
    - **Validates: Requirements 2.6, 2.7, 5.5**

- [x] 4. Checkpoint - Core logic verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Server Actions
  - [x] 5.1 Create accommodation onboarding actions
    - Create `src/actions/accommodationOnboardingActions.ts` with `onboardAccommodationCustomerAction` and `completeAccommodationProfileAction`
    - Include shared payment host validation (must exist, must be accommodation customer with ACTIVE/PENDING stay, cannot be self)
    - Handle transactional rollback if stay creation fails
    - _Requirements: 1.1, 1.9, 2.1, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 6.3, 6.4, 6.5_

  - [x] 5.2 Create stay lifecycle actions
    - Create `src/actions/stayActions.ts` with `extendStayAction`, `createNewStayAction`, `markStayExpiredAction`, `getActiveStayAction`, `getStayHistoryAction`
    - Enforce business rules: only active stays can be extended, no new stay while active/pending exists
    - _Requirements: 4.4, 8.1, 8.2, 8.3, 14.1, 14.2, 14.3, 14.4, 14.5_

  - [x] 5.3 Create health log actions
    - Create `src/actions/healthLogActions.ts` with `submitCustomerHealthLogAction`, `submitAdminHealthLogAction`, `getCustomerHealthLogsAction`, `getAdminHealthLogsAction`
    - Implement upsert logic for customer logs, validate against active stay requirement
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 13.5, 13.6_

  - [x] 5.4 Create addon service actions
    - Create `src/actions/addonServiceActions.ts` with `requestAddonServiceAction`, `getAddonServiceRequestsAction`, `updateAddonServiceStatusAction`
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [ ]* 5.5 Write property test for health log upsert idempotence (Property 9)
    - **Property 9: Health Log Upsert Idempotence**
    - Test that submitting logs multiple times for the same (stay_entry_id, log_date) results in exactly one record with the latest values
    - **Validates: Requirements 9.2, 9.3**

- [x] 6. Cron job for stay transitions
  - [x] 6.1 Create stay transition cron route
    - Create `src/app/api/cron/transition-stays/route.ts` implementing the daily cron logic
    - Transition PENDING→ACTIVE for stays whose date range includes today, ACTIVE→FINISHED for stays past end date
    - Log errors and return 500 without partial commits on failure
    - _Requirements: 4.2, 4.3, 4.7_

- [x] 7. Checkpoint - Backend complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Customer portal - sidebar and layout
  - [x] 8.1 Extend customer sidebar for accommodation navigation
    - Modify the existing `CustomerSidebar` component to add an `isAccommodation` branch (mirroring the existing `isKit` pattern)
    - Show: Dashboard, My Profile, Stay Tracker section (Stay Tracker, Stay History), My Health Logs, Health Report, Add-on Services, Billing
    - Hide: My Meals, New Subscription, Shop, Manage Meals sections
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 9. Customer portal pages
  - [x] 9.1 Create Stay Tracker page
    - Create `src/app/customer/(main)/stay-tracker/page.tsx` as RSC that fetches active/pending stay
    - Display stay type, occupancy, start/end dates, remaining nights, status badge, progress indicator (current day / total nights)
    - Show pending stay if no active, or empty state message if neither exists
    - Use Card components with numeric values and progress indicators
    - _Requirements: 8.1, 8.2, 15.4_

  - [x] 9.2 Create Stay History page
    - Create `src/app/customer/(main)/stay-history/page.tsx` as RSC
    - Display all FINISHED/EXPIRED stays in reverse chronological order with stay type, occupancy, dates, status, total nights
    - Show empty state if no past stays exist
    - _Requirements: 8.3, 8.4_

  - [x] 9.3 Create My Health Logs page
    - Create `src/app/customer/(main)/health-logs/page.tsx` with RSC wrapper and client form component
    - Form fields: water intake (0.1-15.0L in 0.1 increments), activity name (max 100 chars), activity duration (1-1440 min with unit selector)
    - Implement upsert behavior with confirmation message on update
    - Display previous entries in date-ordered list
    - Disable form with message when no active stay
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [ ]* 9.4 Write property test for health log schema validation (Property 11)
    - **Property 11: Health Log Schema Validates Input Ranges**
    - Test that schema rejects values outside valid ranges and rejects duration without activity name
    - **Validates: Requirements 9.4**

  - [x] 9.5 Create Health Report page
    - Create `src/app/customer/(main)/health-report/page.tsx` as RSC
    - Display admin-entered health data in read-only format, grouped by date ascending
    - Show only metrics that were recorded (no empty placeholders)
    - Fall back to most recent FINISHED stay if no active stay, or show empty state
    - Use Card components with labels and units for each metric
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 15.4_

  - [x] 9.6 Create Add-on Services page
    - Create `src/app/customer/(main)/addon-services/page.tsx` with RSC wrapper and client interactive component
    - Display service cards in responsive grid (1 col < 768px, 2 cols 768-1023px, 3 cols ≥ 1024px)
    - Each card: service name, icon/image, description (max 150 chars), request button
    - Display submitted requests list (sorted by timestamp desc) with status badges
    - Handle error state preserving selection for retry
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 15.5_

- [x] 10. Profile Completion Popup modifications
  - [x] 10.1 Extend Profile Completion Popup for accommodation customers
    - Modify existing Profile_Completion_Popup to detect accommodation category
    - Show accommodation-specific info (stay type, dates, occupancy) instead of Meal/KIT info
    - Add medical history textarea (max 2000 chars) and confirmation checkbox
    - Implement mutual exclusion: checking checkbox clears and disables textarea, unchecking re-enables
    - Disable "Mark complete onboarding" button unless textarea has non-whitespace content OR checkbox is checked
    - Add document upload (images/PDF, max 5 files, max 10MB each)
    - Replace "Skip for now" with X close button, re-display on next /dashboard navigation
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_

  - [x] 10.2 Wire dashboard page for accommodation customers
    - Modify `src/app/customer/(main)/dashboard/page.tsx` to pass `customerCategory`, `accommodationStay`, and `customerProfileId` into `ProfileCompletionDialog` so the popup renders stay details instead of Meal/KIT info (Req 6.1)
    - Create `src/app/customer/(main)/dashboard/AccommodationDashboard.tsx` (mirrors `KitDashboard.tsx` pattern) showing stay summary, progress, and quick links to Health Logs/Health Report/Add-on Services
    - Add an ACCOMMODATION branch in the dashboard page parallel to the existing KIT branch, rendering `AccommodationDashboard` instead of the generic meal dashboard when `activeSub.customer_category === "ACCOMMODATION"`
    - _Requirements: 6.1, 8.1, 8.2_

  - [ ]* 10.2 Write property test for profile completion button enablement (Property 10)
    - **Property 10: Profile Completion Button Enablement**
    - Test that button is enabled iff (textarea has ≥1 non-whitespace char) OR (checkbox is checked)
    - **Validates: Requirements 6.3**

- [ ] 11. Checkpoint - Customer portal complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Admin portal - Accommodation Customers Tab
  - [ ] 12.1 Add Accommodation Customers tab to admin customer list
    - Add new tab in AdminSubmenuBar positioned after "KIT Customer" and before "Onboarded"
    - Display accommodation customers in DataTable with columns: Customer Info, Contact, Diet & Allergy, Stay Status (badge), Stay Type, Medical History
    - Implement search (Name, Phone, Email, Pincode) and filters (Diet & Allergy, Status, Medical History, Show Archived) — exclude Clinic filter
    - Show empty state when no accommodation customers match criteria
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [ ] 13. Admin portal - Customer 360 Accommodation Tab
  - [x] 13.1 Create Accommodation tab in Customer 360 Dashboard
    - Add "Accommodation" tab for accommodation customers, show "Profile & Medical", "Accommodation", "Billing", "User Management" tabs
    - Hide KIT, Shipping, Addresses, Coupons, Add Subscription, Clinic Assignment tabs
    - Display active stay overview (type, occupancy, start date, end date, status) or empty state with "Add Stay" action
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [ ] 13.2 Implement admin health log entry form
    - Add health log form to Accommodation tab: date, weight (30-300 kg), BP systolic (60-250), BP diastolic (40-150), sugar (30-600 mg/dL), notes (max 500 chars)
    - Display customer-entered logs (water intake, activity) in read-only table sorted by date descending
    - _Requirements: 13.5, 13.6_

  - [ ] 13.3 Implement stay management dialogs
    - Create `StayExtensionDialog`: additional nights (1-365) + payment amount input, calls `extendStayAction`
    - Create `NewStayDialog`: stay type, occupancy, start date, total nights, payment amount, calls `createNewStayAction`
    - Display complete stay history sorted by start date descending
    - _Requirements: 13.7, 13.8, 13.9, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

- [x] 14. Admin onboarding form modifications
  - [x] 14.1 Extend Quick Onboard form for accommodation fields
    - Modify existing Quick Onboard form to show accommodation-specific fields when ACCOMMODATION category is selected
    - Add fields: stay start date (date picker, today to today+365, no 5 PM cutoff), total nights (1-365 with < 7 warning), stay type, occupancy type, payment amount (1-9,999,999), meal preference, shared payment checkbox
    - Hide subscription plan and KIT-specific fields
    - Skip address step: show 3-step stepper (Details, Category & Plan, Payment & Review)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 3.1_

  - [x] 14.2 Implement shared payment UI and validation
    - Show mobile number input when shared payment checkbox is checked, hide payment amount field
    - Validate: host must exist as accommodation customer with ACTIVE/PENDING stay, cannot be self
    - Display appropriate error messages for each validation failure
    - Re-display payment amount when checkbox unchecked
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.8_

  - [ ]* 14.3 Write property test for onboarding schema field range validation (Property 2)
    - **Property 2: Accommodation Onboarding Schema Field Range Validation**
    - Test that schema accepts values in valid ranges and rejects values outside ranges for totalNights, paymentAmount
    - **Validates: Requirements 1.2, 1.3, 1.7**

- [x] 15. Responsiveness and UI polish
  - [x] 15.1 Apply responsive layouts and accessibility standards
    - Ensure single-column below 768px, two-column at 768-1023px, multi-column at 1024px+
    - Minimum 44x44px touch targets on mobile viewports
    - Use Shadcn UI and Tailwind CSS only (no additional libraries)
    - Add skeleton loading states for all accommodation pages
    - Ensure 4.5:1 contrast ratio for text, 3:1 for interactive boundaries, visible labels on all inputs
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_

- [x] 16. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using fast-check
- Unit tests validate specific examples and edge cases
- The database migration script should be run manually in Supabase before starting implementation
- All Server Actions return discriminated union: `{ success: true; data: T } | { error: string; fieldErrors?: Record<string, string> }`
- Use `createAdminClient` for cross-user operations and regular `createClient` for customer-scoped reads

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3"] },
    { "id": 2, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 3, "tasks": ["3.1"] },
    { "id": 4, "tasks": ["3.2", "3.3", "3.4", "3.5", "3.6"] },
    { "id": 5, "tasks": ["3.7", "3.8", "3.9"] },
    { "id": 6, "tasks": ["5.1", "5.2", "5.3", "5.4", "6.1"] },
    { "id": 7, "tasks": ["5.5"] },
    { "id": 8, "tasks": ["8.1"] },
    { "id": 9, "tasks": ["9.1", "9.2", "9.3", "9.5", "9.6", "10.1"] },
    { "id": 10, "tasks": ["9.4", "10.2"] },
    { "id": 11, "tasks": ["12.1", "14.1"] },
    { "id": 12, "tasks": ["13.1", "14.2"] },
    { "id": 13, "tasks": ["13.2", "13.3", "14.3"] },
    { "id": 14, "tasks": ["15.1"] }
  ]
}
```
