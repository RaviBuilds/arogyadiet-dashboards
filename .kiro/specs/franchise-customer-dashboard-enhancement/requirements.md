# Requirements Document

## Introduction

This specification defines the enhancement of the franchise `/customers` page to bring it closer to feature parity with the admin `/customers` page. The scope includes a tab navigation system, advanced filtering, row-level actions, data columns, action buttons, and a customer-focused Overview analytics tab. Key exclusions: no Bulk Import, no Clinic filter dropdown (franchise has single clinic), and no subscription analytics on the Overview tab (subscriptions have their own navigation and restricted-access admins should not see subscription data here).

## Glossary

- **Franchise_Dashboard**: The enhanced franchise customers page (`/franchise/customers`) providing tabbed navigation, analytics, and customer management capabilities
- **Overview_Tab**: The analytics/statistics tab showing customer-focused demographic, activity, and health metrics — explicitly excluding subscription BI data
- **Meal_Customers_Tab**: The tab listing customers whose active or most recent subscription has `customer_category = 'MEAL'`
- **KIT_Customers_Tab**: The tab listing customers whose active or most recent subscription has `customer_category = 'KIT'`
- **Onboarded_Tab**: The tab listing customers who were created through Quick Onboarding, showing their onboarding progress status
- **Quick_Onboard_Route**: A dedicated page (`/franchise/customers/quick-onboard`) for rapidly creating a customer with essential details, subscription selection, address capture, and payment collection
- **ISR_Revalidation**: Incremental Static Regeneration revalidation — a server action that triggers the Next.js page cache to refresh with fresh data
- **Column_Selector_Search**: A search mechanism where the user selects which column (Name, Phone, Email, Pincode) to search against
- **Quick_Edit_Modal**: A dialog for inline editing of a customer's basic info (name, mobile, gender, DOB, diet preference) without leaving the list view
- **Shipping_Action**: A row-level action for KIT customers that navigates to their 360 dashboard Shipping tab for managing product shipments
- **360_Dashboard**: The customer detail page (`/franchise/customers/[id]`) showing comprehensive customer information
- **Franchise_Clinic**: The single clinic associated with a franchise — franchise customers are auto-assigned to this clinic during onboarding

## Requirements

### Requirement 1: Tab Navigation System

**User Story:** As a franchise admin, I want tabbed navigation on the customers page, so that I can quickly switch between different customer views and analytics.

#### Acceptance Criteria

1. THE Franchise_Dashboard SHALL display a horizontal tab navigation bar with four tabs in the following fixed order from left to right: Overview, Meal Customers, KIT Customers, and Onboarded
2. WHEN the franchise admin selects a tab, THE Franchise_Dashboard SHALL display the corresponding tab panel content and update the visible URL parameter to reflect the selected tab, without a full page reload
3. WHEN the customers page loads and no tab is specified in the URL, THE Franchise_Dashboard SHALL activate the Meal Customers tab and display its content by default
4. WHILE a tab is active, THE Franchise_Dashboard SHALL indicate the selected tab by applying a visually differentiated style (such as a contrasting background, underline, or border) to the active tab label, and only one tab SHALL be indicated as active at any time
5. IF the franchise admin navigates to the customers page with a valid tab identifier in the URL, THEN THE Franchise_Dashboard SHALL activate and display the content for that specified tab

### Requirement 2: Overview Tab — Customer-Only Analytics

**User Story:** As a franchise admin, I want a customer analytics overview, so that I can understand my customer base demographics, health data, and activity without subscription details cluttering the view.

#### Acceptance Criteria

1. WHEN the Overview tab is selected, THE Overview_Tab SHALL display total customer count, active customer count (customers with at least one subscription in "Active" status), customers without a plan count (customers with no subscription in "Active" or "Pending" status), customers with medical history count (customers where has_medical_history is true), and customers with allergies count (customers whose allergies field is non-empty and not equal to "None" or "No allergy")
2. WHEN the Overview tab is selected, THE Overview_Tab SHALL display dietary preference distribution as a visual breakdown using distribution rows that show each preference label ("Veg", "Non-Veg"), its count, its percentage of total customers, and a proportional progress bar
3. WHEN the Overview tab is selected, THE Overview_Tab SHALL display customer status mix showing each status category (Active, Pending, Stopped, Expired, No Plan) with its count, percentage of total customers, and a proportional progress bar
4. THE Overview_Tab SHALL NOT display any subscription-related analytics including active subscription counts, pending subscription counts, stopped subscription lists, subscription plan distributions, pause credit utilization, or subscription ending-soon lists
5. THE Overview_Tab SHALL render using the existing franchise design system components (GlassCard, StatCard, SectionCard patterns) with consistent spacing, iconography, and layout structure as other franchise portal pages
6. IF the franchise has zero customers, THEN THE Overview_Tab SHALL display a placeholder empty state indicating no customer data is available yet, in place of the analytics widgets

### Requirement 3: Meal Customers Tab

**User Story:** As a franchise admin, I want a dedicated Meal customers listing, so that I can manage customers subscribed to meal delivery plans.

#### Acceptance Criteria

1. WHEN the Meal Customers tab is active, THE Meal_Customers_Tab SHALL display only customers whose most recent subscription has `customer_category` equal to MEAL, plus customers with no subscription records at all
2. THE Meal_Customers_Tab SHALL display columns for: Customer Info (name, gender, age), Contact (email, mobile), Diet and Allergy information, Pincode, Active Plan name, Clinic assignment, Medical History indicator, and Status
3. WHEN a customer has a non-empty allergies field, THE Meal_Customers_Tab SHALL display allergy information in the Diet and Allergy column alongside the dietary preference badge
4. WHEN a customer has `hasMedicalHistory` set to true, THE Meal_Customers_Tab SHALL display a visual medical history indicator badge in the Medical History column
5. IF no customers match the current filter criteria in the Meal Customers tab, THEN THE Meal_Customers_Tab SHALL display an empty-state message indicating no customers found

### Requirement 4: KIT Customers Tab

**User Story:** As a franchise admin, I want a dedicated KIT customers listing with shipping status visibility, so that I can manage KIT product customers and their shipment statuses.

#### Acceptance Criteria

1. WHEN the KIT Customers tab is active, THE KIT_Customers_Tab SHALL display only customers whose most recent subscription has `customer_category` equal to KIT and subscription status of ACTIVE or PENDING, excluding customers with `is_active` equal to false
2. THE KIT_Customers_Tab SHALL display columns for: Customer Info (name, gender, age), Contact (mobile, diet preference), Status (subscription status and active plan name), Clinic assignment, and Shipment Status
3. WHEN a KIT customer has no record in `kit_shipping_info` or `shipped_at` is null, THE KIT_Customers_Tab SHALL display a clickable "Add Shipment" link that navigates to the customer 360 dashboard Shipping tab at path `/customers/{id}?tab=Shipping`
4. WHEN a KIT customer has an existing shipment with `shipped_at` or `delivered_at` set, THE KIT_Customers_Tab SHALL display a status badge showing "Shipped" or "Delivered" respectively, along with the corresponding timestamp formatted as "DD Mon YYYY, HH:MM AM/PM" in en-IN locale
5. WHEN the "Show Expired" toggle is activated (default: off), THE KIT_Customers_Tab SHALL filter the listing to display only KIT customers whose most recent subscription has status EXPIRED
6. WHEN the "Show Archived" toggle is activated (default: off), THE KIT_Customers_Tab SHALL include customers with `is_active` equal to false in the listing
7. WHEN both "Show Expired" and "Show Archived" toggles are active simultaneously, THE KIT_Customers_Tab SHALL display the union of inactive customers and expired-subscription customers, showing each customer at most once
8. IF no KIT customers match the current filter criteria, THEN THE KIT_Customers_Tab SHALL display an empty state indicating that no KIT customers were found

### Requirement 5: Onboarded Customers Tab

**User Story:** As a franchise admin, I want to see customers created through Quick Onboarding, so that I can track their onboarding progress.

#### Acceptance Criteria

1. WHEN the Onboarded tab is active, THE Onboarded_Tab SHALL display customers whose onboarding status is IN_PROGRESS, scoped to the current franchise, ordered by creation date descending (newest first)
2. THE Onboarded_Tab SHALL display columns for: Customer Info (full name and customer code, with a category badge showing "KIT" when customer_category is KIT), Contact (mobile number and email, with placeholder emails indicated as such), Onboarding Status, and Onboarded Date (formatted as DD Mon YYYY)
3. WHEN a customer in the Onboarded tab has `customer_category` equal to KIT, THE Onboarded_Tab SHALL display a "Shipping" action button that navigates to the customer detail page with the Shipping tab selected
4. THE Onboarded_Tab SHALL provide a View action button per row that navigates to the customer detail page for that customer's profile
5. IF the data fetch for onboarded customers fails, THEN THE Onboarded_Tab SHALL display an error message indicating the failure and a retry button to re-attempt the fetch
6. WHEN the Onboarded tab is active and no customers with IN_PROGRESS status exist for the current franchise, THE Onboarded_Tab SHALL display an empty state message indicating no onboarded customers are available yet
7. WHILE the onboarded customer list is being fetched, THE Onboarded_Tab SHALL display a loading indicator

### Requirement 6: Quick Onboard Route

**User Story:** As a franchise admin, I want a quick onboarding wizard, so that I can rapidly create new customers with their essential details, subscription, address, and payment in one flow.

#### Acceptance Criteria

1. THE Quick_Onboard_Route SHALL be accessible at `/franchise/customers/quick-onboard`
2. WHEN the quick onboard page loads, THE Quick_Onboard_Route SHALL fetch and supply the franchise's active subscription plans, active KIT products, and serviceable pincodes as props to the `QuickOnboardingForm` component within 3 seconds
3. THE Quick_Onboard_Route SHALL use the existing shared `QuickOnboardingForm` component to render the onboarding wizard, passing `plans`, `kitProducts`, and `serviceAreaPincodes` props matching the `QuickOnboardingFormProps` interface
4. WHEN a customer is created through the Quick_Onboard_Route, THE Quick_Onboard_Route SHALL resolve the customer's `clinic_id` and `franchise_id` from the entered primary address pincode via the existing clinic-stamping mechanism, so that the customer is associated with the franchise's wired clinic
5. IF the quick onboard page loads and no active subscription plans, no active KIT products, or no serviceable pincodes are found for the franchise, THEN THE Quick_Onboard_Route SHALL still render the form with empty option lists, allowing the `QuickOnboardingForm` component to display its built-in empty-state messages
6. THE Franchise_Dashboard SHALL display a "Quick Onboard" link in the Quick Actions section that navigates to `/franchise/customers/quick-onboard`
7. WHEN onboarding completes successfully via the Quick_Onboard_Route, THE Quick_Onboard_Route SHALL redirect the franchise admin to the franchise customer list page and trigger a page refresh to display the newly created customer record

### Requirement 7: Onboarding Button

**User Story:** As a franchise admin, I want an onboarding button on the customers page, so that I can quickly initiate the standard onboarding flow.

#### Acceptance Criteria

1. THE Franchise_Dashboard SHALL display an "Onboarding" action button in the PageHeader actions area of the customers page, visible at all viewport widths
2. WHEN the franchise admin clicks the Onboarding button, THE Franchise_Dashboard SHALL perform client-side navigation to `/franchise/customers/onboarding` within 1 second
3. IF the franchise admin's franchise_id cannot be determined from the session, THEN THE Franchise_Dashboard SHALL hide the Onboarding button

### Requirement 8: Refresh Data (ISR Revalidation)

**User Story:** As a franchise admin, I want a refresh button, so that I can trigger a data reload and see the latest customer information without manually reloading the page.

#### Acceptance Criteria

1. THE Franchise_Dashboard SHALL display a "Refresh" button in the action bar alongside the Export and Create Customer buttons
2. WHEN the franchise admin clicks the Refresh button, THE Franchise_Dashboard SHALL call the ISR_Revalidation server action to revalidate the customers page data and then programmatically refresh the displayed content via client-side router refresh
3. WHILE the refresh is in progress, THE Franchise_Dashboard SHALL display a spinning loading indicator on the Refresh button and disable the button to prevent duplicate requests
4. WHEN the refresh completes successfully, THE Franchise_Dashboard SHALL update the displayed customer list with fresh results from the server within 3 seconds of the button click under normal network conditions
5. IF the ISR_Revalidation server action fails or does not respond within 10 seconds, THEN THE Franchise_Dashboard SHALL display an error toast notification indicating the refresh failed and re-enable the Refresh button
6. WHILE the refresh is in progress, THE Franchise_Dashboard SHALL preserve the current search text and status filter selections so that the refreshed data is displayed with the same filters applied

### Requirement 9: Column Selector Search

**User Story:** As a franchise admin, I want to search customers by specific fields, so that I can quickly locate customers by name, phone, email, or pincode.

#### Acceptance Criteria

1. THE Franchise_Dashboard SHALL display a search input (maximum 100 characters) with a column selector dropdown offering options: Name, Phone, Email, and Pincode, with "Name" selected by default
2. WHEN the franchise admin types in the search input, THE Franchise_Dashboard SHALL filter the visible customer list to show only rows where the selected column's value contains the search term using case-insensitive substring matching
3. WHEN the franchise admin changes the column selector, THE Franchise_Dashboard SHALL re-apply the current search term against the newly selected column and update the visible customer list immediately
4. IF the search input is cleared or empty, THEN THE Franchise_Dashboard SHALL display all customers (subject to any active status filter)
5. IF no customers match the search term in the selected column, THEN THE Franchise_Dashboard SHALL display an empty-state message indicating no customers match the search criteria
6. THE Franchise_Dashboard SHALL NOT include a Clinic filter dropdown since each franchise operates a single clinic

### Requirement 10: Diet, Allergy, and Medical History Filters

**User Story:** As a franchise admin, I want to filter customers by dietary preference, allergy presence, and medical history, so that I can segment my customer base for health-related operations.

#### Acceptance Criteria

1. THE Franchise_Dashboard SHALL provide a Diet filter dropdown with options derived from distinct dietary preferences present in the customer data (e.g., Veg, Non-Veg, Eggetarian) plus an "All" option that is selected by default, and a "Not Set" option representing customers with no dietary preference recorded
2. THE Franchise_Dashboard SHALL provide a Medical History filter dropdown with options: All (selected by default), Has Medical History, No Medical History
3. THE Franchise_Dashboard SHALL provide an Allergy filter dropdown with options: All (selected by default), Has Allergies (customers whose allergy field is non-empty), No Allergies (customers whose allergy field is empty or null)
4. WHEN a filter value is selected, THE Franchise_Dashboard SHALL filter the customer list within 1 second to display only customers matching the selected value
5. WHEN multiple filters are active simultaneously, THE Franchise_Dashboard SHALL apply all filters using AND logic so that only customers satisfying every active filter condition are displayed
6. WHEN active filters result in zero matching customers, THE Franchise_Dashboard SHALL display an empty-state message indicating no customers match the current filter criteria

### Requirement 11: Show Archived Toggle

**User Story:** As a franchise admin, I want to toggle visibility of archived (deactivated) customers, so that I can review past customers when needed.

#### Acceptance Criteria

1. THE Franchise_Dashboard SHALL provide a "Show Archived" toggle button on the Meal Customers and KIT Customers tabs
2. WHEN the Franchise_Dashboard loads, THE Franchise_Dashboard SHALL set the Show Archived toggle to inactive by default and display only customers whose `isActive` status is true
3. WHEN the franchise admin activates the Show Archived toggle, THE Franchise_Dashboard SHALL include customers whose `isActive` status is false in the displayed list alongside active customers
4. WHEN the franchise admin deactivates the Show Archived toggle, THE Franchise_Dashboard SHALL remove customers whose `isActive` status is false from the displayed list within the same rendering cycle without a full page reload
5. IF the Show Archived toggle is active, THEN THE Franchise_Dashboard SHALL visually distinguish the toggle button from its inactive state by rendering it with a filled/active variant

### Requirement 12: Plan-Based Status Filtering

**User Story:** As a franchise admin, I want to filter customers by their subscription status, so that I can focus on active, pending, or lapsed customer groups.

#### Acceptance Criteria

1. THE Franchise_Dashboard SHALL provide a Status filter dropdown with options: All, Active, Pending, Stopped, Expired, and No Plan
2. THE Franchise_Dashboard SHALL default the Status filter to "All" on initial page load, displaying all customers regardless of status
3. WHEN a status filter option other than "All" is selected, THE Franchise_Dashboard SHALL display only customers whose subscription-derived status exactly matches the selected option, where status is derived using priority order: Active (has any ACTIVE subscription) > Pending (has any PENDING subscription) > Stopped (has any STOPPED or CANCELLED subscription) > Expired (has any EXPIRED subscription) > No Plan (has no subscriptions)
4. WHEN the "All" status filter option is selected, THE Franchise_Dashboard SHALL display all customers regardless of their subscription-derived status
5. IF no customers match the selected status filter, THEN THE Franchise_Dashboard SHALL display an empty-state message indicating no customers match the current filter criteria

### Requirement 13: Row-Level View 360 Dashboard Action

**User Story:** As a franchise admin, I want to access a customer's full profile from the list, so that I can view their complete information.

#### Acceptance Criteria

1. THE Franchise_Dashboard SHALL provide a "View 360 Dashboard" action in each customer row's dropdown menu
2. WHEN the franchise admin clicks View 360 Dashboard for a Meal customer, THE 360_Dashboard SHALL display the following tabs: Profile & Medical, Add Subscription, Addresses, Billing, Coupons, and User Management
3. WHEN the franchise admin clicks View 360 Dashboard for a KIT customer, THE 360_Dashboard SHALL display the following tabs: Profile & Medical, KIT, Shipping, Addresses, Billing, and User Management
4. WHEN the franchise admin opens the 360_Dashboard for a KIT customer, THE 360_Dashboard SHALL NOT display a clinic assignment option since KIT customers are auto-assigned to the Franchise_Clinic during onboarding
5. WHEN the franchise admin clicks View 360 Dashboard, THE 360_Dashboard SHALL load and display the selected customer's data within 3 seconds under normal network conditions

### Requirement 14: Row-Level Quick Edit Action

**User Story:** As a franchise admin, I want to quickly edit basic customer information from the list view, so that I can make corrections without navigating away.

#### Acceptance Criteria

1. THE Franchise_Dashboard SHALL provide a "Quick Edit" action in each customer row's dropdown menu
2. WHEN the franchise admin clicks Quick Edit, THE Quick_Edit_Modal SHALL open displaying editable fields pre-populated with the customer's current values for: full name, mobile number, gender, date of birth, and dietary preference
3. WHEN the franchise admin submits the Quick Edit form with valid data, THE Quick_Edit_Modal SHALL update the customer record, close the modal, display a success confirmation message, and refresh the customer list to reflect the changes
4. IF the franchise admin submits the Quick Edit form with invalid data, THEN THE Quick_Edit_Modal SHALL display field-level validation errors indicating the specific issue for each invalid field, and SHALL remain open with all entered data preserved
5. THE Quick_Edit_Modal SHALL enforce the following validation rules: full name is required and between 2 and 100 characters; mobile number is required and must be a valid 10-digit Indian mobile number; gender must be one of Male, Female, or Other; date of birth must be a valid date not in the future and not more than 120 years in the past; dietary preference must be one of Veg or Non-Veg
6. IF the Quick Edit form submission fails due to a server error, THEN THE Quick_Edit_Modal SHALL display an error message indicating the update failed, and SHALL remain open with all entered data preserved
7. THE Quick_Edit_Modal SHALL only allow editing customers that belong to the franchise admin's own franchise

### Requirement 15: Row-Level Shipping Action (KIT Customers)

**User Story:** As a franchise admin, I want a shipping action for KIT customers, so that I can quickly navigate to manage their product shipments.

#### Acceptance Criteria

1. WHEN a customer row is displayed on the KIT_Customers_Tab, THE Franchise_Dashboard SHALL provide a "Shipping" action in the row dropdown menu alongside the existing "View 360 Dashboard" and "Quick Edit" actions
2. WHEN the franchise admin clicks the Shipping action, THE Franchise_Dashboard SHALL navigate to the customer 360 dashboard with the Shipping tab pre-selected (`/franchise/customers/[id]?tab=Shipping`)
3. THE Franchise_Dashboard SHALL NOT display the "Shipping" action in the row dropdown menu on the Meal_Customers_Tab

### Requirement 16: Data Columns Enhancement

**User Story:** As a franchise admin, I want richer data columns in the customer list, so that I can see important customer details at a glance.

#### Acceptance Criteria

1. THE Franchise_Dashboard SHALL display a Diet and Allergy column showing the customer's dietary preference value ("Veg" or "Non-Veg") as a badge, followed by the allergy text (truncated to 30 characters with an ellipsis if longer) when the customer has a non-empty allergies field
2. WHEN a customer has no allergies recorded, THE Franchise_Dashboard SHALL display only the dietary preference badge in the Diet and Allergy column with no allergy sub-label
3. IF a customer's `has_medical_history` field is true, THEN THE Franchise_Dashboard SHALL display a Medical History indicator badge in the Medical History column for that customer row
4. IF a customer's `has_medical_history` field is false, THEN THE Franchise_Dashboard SHALL display no indicator in the Medical History column for that customer row
5. THE Franchise_Dashboard SHALL display a Clinic column showing the name of the clinic resolved from the customer's `clinic_id` foreign key
6. IF a customer has no assigned clinic (clinic_id is null), THEN THE Franchise_Dashboard SHALL display a dash character ("—") in the Clinic column
7. THE Franchise_Dashboard SHALL display a Category column showing the customer's subscription category as a badge with the value "MEAL" or "KIT"
8. IF a customer has no subscription category recorded, THEN THE Franchise_Dashboard SHALL display a dash character ("—") in the Category column

### Requirement 17: Franchise-Specific Constraints

**User Story:** As the system, I want to enforce franchise-specific business rules, so that the dashboard respects franchise data boundaries and access patterns.

#### Acceptance Criteria

1. THE Franchise_Dashboard SHALL only display customers whose `franchise_id` matches the authenticated user's resolved `franchise_id`, returning an empty state with zero customer records when no matching customers exist
2. THE Franchise_Dashboard SHALL NOT render a Bulk Import action button, and IF a franchise-scoped user navigates directly to the Bulk Import route, THEN THE system SHALL redirect the user to the Franchise_Dashboard landing page
3. THE Franchise_Dashboard SHALL NOT include a Clinic filter dropdown
4. THE Franchise_Dashboard SHALL NOT display subscription analytics, subscription lists, pause credit utilization, or subscription ending-soon data on the Overview_Tab
5. WHEN creating a customer through Quick_Onboard_Route, THE system SHALL resolve the customer's `clinic_id` from the franchise's associated clinic (via the Franchise → Group → Kitchen → Clinic hierarchy) and assign it automatically without requiring manual clinic selection
6. IF the franchise's associated clinic cannot be resolved during Quick_Onboard_Route (no clinic linked to the franchise's hierarchy), THEN THE system SHALL reject the onboarding and display an error message indicating that the franchise clinic configuration is incomplete
