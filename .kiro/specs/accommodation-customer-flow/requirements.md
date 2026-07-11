# Requirements Document

## Introduction

The Accommodation Customer Flow feature extends the ArogyaDiet platform to fully support the ACCOMMODATION customer category. While ACCOMMODATION already exists as a selectable primary category in the Quick Onboard form, it currently lacks dedicated fields, lifecycle management, daily health tracking, and customer-facing dashboard views. This feature implements the complete end-to-end flow: admin onboarding with accommodation-specific fields, stay lifecycle management, customer profile completion, accommodation-focused customer dashboard with health logging, admin health monitoring, stay extension/history, and add-on wellness service requests.

## Glossary

- **Quick_Onboard_Form**: The admin-facing multi-step wizard used to create new customer profiles during physical arrival at the property
- **Stay_Entry**: A single accommodation booking record representing one continuous stay period with its own billing
- **Stay_Status**: The lifecycle state of a Stay_Entry — one of PENDING, ACTIVE, FINISHED, or EXPIRED
- **Stay_Type**: The accommodation type — either "AC Villa" or "Village Style Hut"
- **Occupancy_Type**: The room occupancy configuration — either "Single" or "Double"
- **Shared_Payment**: A billing arrangement where one guest's payment covers another guest's stay, eliminating payment tracking and invoice generation for the covered guest
- **Payment_Host**: The already-onboarded customer whose mobile number is referenced in a Shared_Payment arrangement
- **Health_Log_Customer**: Daily health data entered by the customer (water intake, physical activity)
- **Health_Log_Admin**: Daily health monitoring data entered by the admin (weight, blood pressure, sugar level, other metrics)
- **Add_On_Service**: Additional wellness services (therapy, massage) that accommodation customers can request
- **Profile_Completion_Popup**: The modal dialog shown on the customer dashboard until the customer completes mandatory onboarding fields
- **Medical_History_Confirmation**: Either a filled medical history textarea or an explicit checkbox confirming no medical history to share
- **Customer_360_Dashboard**: The admin-facing comprehensive view of a single customer's data organized in tabs
- **Accommodation_Tab**: The dedicated tab in Customer_360_Dashboard showing stay details, health logs, and stay management for accommodation customers
- **Stay_Tracker**: The customer-facing page showing the active stay details (dates, type, occupancy, status)
- **GST_Breakup**: The tax calculation where baseAmount = totalAmount / 1.18 and taxAmount = totalAmount - baseAmount at 18% GST

## Requirements

### Requirement 1: Accommodation-Specific Onboarding Fields

**User Story:** As an admin, I want the Quick Onboard form to display accommodation-specific fields when ACCOMMODATION is selected as primary category, so that I can capture stay details during customer arrival.

#### Acceptance Criteria

1. WHEN the admin selects "ACCOMMODATION" as the primary category in Step 2 of the Quick_Onboard_Form, THE Quick_Onboard_Form SHALL display the following fields: stay start date, total nights stay, stay type, occupancy type, payment amount, shared payment checkbox, and meal preference
2. THE Quick_Onboard_Form SHALL render stay start date as a date picker that accepts today or any future date up to 365 days from today without applying the 5 PM cutoff rule
3. THE Quick_Onboard_Form SHALL render total nights stay as a number input with a minimum value of 1 and a maximum value of 365
4. WHEN the admin enters a total nights stay value less than 7, THE Quick_Onboard_Form SHALL display a warning message indicating the recommended minimum is 7 nights without blocking form submission
5. THE Quick_Onboard_Form SHALL render stay type as a selection between "AC Villa" and "Village Style Hut"
6. THE Quick_Onboard_Form SHALL render occupancy type as a selection between "Single" and "Double"
7. THE Quick_Onboard_Form SHALL render payment amount as a numeric input field that accepts values between 1 and 9,999,999 representing the total amount inclusive of 18% GST entered by the admin
8. THE Quick_Onboard_Form SHALL render meal preference as a selection between "Veg", "Egg", and "Chicken"
9. WHEN the admin selects "ACCOMMODATION" as the primary category, THE Quick_Onboard_Form SHALL hide the subscription plan selection field and KIT-specific fields

### Requirement 2: Shared Payment Handling

**User Story:** As an admin, I want to mark a guest's payment as shared with an existing customer, so that I can onboard multiple guests under a single payment without duplicate billing.

#### Acceptance Criteria

1. WHEN the admin checks the "This is a shared payment" checkbox, THE Quick_Onboard_Form SHALL display a mobile number input field for entering the Payment_Host mobile number
2. WHEN the admin checks the shared payment checkbox, THE Quick_Onboard_Form SHALL hide the payment amount field
3. WHEN the admin clicks "Next" with shared payment enabled, THE System SHALL validate that the entered mobile number belongs to an existing accommodation customer with a Stay_Entry having Stay_Status of ACTIVE or PENDING
4. IF the shared payment mobile number does not match any existing accommodation customer with ACTIVE or PENDING stay status, THEN THE Quick_Onboard_Form SHALL display an error message indicating the referenced customer is not found or not eligible
5. IF the admin enters their own customer's mobile number (the same mobile being used in the current onboarding form) as the Payment_Host, THEN THE System SHALL reject the entry with an error message indicating a customer cannot be their own Payment_Host
6. WHEN shared payment is enabled for a customer, THE System SHALL store the Payment_Host customer_profile_id as a reference on the Stay_Entry record and disable payment tracking for that customer account
7. WHEN shared payment is enabled for a customer, THE System SHALL skip invoice and receipt generation for that customer account
8. WHEN the admin unchecks the shared payment checkbox, THE Quick_Onboard_Form SHALL hide the mobile number input field and re-display the payment amount field

### Requirement 3: Accommodation Onboarding Flow Modifications

**User Story:** As an admin, I want the onboarding flow to skip the address step for accommodation customers, so that the onboarding process is streamlined for guests staying on-property.

#### Acceptance Criteria

1. WHEN the primary category is "ACCOMMODATION" and the admin completes Step 2 (Category & Plan), THE Quick_Onboard_Form SHALL skip the Address step, display a 3-step stepper (Details, Category & Plan, Payment & Review), proceed directly to the Payment & Review step, and not require or validate address fields in either client-side form validation or server-side schema validation
2. THE Quick_Onboard_Form SHALL create individual customer profiles with unique mobile numbers for each accommodation guest, regardless of shared payment status
3. IF the admin attempts to onboard an accommodation customer with a mobile number that already exists in the system, THEN THE Quick_Onboard_Form SHALL display an error message indicating the mobile number is already registered and prevent form submission
4. WHEN the admin completes onboarding for an accommodation customer, THE System SHALL create a Stay_Entry record containing the customer reference, start date, total nights, stay type, occupancy type, payment amount, and Stay_Status set to PENDING if the start date (compared in IST) is after today, or ACTIVE if the start date is today
5. IF the Stay_Entry record creation fails during onboarding, THEN THE System SHALL not persist the customer profile and SHALL display an error message indicating the onboarding could not be completed

### Requirement 4: Stay Status Lifecycle Management

**User Story:** As a system operator, I want stay entries to automatically transition through lifecycle states, so that stay statuses accurately reflect the current state of each guest's visit.

#### Acceptance Criteria

1. WHEN the system creates a Stay_Entry with a start date after the current date (evaluated in IST timezone), THE System SHALL assign it Stay_Status PENDING
2. WHEN the daily stay-status cron job runs, THE System SHALL transition each PENDING Stay_Entry whose start date is on or before the current date (IST) and whose calculated end date (start date + total nights - 1) is on or after the current date (IST) to Stay_Status ACTIVE
3. WHEN the daily stay-status cron job runs, THE System SHALL transition each ACTIVE Stay_Entry whose calculated end date (start date + total nights - 1) is before the current date (IST) to Stay_Status FINISHED
4. WHEN an admin manually marks a Stay_Entry as a no-show (guest never arrived for a PENDING stay), THE System SHALL transition the Stay_Entry to Stay_Status EXPIRED
5. THE System SHALL compute the stay end date as: start date + total nights - 1 (dates inclusive)
6. THE System SHALL enforce the following valid status transitions only: PENDING to ACTIVE, PENDING to EXPIRED, ACTIVE to FINISHED, and SHALL reject any other transition attempt
7. IF the daily stay-status cron job encounters a database error during batch transition, THEN THE System SHALL log the error and return a failure response without partially committing transitions

### Requirement 5: Accommodation Payment and GST Calculation

**User Story:** As an admin, I want the system to automatically calculate and display the GST breakup from the total amount entered, so that invoices comply with tax regulations.

#### Acceptance Criteria

1. WHEN the admin enters a payment amount for an accommodation customer, THE System SHALL calculate the base amount as totalAmount divided by 1.18, rounded to two decimal places
2. WHEN the admin enters a payment amount for an accommodation customer, THE System SHALL calculate the tax amount as totalAmount minus the calculated base amount, rounded to two decimal places
3. THE System SHALL store the tax percentage as 18 for all accommodation payments
4. WHEN generating an invoice or receipt for an accommodation customer, THE System SHALL display the GST breakup showing base amount, 18% GST amount, and total amount, each formatted as currency values with two decimal places
5. IF shared payment is enabled for a customer, THEN THE System SHALL not create a payment record, invoice, or receipt for that customer
6. IF the admin enters a payment amount that is zero or negative for an accommodation customer, THEN THE System SHALL reject the entry and display an error message indicating that the amount must be greater than zero

### Requirement 6: Profile Completion Popup — Mandatory Medical History

**User Story:** As a customer, I want to be guided through completing my medical history during profile completion, so that the wellness team has the health information needed for my program.

#### Acceptance Criteria

1. WHEN an accommodation customer opens the Profile_Completion_Popup, THE Profile_Completion_Popup SHALL display accommodation-specific information (stay type, dates, occupancy) in the subscription section instead of Meal or KIT information
2. THE Profile_Completion_Popup SHALL display a medical history notes textarea with a maximum length of 2000 characters and a checkbox labeled "I confirm I don't have any medical history to share with ArogyaDiet"
3. WHILE the customer has not entered at least 1 non-whitespace character in the medical history textarea AND has not checked the medical history confirmation checkbox, THE Profile_Completion_Popup SHALL keep the "Mark complete onboarding" button disabled
4. IF the customer checks the medical history confirmation checkbox while the medical history textarea contains text, THEN THE Profile_Completion_Popup SHALL clear the textarea content and disable the textarea input
5. THE Profile_Completion_Popup SHALL display a document upload button below the medical history notes that accepts image and PDF files (maximum 5 files, each no larger than 10 MB)
6. THE Profile_Completion_Popup SHALL display an X close button at the top-right corner instead of a "Skip for now" button
7. WHEN a customer navigates to the /dashboard route AND onboarding_status is IN_PROGRESS, THE System SHALL display the Profile_Completion_Popup
8. WHEN the customer closes the popup via the X button without completing onboarding, THE System SHALL allow the customer to navigate to other pages and re-display the popup on the next /dashboard navigation
9. IF the customer unchecks the medical history confirmation checkbox, THEN THE Profile_Completion_Popup SHALL re-enable the medical history textarea for input

### Requirement 7: Accommodation Customer Sidebar Navigation

**User Story:** As an accommodation customer, I want my navigation sidebar to show only the sections relevant to my stay, so that I can easily access stay tracking, health logging, and billing without seeing irrelevant meal delivery options.

#### Acceptance Criteria

1. WHEN the customer category is "ACCOMMODATION", THE Customer_Sidebar SHALL display the following top-level nav items in order: Dashboard, My Profile
2. WHEN the customer category is "ACCOMMODATION", THE Customer_Sidebar SHALL display a "Stay Tracker" section header with two sub-items in order: Stay Tracker (linking to /stay-tracker) and Stay History (linking to /stay-history)
3. WHEN the customer category is "ACCOMMODATION", THE Customer_Sidebar SHALL display the following standalone nav items after the Stay Tracker section in order: My Health Logs (linking to /health-logs), Health Report (linking to /health-report), Add-on Services (linking to /addon-services)
4. WHEN the customer category is "ACCOMMODATION", THE Customer_Sidebar SHALL display Billing as the last nav item
5. WHEN the customer category is "ACCOMMODATION", THE Customer_Sidebar SHALL hide the following items and section headers: My Meals, New Subscription, Shop (including Browse Shop and My Orders sub-items), and Manage Meals (including Meal Planner and Delivery Address sub-items)
6. IF the customer category is not "ACCOMMODATION" and not "KIT", THEN THE Customer_Sidebar SHALL display the default navigation items without any accommodation-specific sections

### Requirement 8: Customer Stay Tracker

**User Story:** As an accommodation customer, I want to view my current stay details on a dedicated tracker page, so that I can see my stay type, dates, status, and occupancy at a glance.

#### Acceptance Criteria

1. THE Stay_Tracker page SHALL display the active Stay_Entry details including: stay type, occupancy type, start date, end date, remaining nights (calculated as end date minus current date), current Stay_Status, and a progress indicator showing the current day number out of total nights
2. WHILE no Stay_Entry has ACTIVE status for the customer, THE Stay_Tracker page SHALL display the PENDING stay with the earliest start date, or if no PENDING stay exists, display a message indicating no upcoming or active stay is found
3. THE Stay_History page SHALL display all Stay_Entry records with status FINISHED or EXPIRED for the customer in reverse chronological order (by start date) showing stay type, occupancy type, start date, end date, status, and total nights
4. WHILE no Stay_Entry with FINISHED or EXPIRED status exists for the customer, THE Stay_History page SHALL display a message indicating no past stay records are available

### Requirement 9: Customer Health Log Entry

**User Story:** As an accommodation customer, I want to log my daily water intake and physical activity, so that the wellness team can monitor my health engagement during my stay.

#### Acceptance Criteria

1. THE My_Health_Logs page SHALL display a form with fields: water intake (numeric input in liters, accepting values from 0.1 to 15.0 in 0.1 increments), physical activity name (text input, maximum 100 characters), and activity duration (numeric input accepting values from 1 to 1440, with a unit selector for minutes or hours)
2. WHEN the customer submits a health log entry, THE System SHALL store the entry associated with the current date and the active Stay_Entry, upserting on conflict with the same stay_entry_id and log_date so that only one entry exists per day per stay
3. WHEN the customer submits a health log entry and an entry already exists for the current date, THE System SHALL update the existing entry with the new values and display a confirmation indicating the entry was updated
4. IF the customer submits a health log entry with any field value outside its accepted range or with an empty physical activity name when a duration is provided, THEN THE System SHALL reject the submission, display inline validation errors on the offending fields, and preserve the entered data in the form
5. THE My_Health_Logs page SHALL display previously entered log entries for the current stay in a date-ordered list view showing the log date, water intake, activity name, and activity duration for each entry
6. WHILE no Stay_Entry has ACTIVE status, THE My_Health_Logs page SHALL disable the log entry form and display a message indicating logging is available during active stays only

### Requirement 10: Customer Health Report View

**User Story:** As an accommodation customer, I want to view the daily health metrics recorded by the admin during my checkups, so that I can track my weight, blood pressure, and sugar levels over time.

#### Acceptance Criteria

1. THE Health_Report page SHALL display admin-entered health data for the active Stay_Entry in a read-only format, showing each recorded entry grouped by date with the following metrics where available: weight (kg), blood pressure (systolic/diastolic in mmHg), sugar level (mg/dL), and any additional metrics the admin recorded
2. THE Health_Report page SHALL present health data entries in ascending chronological order (oldest date first) with each entry displaying its recorded date as a label
3. WHILE no admin-entered health data exists for the active Stay_Entry, THE Health_Report page SHALL display a message indicating no health records are available yet
4. IF a health data entry is missing one or more metric values for a given date, THEN THE Health_Report page SHALL display only the metrics that were recorded for that date without showing empty placeholders for missing metrics
5. WHILE no Stay_Entry has ACTIVE status for the customer, THE Health_Report page SHALL display health data from the most recent FINISHED Stay_Entry, or a message indicating no stay records exist if no past stays are found

### Requirement 11: Add-On Services Request

**User Story:** As an accommodation customer, I want to request additional wellness services like therapy and massage, so that I can enhance my health program during my stay.

#### Acceptance Criteria

1. THE Add_On_Services page SHALL display available service categories as individual service cards, where each card includes a service name, a visual icon or image, a brief description (maximum 150 characters), and a request button
2. WHEN the customer selects a service and submits a request, THE System SHALL store the request with the customer profile, selected service type, associated stay entry, and request timestamp, and SHALL display a confirmation message indicating the request was submitted successfully with a PENDING status
3. THE Add_On_Services page SHALL display a list of previously submitted requests ordered by request timestamp descending, showing for each entry the service type, submission timestamp, and a status badge indicating one of: PENDING, CONFIRMED, or COMPLETED
4. IF the service request submission fails due to a system error or network issue, THEN THE System SHALL display an error message indicating the request could not be submitted and SHALL preserve the customer's selected service so they can retry without re-selecting

### Requirement 12: Admin Accommodation Customers Tab

**User Story:** As an admin, I want a dedicated "Accommodation Customers" tab in the customer list, so that I can manage accommodation guests separately from Meal and KIT customers.

#### Acceptance Criteria

1. THE Admin_Customer_List SHALL display an "Accommodation Customers" tab positioned after the "KIT Customer" tab and before the "Onboarded" tab within the AdminSubmenuBar
2. WHEN the admin selects the "Accommodation Customers" tab, THE Admin_Customer_List SHALL display all customers whose subscription customer_category equals "ACCOMMODATION" in a table with the following columns: Customer Info, Contact, Diet & Allergy, Stay Status (badge), Stay Type, and Medical History
3. THE Accommodation_Customers tab SHALL provide the same search functionality (by Name, Phone Number, Email, and Pincode) and the same filter controls (Diet & Allergy filter, Status filter, Medical History filter, Show Archived toggle) as the Meal Customers tab, excluding the Clinic filter
4. IF no customers with category "ACCOMMODATION" exist, THEN THE Accommodation_Customers tab SHALL display an empty state message within the table indicating no accommodation customers match the current criteria

### Requirement 13: Admin Customer 360 — Accommodation Tab

**User Story:** As an admin, I want an Accommodation tab in the Customer 360 Dashboard for accommodation customers, so that I can manage their stay details, enter health data, and extend or add stays.

#### Acceptance Criteria

1. WHEN viewing an accommodation customer in Customer_360_Dashboard, THE System SHALL display tabs: "Profile & Medical", "Accommodation", "Billing", and "User Management"
2. WHEN viewing an accommodation customer in Customer_360_Dashboard, THE System SHALL hide the following tabs: KIT, Shipping, Addresses, Coupons, Add Subscription, and Clinic Assignment
3. IF the customer has an active Stay_Entry, THEN THE Accommodation_Tab SHALL display the active stay overview showing: stay type, occupancy type, start date, end date, and current Stay_Status
4. IF the customer has no active Stay_Entry, THEN THE Accommodation_Tab SHALL display an empty state message indicating no current stay and present only the "Add Stay" action
5. THE Accommodation_Tab SHALL display a health log entry form for the admin to record daily health metrics: date, weight in kg (30.0-300.0), blood pressure systolic (60-250 mmHg), blood pressure diastolic (40-150 mmHg), sugar level in mg/dL (30-600), and a notes field (maximum 500 characters)
6. THE Accommodation_Tab SHALL display customer-entered health logs (water intake, activity) in a read-only tabular view sorted by date descending
7. THE Accommodation_Tab SHALL provide an "Add Stay" action that allows the admin to create a new Stay_Entry with stay type, occupancy, start date, total nights, and payment amount
8. IF the customer has an active Stay_Entry, THEN THE Accommodation_Tab SHALL provide an "Extend Stay" action allowing the admin to add 1-365 additional nights to the current stay end date with a separate payment amount
9. THE Accommodation_Tab SHALL display the complete stay history for the customer showing all past and current Stay_Entry records sorted by start date descending

### Requirement 14: Stay Extension and New Stay Creation

**User Story:** As an admin, I want to extend a customer's current stay or create a new stay entry for returning guests, so that I can handle mid-stay extensions and repeat visits with proper billing.

#### Acceptance Criteria

1. WHEN the admin extends an active Stay_Entry by specifying additional nights (1 to 365) and an additional payment amount, THE System SHALL recalculate the end date as current_end_date + additional_nights and record a new payment entry for the extension amount with the GST breakup (18% inclusive)
2. IF the admin attempts to extend a Stay_Entry that is not in ACTIVE status, THEN THE System SHALL reject the operation and display an error message indicating that only active stays can be extended
3. WHEN the admin creates a new Stay_Entry for a customer whose most recent Stay_Entry has a status of FINISHED or EXPIRED, THE System SHALL create a fresh Stay_Entry with its own start date, duration, stay type, occupancy, and payment amount, and initialize a new health log sheet for that stay
4. IF the admin attempts to create a new Stay_Entry while the customer has an existing ACTIVE or PENDING Stay_Entry, THEN THE System SHALL reject the creation and display an error message indicating that the current stay must be finished or expired before a new one can be created
5. THE System SHALL maintain the complete history of all Stay_Entry records for each customer, displaying each entry with its start date, end date, duration, status, and payment details, accessible from both the customer Stay History page and the admin Accommodation_Tab
6. WHEN extending a stay, THE System SHALL apply the 18% inclusive GST calculation to the extension payment amount, recording both the base amount and tax amount separately in the payment entry

### Requirement 15: UI and Responsiveness

**User Story:** As a user (customer or admin), I want accommodation-related pages to follow the platform's design patterns and be fully responsive, so that the experience is consistent and usable across devices.

#### Acceptance Criteria

1. THE accommodation customer dashboard pages SHALL use only Shadcn UI components and Tailwind CSS utility classes present in the existing platform design system, with no introduction of additional component libraries or custom CSS frameworks
2. THE accommodation customer dashboard pages SHALL render a single-column stacked layout on viewports below 768px, a two-column layout on viewports between 768px and 1023px, and a multi-column layout on viewports 1024px and above, with all interactive elements maintaining a minimum touch target size of 44x44px on viewports below 768px
3. THE admin accommodation management pages SHALL use the platform's existing DataTable component for list views, Card component for summary statistics, and form layout patterns consistent with other admin portal pages
4. THE Stay_Tracker page SHALL display tracked metrics using Card components with numeric values and progress indicators, and THE Health_Report page SHALL present health data using Card components with visual data representations where each data point is accompanied by a label and unit of measurement
5. THE Add_On_Services page SHALL present each service option as a Card component containing the service name, description, and a call-to-action button, arranged in a responsive grid (single column below 768px, two columns at 768px-1023px, three columns at 1024px and above)
6. WHILE any accommodation page is loading data, THE system SHALL display skeleton placeholders matching the dimensions of the expected content layout until data is rendered or an error state is shown
7. THE accommodation customer dashboard pages SHALL maintain a minimum color contrast ratio of 4.5:1 for all text content and 3:1 for interactive component boundaries, and all form inputs SHALL have associated visible labels
