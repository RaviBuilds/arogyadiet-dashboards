# Requirements Document

## Introduction

The ArogyaDiet KIT subscription is a recurring product — customers may purchase multiple KITs over their lifetime, each with its own duration, tracking period, and expiration. The current system supports a single active KIT per customer with daily tracking (kit-subscription spec) and onboarding/shipping (kit-subscription-management spec), but lacks automated expiration handling, renewal workflows, historical record-keeping, and report generation.

This feature introduces comprehensive KIT lifecycle management covering: automated expiration detection via a daily cron job, admin list filtering for expired customers, a "Send New KIT" workflow from the admin Customer 360 Dashboard, customer-side new KIT arrival and start flow, expiration messaging with renewal prompts, a KIT History page with full lifecycle visibility, and PDF report generation for each KIT period.

## Glossary

- **KIT_Subscription**: A record in the `subscriptions` table where `customer_category = 'KIT'`, representing one purchased KIT period.
- **KIT_Status**: The lifecycle state of a KIT_Subscription: ACTIVE (in use), EXPIRED (all days consumed), or PENDING (not yet started).
- **Tracker_End_Date**: The last date of the active tracking window, computed as `kit_received_date + (kit_duration_days - 1) + kit_total_skipped_days`.
- **Expiration_Cron**: A scheduled daily automation that identifies KIT_Subscriptions whose tracking period has completed and transitions their status to EXPIRED.
- **Admin_Portal**: Desktop-first operations interface at admin.domain.com.
- **Customer_Portal**: Customer-facing interface at customer.domain.com.
- **Customer_360_Dashboard**: The admin's detailed view of a single customer profile, accessible via the "View 360 Dashboard" action.
- **KIT_Customer_List**: The admin table showing all KIT-category customers with status, shipment, and action columns.
- **Send_New_KIT_Workflow**: An admin-initiated multi-step process to create a new KIT_Subscription for an existing customer.
- **KIT_History_Page**: A customer-facing page listing all KIT_Subscriptions (past and current) with status, duration, and report download.
- **KIT_Report**: A PDF document containing day-wise breakdown of all daily log data for a specific KIT_Subscription.
- **Meal_Preference**: Customer dietary choice for a KIT: Veg, Egg, or Chicken.
- **Shipping_Info**: Record in `kit_shipping_info` containing courier partner, tracking number, tracking URL, shipped_at, and delivered_at timestamps.
- **WhatsApp_Support**: The existing support chat CTA that opens a WhatsApp conversation with the support team.
- **CRON_SECRET**: Environment variable used to authenticate cron endpoint requests.

## Requirements

### Requirement 1: Automated KIT Expiration Detection

**User Story:** As a platform operator, I want KIT subscriptions to be automatically marked as EXPIRED when all tracking days are consumed, so that the system accurately reflects each KIT's lifecycle state without manual intervention.

#### Acceptance Criteria

1. THE Expiration_Cron SHALL execute daily via a Vercel Cron Job at a configured UTC schedule targeting approximately 00:00–01:00 IST (18:30–19:30 UTC previous day).
2. WHEN the Expiration_Cron executes, THE System SHALL identify all KIT_Subscriptions where status is ACTIVE, customer_category is "KIT", kit_received_date is not null, and the current IST date is greater than the computed Tracker_End_Date (kit_received_date + (kit_duration_days - 1) + kit_total_skipped_days).
3. WHEN one or more KIT_Subscriptions meet the expiration criteria defined in criterion 2, THE System SHALL update each matching KIT_Subscription's status from ACTIVE to EXPIRED atomically — either all qualifying records are updated successfully or none are committed.
4. WHEN the Expiration_Cron invocation lacks a valid CRON_SECRET query parameter matching the server-side environment variable, THE System SHALL reject the request with HTTP 401 and SHALL NOT modify any KIT_Subscription records.
5. IF the Expiration_Cron encounters a database error during status updates, THEN THE System SHALL return an HTTP 500 response, log the error details, and SHALL NOT partially commit status changes (all updates are rolled back).
6. WHEN the Expiration_Cron completes successfully with zero or more transitions, THE System SHALL return an HTTP 200 response containing the count of KIT_Subscriptions transitioned to EXPIRED in that execution.
7. THE Expiration_Cron SHALL NOT modify KIT_Subscriptions that have status PENDING or EXPIRED, have no kit_received_date, have customer_category other than "KIT", or whose Tracker_End_Date is on or after the current IST date.
8. THE Expiration_Cron SHALL be idempotent — if executed multiple times on the same day, subsequent executions SHALL return HTTP 200 with a count of 0 when no additional KIT_Subscriptions meet the expiration criteria, and SHALL NOT produce duplicate state transitions or errors.

### Requirement 2: Admin KIT Customer List — Expired Filtering

**User Story:** As an admin, I want EXPIRED KIT customers hidden from the default active list with a toggle to view them separately, so that I can focus on active customers while still accessing expired records when needed.

#### Acceptance Criteria

1. THE KIT_Customer_List SHALL display only KIT customers whose most recent KIT_Subscription status is ACTIVE or PENDING by default, excluding customers whose most recent KIT_Subscription status is EXPIRED.
2. THE KIT_Customer_List SHALL display a "Show Expired" toggle button adjacent to the existing "Show Archived" button, using the same Button component and size.
3. WHEN the "Show Expired" toggle is activated, THE KIT_Customer_List SHALL replace the default list and display only KIT customers whose most recent KIT_Subscription status is EXPIRED.
4. WHEN the "Show Expired" toggle is activated, THE KIT_Customer_List SHALL visually indicate the toggle is active using the "default" button variant, and SHALL revert to the "outline" variant when deactivated, consistent with the existing "Show Archived" toggle styling.
5. THE "Show Archived" and "Show Expired" toggles SHALL operate independently — activating one SHALL NOT deactivate the other.
6. WHEN both "Show Archived" and "Show Expired" toggles are active simultaneously, THE KIT_Customer_List SHALL display the union of customers matching archived status or EXPIRED KIT status, with each customer appearing at most once regardless of how many filter conditions they satisfy.
7. WHEN the "Show Expired" toggle is active and no KIT customers with EXPIRED status exist, THE KIT_Customer_List SHALL display the existing empty-state message indicating no KIT customers found.

### Requirement 3: Admin Send New KIT — Eligibility and Trigger

**User Story:** As an admin, I want to see a "Send New KIT" option for customers whose KIT is expired or expiring soon, so that I can initiate renewal without navigating away from the customer profile.

#### Acceptance Criteria

1. WHEN viewing a customer's Customer_360_Dashboard whose most recent KIT_Subscription has status EXPIRED, THE Admin_Portal SHALL display a "Send New KIT" action button.
2. WHEN viewing a customer's Customer_360_Dashboard whose most recent KIT_Subscription is ACTIVE and the difference between Tracker_End_Date and the current IST date is less than or equal to 5 calendar days, THE Admin_Portal SHALL display a "Send New KIT" action button.
3. THE Admin_Portal SHALL NOT display the "Send New KIT" action button for customers whose most recent KIT_Subscription is ACTIVE with more than 5 calendar days remaining until Tracker_End_Date.
4. THE Admin_Portal SHALL NOT display the "Send New KIT" action button for customers whose most recent KIT_Subscription has status PENDING (KIT not yet received/started).
5. IF the customer already has a KIT_Subscription with status PENDING (a new KIT has already been sent), THEN THE Admin_Portal SHALL NOT display the "Send New KIT" action button regardless of the most recent non-PENDING KIT_Subscription's status.
6. THE Admin_Portal SHALL NOT display the "Send New KIT" action button for customers who have no KIT_Subscription records.

### Requirement 4: Admin Send New KIT — Workflow Form

**User Story:** As an admin, I want a structured workflow to configure and send a new KIT order, so that all necessary details (product, duration, meal preference, address, shipping, payment) are captured before activation.

#### Acceptance Criteria

1. WHEN the admin selects the "Send New KIT" action, THE Admin_Portal SHALL display a multi-section form containing: KIT Product selection, KIT Duration days, Meal Preference selection, Address selection, Shipping details, and Payment confirmation.
2. THE KIT Product selection SHALL display all active KIT products from the kit_products table with their names and prices.
3. THE KIT Duration days field SHALL accept a positive integer value between 1 and 365 representing the number of days for the new KIT period.
4. THE Meal Preference selection SHALL provide exactly three options: Veg, Egg, and Chicken.
5. THE Address selection SHALL display all existing addresses associated with the customer profile and provide an option to add a new address inline.
6. WHEN the admin chooses to add a new address, THE Admin_Portal SHALL display address input fields (address line minimum 5 characters, city, state, PIN code as exactly 6 digits) and persist the new address to the customer's profile upon form submission.
7. THE Shipping details section SHALL contain fields for courier partner (dropdown with options: Other shipping, APSRTC Logistics, TGSRTC Logistics, DTDC), tracking number (text, minimum 1 character), and tracking URL (text input, displayed and required only when "Other shipping" is selected as courier partner).
8. THE Payment confirmation section SHALL contain a "Mark as Paid" toggle that must be activated before submission.
9. THE Admin_Portal SHALL disable the "Send KIT" submission button until all required fields are completed: KIT product, duration, meal preference, address, courier partner, tracking number, payment marked as paid, and tracking URL when courier partner is "Other shipping".
10. WHEN the admin submits the "Send KIT" form with all required fields, THE System SHALL create a new KIT_Subscription record with status PENDING, associate the selected KIT product, duration, and meal preference, create a kit_shipping_info record with the provided shipping details and shipped_at set to the current timestamp, and return a success confirmation.
11. IF the form submission fails due to a database or network error, THEN THE Admin_Portal SHALL display an error message indicating the KIT order could not be created, SHALL NOT navigate away from the form, and SHALL preserve all entered field values.
12. IF the customer already has an existing KIT_Subscription with status PENDING, THEN THE Admin_Portal SHALL NOT allow submission of a new KIT order and SHALL display a message indicating a pending KIT already exists for this customer.

### Requirement 5: Customer Portal — New KIT Arrival Notification

**User Story:** As a KIT customer, I want to see shipping information when a new KIT is sent to me, so that I can track my incoming package.

#### Acceptance Criteria

1. WHEN admin creates a new KIT_Subscription via the Send New KIT workflow, THE Customer_Portal dashboard SHALL display updated Shipping Information with the new KIT's courier partner, tracking number, tracking URL (if applicable), and shipped_at timestamp on next page load.
2. IF a customer has an EXPIRED KIT_Subscription and a new PENDING KIT_Subscription exists (ordered by created_at descending), THEN THE Customer_Portal dashboard SHALL display the new KIT's shipping and product information (product name, base price, duration) instead of the expired KIT details.
3. THE Customer_Portal KIT Tracker page SHALL display a notification banner stating "New KIT has been sent" with a visible "Mark as KIT Received" action button when the most recent KIT_Subscription has status PENDING with a kit_shipping_info record (shipped_at is set) and kit_received_date is null.
4. IF the most recent KIT_Subscription has status PENDING but no kit_shipping_info record exists, THEN THE Customer_Portal KIT Tracker page SHALL display a message indicating the KIT order is being processed and SHALL NOT display the "Mark as KIT Received" button.

### Requirement 6: Customer Portal — KIT Receipt and Start Flow

**User Story:** As a KIT customer, I want to mark my new KIT as received and then explicitly choose when to start it, so that my tracking days begin only when I am ready.

#### Acceptance Criteria

1. WHEN the customer selects "Mark as KIT Received" for a PENDING KIT_Subscription, THE System SHALL update the kit_shipping_info delivered_at timestamp to the current server date and time (IST) and SHALL NOT automatically set the kit_received_date or start the KIT tracking period.
2. WHEN the customer has marked a KIT as received (delivered_at is set and kit_received_date is null), THE Customer_Portal KIT Tracker page SHALL display a "Start your new KIT" section containing a date picker calendar defaulting to the current server date (IST) and a "Start New KIT" action button.
3. THE date picker for starting a new KIT SHALL NOT allow selection of a date in the future (relative to the current server date in IST) and SHALL NOT allow selection of a date earlier than the kit_shipping_info delivered_at date.
4. WHEN the customer selects "Start New KIT" with a valid date, THE System SHALL set kit_received_date to the selected date, compute and set kit_tracker_end_date as (kit_received_date + kit_duration_days - 1 + kit_total_skipped_days), update the KIT_Subscription status from PENDING to ACTIVE, and transition the KIT Tracker view to the Daily_Tracker_Calendar for the new KIT.
5. IF the customer selects "Start New KIT" and another KIT_Subscription for the same customer currently has status ACTIVE, THEN THE System SHALL reject the start action, preserve the PENDING status unchanged, and display an error message indicating the existing KIT must expire before a new KIT can be started.
6. IF the "Start New KIT" action fails due to a database error, THEN THE System SHALL display an error message indicating the KIT could not be started, SHALL NOT modify the KIT_Subscription status, and SHALL preserve the selected date for retry.

### Requirement 7: Customer Portal — KIT Expiration Messaging

**User Story:** As a KIT customer whose KIT has expired, I want clear messaging about what happened and what to do next, so that I understand my options for continuing.

#### Acceptance Criteria

1. WHEN a customer's most recent KIT_Subscription (ordered by created_at descending) has status EXPIRED and no other KIT_Subscription with status PENDING or ACTIVE exists for that customer, THE KIT Tracker page SHALL display the message "KIT has been expired, contact the admin to issue new KIT" in place of the daily tracker calendar.
2. THE expiration message SHALL include a "Contact Admin" CTA button that opens the existing WhatsApp_Support chat interface in a new browser tab using the same WhatsApp link pattern as the FloatingSupportMenu "Customer Support" option.
3. WHEN a customer's most recent KIT_Subscription has status EXPIRED and a newer KIT_Subscription exists with delivered_at set in kit_shipping_info (customer has received new KIT), THE KIT Tracker page SHALL display "Start your new KIT" with the date picker and "Start New KIT" button instead of the expiration message.
4. WHEN a customer's most recent KIT_Subscription has status EXPIRED and a newer KIT_Subscription exists with status PENDING but delivered_at is not set in kit_shipping_info (shipped but not received), THE KIT Tracker page SHALL display "New KIT has been sent" notification with the "Mark as KIT Received" button instead of the expiration message.
5. THE KIT Tracker page SHALL evaluate display states in the following priority order (highest first): criterion 3 (new KIT received, show start flow), then criterion 4 (new KIT shipped, show receipt flow), then criterion 1 (no new KIT, show expiration message). The first matching condition SHALL determine the displayed content.

### Requirement 8: Customer Portal — KIT History Page

**User Story:** As a KIT customer, I want a dedicated page showing all my KIT subscriptions over time, so that I can review my complete KIT history in one place.

#### Acceptance Criteria

1. THE Customer_Portal SHALL display a "KIT History" navigation item in the customer sidebar within the KIT TRACKER section, visible only to customers with Customer_Category "KIT".
2. THE KIT_History_Page SHALL display all KIT_Subscriptions associated with the customer (including ACTIVE, EXPIRED, and PENDING) in a table format, ordered by creation date descending (newest first).
3. THE KIT_History_Page table SHALL display the following columns: Order Date (subscription created_at timestamp), KIT Package Name (from kit_products), KIT Days (kit_duration_days), Days Taken Meal (count of Food_Taken daily logs for that subscription), Days Skipped (kit_total_skipped_days), KIT Status (ACTIVE, EXPIRED, or PENDING), Shipping Status (from kit_shipping_info), and Kit Report (PDF download icon).
4. THE KIT Status column SHALL display ACTIVE with a green badge, PENDING with a yellow badge, and EXPIRED with a gray badge.
5. THE Shipping Status column SHALL display "Not Shipped" when no kit_shipping_info record exists or shipped_at is null, "Shipped" when shipped_at is set and delivered_at is null, or "Delivered" when delivered_at is set.
6. IF a KIT_Subscription has status PENDING, THEN THE KIT_History_Page SHALL display the Kit Report PDF download icon in a disabled state and SHALL NOT allow download.
7. IF a customer has no KIT_Subscriptions, THEN THE KIT_History_Page SHALL display a message indicating no KIT history is available.
8. THE KIT_History_Page SHALL render as responsive cards on viewports narrower than 768px, displaying all column data in a stacked layout per subscription.

### Requirement 9: KIT Report PDF Generation — Active KIT

**User Story:** As a KIT customer, I want to download a PDF report of my current active KIT showing day-wise data up to today, so that I can review my progress at any time.

#### Acceptance Criteria

1. WHEN the customer selects the PDF download icon for an ACTIVE KIT_Subscription in the KIT_History_Page, THE System SHALL generate a PDF report containing day-wise data from kit_received_date through the current date and deliver it as a browser download.
2. THE PDF report for an ACTIVE KIT SHALL include for each logged day: the date, Food_Taken or Food_Skipped status, weight_kg, step_count, physical_activity_minutes, physical_activity_name, water_intake_liters, buttermilk_intake, fat_consumption, main_dish, protein_curry, veg_curry, soup_name_qty, eggs_count, and salads_qty.
3. THE PDF report SHALL display days with no Daily_Log as "No Data Logged" for that date entry, and days with Food_Skipped status SHALL display only the date and status without activity or nutrition fields.
4. THE PDF report header SHALL include the customer name, KIT product name, KIT duration, start date (kit_received_date), and current status "ACTIVE".
5. FOR an ACTIVE KIT, THE System SHALL generate the PDF dynamically on each download request to include the latest logged data.
6. IF PDF generation encounters a database error or exceeds 30 seconds, THEN THE System SHALL display an error message to the customer indicating the report could not be generated and SHALL NOT serve a partial or empty PDF.
7. THE System SHALL only allow PDF download for the authenticated customer's own KIT_Subscriptions and SHALL reject requests for subscriptions belonging to other customers with an authorization error.

### Requirement 10: KIT Report PDF Generation — Expired KIT

**User Story:** As a KIT customer, I want to download a complete final PDF report for my expired KITs, so that I have a permanent record of my full KIT journey.

#### Acceptance Criteria

1. WHEN the customer selects the PDF download icon for an EXPIRED KIT_Subscription in the KIT_History_Page, THE System SHALL generate a PDF report containing day-wise data for the complete KIT period from kit_received_date through Tracker_End_Date.
2. THE PDF report for an EXPIRED KIT SHALL include a header section with the customer name, KIT product name, KIT duration, start date (kit_received_date), Tracker_End_Date, and status "EXPIRED", followed by day-wise entries containing all fields defined in Requirement 9 criterion 2 for each day in the complete tracking period, and SHALL display days with no Daily_Log as "No Data Logged" for that date entry.
3. THE PDF report for an EXPIRED KIT SHALL include a summary section showing: total days taken meal, total days skipped, total duration including extensions (kit_duration_days + kit_total_skipped_days), and KIT completion date (Tracker_End_Date).
4. WHERE PDF caching is enabled, THE System SHALL cache the generated PDF after first generation and serve the cached version on subsequent download requests for the same EXPIRED KIT_Subscription.
5. IF PDF generation encounters an error (database unavailable, data corruption, or generation exceeds 30 seconds), THEN THE System SHALL display an error message to the customer indicating the report could not be generated and SHALL NOT serve a partial or empty PDF.
6. WHEN PDF generation is initiated for an EXPIRED KIT, THE System SHALL display a loading indicator to the customer until the PDF is ready for download or an error is returned.

### Requirement 11: Recurring KIT Lifecycle Data Model

**User Story:** As a system administrator, I want the data model to support multiple KIT subscriptions per customer over time, so that the full purchase-ship-receive-track-expire-renew lifecycle is properly represented.

#### Acceptance Criteria

1. THE System SHALL support multiple KIT_Subscription records per customer_profile_id, each representing a distinct KIT purchase period.
2. THE System SHALL enforce a partial unique constraint on (customer_profile_id, customer_category) where status is in (PENDING, ACTIVE), ensuring at most one non-terminal KIT_Subscription per customer exists at any given time.
3. WHEN a new KIT_Subscription is created via the Send New KIT workflow, THE System SHALL associate it with the same customer_profile_id as the previous KIT, assign status PENDING, and SHALL only succeed if the customer has no existing KIT_Subscription with status ACTIVE or PENDING.
4. IF the creation of a new KIT_Subscription would violate the one-active-or-pending constraint, THEN THE System SHALL reject the operation and return an error indicating that an active or pending KIT already exists for that customer.
5. THE System SHALL retain all historical KIT_Subscription records (EXPIRED status) indefinitely, prohibiting both hard-deletion and soft-deletion of any KIT_Subscription record regardless of status.
6. THE System SHALL associate kit_daily_logs records with a specific KIT_Subscription via subscription_id foreign key, ensuring daily logs from different KIT periods remain distinct and queryable independently per subscription.
7. THE System SHALL associate kit_shipping_info records with both the customer_profile_id and the specific subscription_id via foreign keys, enabling shipping history retrieval per KIT period.

### Requirement 12: KIT Lifecycle Isolation from Meal Subscriptions

**User Story:** As a system administrator, I want KIT lifecycle management to remain fully isolated from meal subscription logic, so that expiration, renewal, and history features do not impact meal customers.

#### Acceptance Criteria

1. THE Expiration_Cron SHALL only query and update subscriptions where customer_category equals "KIT" and SHALL NOT modify any subscription with customer_category "Meals" or "Accommodation".
2. THE Send_New_KIT_Workflow SHALL only be visible and executable for customers with Customer_Category "KIT" and SHALL NOT appear in the UI or execute for customers with Customer_Category "Meals" or "Accommodation".
3. THE KIT_History_Page and KIT Report features SHALL only query and render data for KIT_Subscriptions and SHALL NOT query, render, or include any Meal_Subscription or Accommodation_Subscription data in their outputs.
4. THE "Show Expired" toggle on the KIT_Customer_List SHALL filter based on KIT_Subscription status and SHALL NOT alter the data or visibility of customers on the Meal_Customer_List or Accommodation_Customer_List.
5. IF a KIT lifecycle action (Expiration_Cron status update, Send_New_KIT_Workflow submission, KIT Report generation) is invoked with a subscription_id or customer_profile_id whose customer_category is not "KIT", THEN THE System SHALL reject the operation without modifying any data and SHALL return an error indicating a category mismatch.
6. IF a customer_profile has subscriptions in multiple categories (e.g., both a Meal_Subscription and a KIT_Subscription), THEN THE KIT lifecycle features SHALL operate exclusively on that customer's KIT_Subscription records and SHALL NOT read, modify, or display the customer's Meal or Accommodation subscription records.
