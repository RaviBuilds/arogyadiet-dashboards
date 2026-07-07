# Implementation Plan: Franchise Customer Dashboard Enhancement

## Overview

This implementation converts the existing admin `/customers` page into a role-aware page that branches between the full admin `AdminCustomersWrapper` and a new `FranchiseCustomerDashboard` client component. The franchise variant features tabbed navigation (Overview, Meal, KIT, Onboarded), column-selector search, multi-filter support, row-level actions, Quick Edit modal, ISR refresh, and a Quick Onboard route — all scoped to franchise data boundaries via `resolveFranchiseContext()`.

The approach reuses existing shared components (`DataTableCard`, `AdminSubmenuBar`, `DataSearchFilter`, `StatusBadge`, `RefreshButton`, `ExportButton`, `QuickOnboardingForm`, `OnboardingCustomersSection`, `KitCustomerSection`) and builds franchise-specific orchestrating components on top.

## Tasks

- [x] 1. Set up franchise dashboard shell and role branching
  - [x] 1.1 Modify `src/app/admin/(main)/customers/page.tsx` to branch based on franchise context
    - Import `resolveFranchiseContext` and check if user is `FRANCHISE_ADMIN`
    - If franchise admin: fetch franchise-scoped customer data (`.eq("franchise_id", franchiseId)`) and render `FranchiseCustomerDashboard`
    - If not franchise admin: render existing `AdminCustomersWrapper` (unchanged)
    - Ensure franchise-scoped query includes: customer_profiles, users, addresses, subscriptions, subscription_plans, kit_products, clinics joins
    - _Requirements: 17.1, 17.2, 17.4_

  - [x] 1.2 Create `src/app/admin/(main)/customers/FranchiseCustomerDashboard.tsx` client component skeleton
    - Define `FranchiseCustomerDashboardProps` interface with `customers: CustomerData[]` and `franchiseId: string`
    - Set up tab state management using `useSearchParams` and `router.replace` for URL-based tab routing (`?tab=overview|meal|kit|onboarded`)
    - Default to `meal` tab when no tab parameter present
    - Render `AdminPageHeader` with title "Customers" and action buttons (Onboarding, Refresh, Quick Onboard link)
    - Render `AdminSubmenuBar` with four tabs: Overview, Meal Customers, KIT Customers, Onboarded
    - Add conditional tab content rendering based on `activeTab` state
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 7.1, 7.2, 8.1_

  - [x] 1.3 Add filter state model and filtering utility functions
    - Create `FranchiseDashboardFilters` interface in the dashboard component
    - Implement `filterBySearch(customers, searchColumn, searchTerm)` — case-insensitive substring match
    - Implement `filterByDiet(customers, filterDiet)` — filter by dietary preference including "NOT_SET"
    - Implement `filterByStatus(customers, filterStatus)` — filter by subscription-derived status
    - Implement `filterByMedical(customers, filterMedical)` — filter by has_medical_history
    - Implement `filterByAllergy(customers, filterAllergy)` — filter by non-empty allergies
    - Implement `filterByArchived(customers, showArchived)` — exclude `isActive: false` when toggle off
    - Implement `applyAllFilters(customers, filters)` using AND logic (intersection of all filters)
    - _Requirements: 9.2, 9.3, 9.4, 10.4, 10.5, 10.6, 11.2, 11.3, 11.4, 12.3_

- [x] 2. Checkpoint - Ensure franchise branching and filter logic compile
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement Overview tab analytics
  - [x] 3.1 Create `src/app/admin/(main)/customers/FranchiseCustomerOverview.tsx`
    - Accept `customers: CustomerData[]` prop
    - Compute metrics: total count, active count, no-plan count, medical history count, allergy count
    - Allergy count logic: non-empty and not "None" or "No allergy"
    - Render stat cards using existing `GlassCard`/`StatCard` patterns with icons
    - Render dietary preference distribution (Veg/Non-Veg) with counts, percentages, and progress bars
    - Render customer status mix (Active/Pending/Stopped/Expired/No Plan) with counts, percentages, and progress bars
    - Render empty state when zero customers exist
    - Ensure NO subscription analytics are rendered
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 3.2 Write property test for franchise data isolation (Property 1)
    - **Property 1: Franchise data isolation**
    - Generate random customer lists with mixed `franchise_id` values
    - Verify the filtering function produces ONLY customers matching the specified franchise_id
    - **Validates: Requirements 17.1**

  - [ ]* 3.3 Write property test for status derivation priority (Property 4)
    - **Property 4: Status derivation priority correctness**
    - Generate random subscription arrays with varied statuses
    - Verify derived status follows Active > Pending > Stopped > Expired > No Plan priority
    - **Validates: Requirements 12.3**

- [x] 4. Implement Meal Customers tab with search and filters
  - [x] 4.1 Implement Meal Customers tab content in `FranchiseCustomerDashboard`
    - Filter customers to show only those with `customerCategory === "MEAL"` or `customerCategory === null`
    - Render `DataSearchFilter` with column selector (Name, Phone, Email, Pincode) defaulting to "Name"
    - Render filter dropdowns: Diet (All/Veg/Non-Veg/Not Set), Status (All/Active/Pending/Stopped/Expired/No Plan), Medical History (All/Has Medical/No Medical), Allergy (All/Has Allergies/No Allergies)
    - Render "Show Archived" toggle button (default: inactive)
    - Render `DataTableCard` with columns: Customer Info (name, gender, age), Contact (email, mobile), Diet & Allergy, Pincode, Active Plan, Clinic, Medical History indicator, Status badge
    - Diet & Allergy column: dietary preference badge + allergy text truncated to 30 chars with ellipsis
    - Medical History column: indicator badge when `hasMedicalHistory` is true, empty otherwise
    - Clinic column: clinic name or "—" when null
    - Render row dropdown with: View 360 Dashboard, Quick Edit actions (NO Shipping action)
    - Render empty state when no customers match filters
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 9.1, 9.2, 9.5, 9.6, 10.1, 10.2, 10.3, 11.1, 11.5, 12.1, 12.2, 15.3, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8_

  - [ ]* 4.2 Write property test for column selector search correctness (Property 2)
    - **Property 2: Column selector search correctness**
    - Generate random customer lists and search terms
    - For each column option, verify filtered result contains exactly those rows where column value contains search term (case-insensitive substring)
    - **Validates: Requirements 9.2, 9.3**

  - [ ]* 4.3 Write property test for AND-logic filter composition (Property 3)
    - **Property 3: AND-logic filter composition**
    - Generate random filter combinations (diet + status + medical + allergy + archived)
    - Verify the combined filter result equals the intersection of each filter applied independently
    - **Validates: Requirements 10.5**

  - [ ]* 4.4 Write property test for Meal tab customer category filtering (Property 7)
    - **Property 7: Meal tab customer category filtering**
    - Generate random customer lists with mixed `customerCategory` values
    - Verify the Meal tab filter returns only customers with `customerCategory === "MEAL"` or `null`, never "KIT"
    - **Validates: Requirements 3.1**

- [x] 5. Implement KIT Customers tab with shipping status
  - [x] 5.1 Implement KIT Customers tab content in `FranchiseCustomerDashboard`
    - Integrate existing `KitCustomerSection` component or build franchise-specific KIT table
    - Filter customers: `customerCategory === "KIT"` AND `isActive === true` AND status is "Active" or "Pending" (default state)
    - Display columns: Customer Info (name, gender, age), Contact (mobile, diet preference), Status (subscription status + active plan), Clinic, Shipment Status
    - Shipment Status column: show "Add Shipment" link (navigates to `/customers/{id}?tab=Shipping`) when no shipping record, or "Shipped"/"Delivered" badge with timestamp in "DD Mon YYYY, HH:MM AM/PM" en-IN locale
    - Add "Show Expired" toggle (default: off) — when on, show only KIT customers with EXPIRED status
    - Add "Show Archived" toggle (default: off) — when on, include `isActive: false` customers
    - When both toggles active: show union of expired and archived (deduplicated)
    - Render row dropdown: View 360 Dashboard, Quick Edit, Shipping action
    - Fetch KIT shipping status via `getBulkKitShippingStatusAction` server action
    - Render empty state when no KIT customers match
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 15.1, 15.2_

  - [ ]* 5.2 Write property test for KIT tab customer category filtering (Property 8)
    - **Property 8: KIT tab customer category filtering**
    - Generate random customer lists with mixed categories, statuses, and isActive values
    - With default toggles (Show Archived off, Show Expired off), verify only `customerCategory === "KIT"` AND `isActive === true` AND status in ["Active", "Pending"] appear
    - **Validates: Requirements 4.1**

  - [ ]* 5.3 Write property test for Show Archived toggle invariant (Property 5)
    - **Property 5: Show Archived toggle invariant**
    - Generate random customer lists with mixed `isActive` values
    - Verify: toggle OFF → zero archived customers displayed; toggle ON → superset of toggle-OFF list
    - **Validates: Requirements 11.2, 11.3, 11.4**

- [x] 6. Checkpoint - Ensure tabs render correctly with data
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement Onboarded tab
  - [x] 7.1 Implement Onboarded tab content in `FranchiseCustomerDashboard`
    - Integrate existing `OnboardingCustomersSection` component or build franchise-scoped version
    - Fetch onboarded customers via `listOnboardedCustomersAction` with franchise scope, filtered to `onboarding_status = 'IN_PROGRESS'`, ordered by creation date descending
    - Display columns: Customer Info (full name + customer code, category badge for KIT), Contact (mobile, email with placeholder detection), Onboarding Status, Onboarded Date (DD Mon YYYY)
    - Show "Shipping" action button for KIT customers (navigates to 360 with Shipping tab)
    - Show "View" action button per row (navigates to customer detail page)
    - Handle loading state with loading indicator
    - Handle error state with error message and retry button
    - Handle empty state with appropriate message
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 8. Implement Quick Edit modal
  - [x] 8.1 Create `src/app/admin/(main)/customers/FranchiseQuickEditModal.tsx`
    - Accept props: `isOpen`, `onClose`, `customer: CustomerData | null`, `onSuccess`
    - Render editable fields pre-populated with current values: full name, mobile, gender, DOB, dietary preference
    - Implement Zod validation schema: name (2-100 chars required), mobile (valid 10-digit Indian: `/^[6-9]\d{9}$/`), gender (Male/Female/Other enum), DOB (valid date, not future, not >120 years past), dietary preference (Veg/Non-Veg)
    - Display field-level validation errors on invalid submission
    - On valid submit: call `franchiseUpdateCustomerBasicInfo` server action
    - On success: close modal, show success toast, trigger `onSuccess` callback (list refresh)
    - On server error: keep modal open, preserve data, show error toast
    - Franchise ownership guard is enforced server-side by the existing `guardProfile` in `franchiseCustomerManagementActions`
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

  - [x] 8.2 Wire Quick Edit modal into `FranchiseCustomerDashboard`
    - Add state: `editingCustomer: CustomerData | null` and `isEditModalOpen: boolean`
    - "Quick Edit" row action sets the customer and opens the modal
    - On success callback: trigger `router.refresh()` to update the list data
    - _Requirements: 14.1, 14.3_

  - [ ]* 8.3 Write property test for Quick Edit validation round-trip (Property 6)
    - **Property 6: Quick Edit validation round-trip**
    - Generate random valid form data (name 2-100 chars, valid mobile, valid gender, valid past DOB, valid diet)
    - Verify the Zod schema accepts all valid inputs and rejects invalid inputs (future DOB, 9-digit phone, empty name, etc.)
    - **Validates: Requirements 14.3, 14.5**

- [x] 9. Implement ISR Refresh and action buttons
  - [x] 9.1 Wire Refresh button, Export button, and navigation actions
    - Render `RefreshButton` that calls `revalidateCustomersPage()` server action then `router.refresh()`
    - Show spinning indicator while refresh in progress, disable button to prevent duplicates
    - On timeout (>10s) or error: show error toast, re-enable button
    - Preserve current search text and filter selections during refresh
    - Render `ExportButton` for Excel export of current filtered dataset (disable when zero rows)
    - Render "Quick Onboard" link navigating to `/franchise/customers/quick-onboard` (via existing `QuickActions` pattern or inline link)
    - Render "Onboarding" button navigating to `/franchise/customers/onboarding`
    - Hide Onboarding button if `franchiseId` cannot be determined
    - _Requirements: 6.6, 7.1, 7.2, 7.3, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [x] 10. Implement Quick Onboard route for franchise
  - [x] 10.1 Create or verify `src/app/admin/(main)/customers/quick-onboard/page.tsx` for franchise context
    - The page should already exist (shared with admin); verify it works for franchise admins
    - Ensure the page fetches franchise-specific active plans, KIT products, and serviceable pincodes
    - Pass `plans`, `kitProducts`, `serviceAreaPincodes` to existing `QuickOnboardingForm` component
    - Verify clinic auto-assignment via franchise → group → kitchen → clinic hierarchy
    - On success: redirect to `/franchise/customers` (or admin `/customers`) and trigger refresh
    - Handle case where franchise clinic cannot be resolved: display error message
    - Handle empty option lists gracefully (form component has built-in empty states)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 17.5, 17.6_

- [x] 11. Implement row-level View 360 Dashboard action
  - [x] 11.1 Wire View 360 navigation from row actions
    - "View 360 Dashboard" row action navigates to `/franchise/customers/[id]` (or admin `/customers/[id]`)
    - Verify existing 360 dashboard displays correct tabs based on category:
      - Meal customers: Profile & Medical, Add Subscription, Addresses, Billing, Coupons, User Management
      - KIT customers: Profile & Medical, KIT, Shipping, Addresses, Billing, User Management
    - KIT customer 360 should NOT show clinic assignment option (auto-assigned)
    - "Shipping" row action (KIT tab only) navigates to `/customers/[id]?tab=Shipping`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 15.1, 15.2_

- [x] 12. Implement franchise-specific access constraints
  - [x] 12.1 Enforce franchise boundary constraints in the page
    - Verify that the page query uses `.eq("franchise_id", franchiseId)` ensuring data isolation
    - Ensure NO Bulk Import button is rendered for franchise admins
    - If a franchise user navigates to `/customers/bulk-import`, redirect to customers landing
    - Ensure NO Clinic filter dropdown is rendered (franchise operates single clinic)
    - Verify Overview tab excludes subscription analytics, subscription lists, pause credit data, and ending-soon lists
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

  - [ ]* 12.2 Write property test for empty search restores full list (Property 10)
    - **Property 10: Empty search restores full list**
    - Generate random customer list with an active search term
    - Verify that clearing the search term restores the list to show all customers subject to other active filters
    - **Validates: Requirements 9.4**

- [x] 13. Final checkpoint - Ensure all tests pass and integration works
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using `fast-check`
- Unit tests validate specific examples and edge cases
- The implementation reuses existing shared components extensively — `DataTableCard`, `AdminSubmenuBar`, `DataSearchFilter`, `StatusBadge`, `RefreshButton`, `ExportButton`, `QuickOnboardingForm`, `OnboardingCustomersSection`, `KitCustomerSection`
- The `FranchiseCustomerDashboard` component is the main orchestrating client component that manages tab state, filters, and actions
- Server actions (`franchiseCustomerManagementActions.ts`) already exist with franchise ownership guards — reuse them
- The existing `page.tsx` server component will be extended with a role branch, not replaced

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3"] },
    { "id": 3, "tasks": ["4.1", "5.1", "7.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "4.4", "5.2", "5.3"] },
    { "id": 5, "tasks": ["8.1", "9.1", "10.1"] },
    { "id": 6, "tasks": ["8.2", "8.3", "11.1", "12.1"] },
    { "id": 7, "tasks": ["12.2"] }
  ]
}
```
