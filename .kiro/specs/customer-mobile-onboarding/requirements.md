# Requirements Document

## Introduction

This feature overhauls the ArogyaDiet customer portal (`customer.arogyadiet.com`) and the admin customer-management workflow to move from an email-first, self-service model to a **mobile-first, admin-initiated onboarding** model.

The current reality of the business is that every customer visits the clinic in person, receives a dietitian consultation, and is recommended a food (meal) subscription. The admin therefore needs to create a customer account quickly with only priority information, attach a subscription plan, collect payment at the counter, and mark payment done — so the customer enters the food delivery routing from the selected start date. The customer later logs into the customer app using **only their mobile number + a 6-digit PIN** and finishes the remaining profile details at their own pace. During quick onboarding the admin sets a one-time (temporary) PIN for the customer; the customer logs in with mobile + PIN, and on the first login with the temporary PIN they are forced to set a new PIN before accessing the rest of the app. Thereafter the customer can change the PIN from within their dashboard or recover it via a "Forgot PIN" email link, and the admin can set a new PIN for the customer at any time from the Customer 360 view.

**Note (business reason for the authentication model):** Authentication uses a mobile number + admin-provisioned 6-digit PIN rather than SMS OTP. The client wants to avoid the recurring per-SMS OTP costs and the one-time SMS-gateway activation charges that an OTP model would incur, so the PIN model replaces SMS OTP entirely.

The system currently supports a single customer type (meal subscription). This feature must also lay an **extensible foundation for three customer categories** — Meal subscription, Kit subscription, and Accommodation — where a customer starts onboarding in exactly one category and can add the other two later as paid add-ons. The immediate implementation focus is the **Meal subscription** flow; Kit and Accommodation must be architecturally accommodated without being fully implemented now.

This document is grounded in the existing Supabase schema, notably: `users` (unique `mobile`, unique NOT NULL `email`, `auth_user_id`), `customer_profiles` (`gender`, `dietary_preference`, `allergies`, `franchise_id`, `clinic_id`, unique `customer_code`), `subscriptions` (status `PENDING`/`ACTIVE`/`CANCELLED`/`EXPIRED`/`STOPPED`, `starts_on`, `plan_id`), `subscription_plans`, `payments` (status `PENDING`/`PAID`, `invoice_type`, `paid_at`), and `addresses` (`tag`, `street_1/2`, `city`, `state`, `pincode`, `lat`, `lng`, `is_primary`). Existing behaviors that this feature depends on include the 5 PM (17:00 IST) cutoff rule and franchise/clinic scoping.

## Glossary

- **Customer_Portal**: The customer-facing web application served at `customer.arogyadiet.com` (the `src/app/customer` portal).
- **Admin_Dashboard**: The admin-facing operations application (the `src/app/admin` portal), including the Customers navigation section.
- **Auth_Service**: The authentication component responsible for issuing and validating sessions. Built on Supabase Auth.
- **PIN_Service**: The component that validates a submitted mobile-number + PIN pair against the stored hashed PIN and manages the PIN lifecycle (setting, changing, temporary flagging, and reset).
- **PIN**: A 6-digit numeric secret used together with a mobile number to authenticate a customer, stored only as a secure hash and never in plaintext.
- **Temporary_PIN**: An admin-set, one-time PIN that authenticates the customer once and forces the customer to set a new PIN on first successful login.
- **PIN_Reset_Token**: A single-use, time-limited token emailed to a customer for the "Forgot PIN" flow that authorizes setting a new PIN.
- **Login_Throttle**: The failed-attempt lockout mechanism that temporarily blocks login for a mobile number after too many failed PIN attempts, to deter brute-force guessing.
- **Eligibility_Checker**: The server-side component that determines whether a given mobile number is associated with an existing or in-progress customer before the PIN entry screen is revealed.
- **Quick_Onboarding_Form**: The new minimal admin form used to rapidly create a customer with priority information plus a subscription plan and payment status.
- **Address_Capture**: The map-based address entry component that lets a user pick a location on a Google Map and auto-fills locality fields.
- **Onboarding_Service**: The server-side component that creates the customer account, attaches the subscription, records payment, and transitions onboarding state.
- **Billing_Service**: The component that generates and displays invoices in the customer Billing view, backed by the `payments` table.
- **Subscription_Service**: The component that creates and manages `subscriptions` and their delivery calendar.
- **Customer_Record**: A row in `customer_profiles` linked to a `users` row, identified operationally by the customer's mobile number.
- **Onboarding_Status**: The lifecycle state of a Customer_Record: `IN_PROGRESS` (admin created, customer profile not yet completed) or `COMPLETED` (customer has finished or explicitly skipped remaining profile details).
- **Customer_Category**: One of `MEAL`, `KIT`, or `ACCOMMODATION`, describing a category of service a customer is subscribed to.
- **Primary_Category**: The single Customer_Category selected at the start of onboarding.
- **Add_On_Category**: A Customer_Category added to an existing customer after initial onboarding.
- **Cutoff_Time**: 17:00 IST (5:00 PM), the daily operational deadline after which the earliest modifiable delivery date shifts from tomorrow to the day after tomorrow.
- **Test_Email**: A placeholder email entered by the admin during onboarding when the customer has no email, flagged so it is hidden from the customer and replaceable later.
- **Payment_Status**: The state of a payment record; relevant values are `PENDING` and `PAID`.
- **Design_System**: The established set of UI building blocks and visual conventions shared across the ArogyaDiet portals, comprising Shadcn UI components, Radix UI primitives, Tailwind CSS 4 design tokens, the shared components in `src/shared/components`, and the existing typography, spacing, color palette, and branding used by the Admin_Dashboard and Customer_Portal.
- **Shared_Components**: The portal-agnostic, reusable UI components located in `src/shared/components` that implement the Design_System.

## Requirements

### Requirement 1: Removal of Signup and Google Login

**User Story:** As the business owner, I want the customer portal to expose only admin-provisioned mobile login, so that only clinic-registered customers can access the application and no self-service accounts are created.

#### Acceptance Criteria

1. WHEN the customer login screen is rendered, THE Customer_Portal SHALL display no self-service signup entry point (link, button, or navigation element) that initiates account creation.
2. WHEN the customer login screen is rendered, THE Customer_Portal SHALL display no "Login with Google" option or any third-party OAuth login control.
3. WHEN the customer login screen is rendered, THE Customer_Portal SHALL display only the admin-provisioned mobile-number login control and no email-and-password login fields.
4. WHEN an HTTP request is made to any customer signup route, THE Customer_Portal SHALL respond with a redirect to the mobile login screen without creating any account record.
5. IF an unauthenticated request is made directly to a customer OAuth or signup callback endpoint (bypassing the UI), THEN THE Customer_Portal SHALL reject the request without creating or authenticating an account and SHALL redirect the caller to the mobile login screen.

### Requirement 2: Mobile + PIN Login

**User Story:** As a customer, I want to log in with just my mobile number and a 6-digit PIN, so that I can access the app without an email, a password, or an SMS code.

#### Acceptance Criteria

1. THE Customer_Portal SHALL present a single mobile number field as the only initial credential input on the login screen, with no PIN entry field visible until the mobile number has been submitted.
2. WHEN a customer submits a mobile number via the "Next" action, THE Customer_Portal SHALL run the eligibility check defined in Requirement 3 before revealing any PIN entry screen.
3. WHEN the eligibility check in Requirement 3 succeeds for a submitted mobile number, THE Customer_Portal SHALL reveal a PIN entry screen that accepts a PIN of exactly 6 numeric digits.
4. IF a customer submits a PIN that is not exactly 6 numeric digits, THEN THE Customer_Portal SHALL reject the submission, display a message indicating the PIN must be 6 numeric digits, and not establish a session.
5. WHEN a customer submits a PIN of exactly 6 numeric digits, THE PIN_Service SHALL validate the submitted PIN against the stored hashed PIN for that mobile number.
6. WHEN the submitted PIN matches the stored hashed PIN for that mobile number, THE Auth_Service SHALL establish an authenticated customer session and redirect the customer to the customer dashboard.
7. THE PIN_Service SHALL store every PIN only as a secure hash and SHALL never store or log a PIN in plaintext.
8. IF a customer submits a PIN that does not match the stored hashed PIN for that mobile number, THEN THE PIN_Service SHALL reject the submission, display an invalid-PIN message, increment the failed-attempt counter for that mobile number, and not establish a session.
9. IF the failed-attempt counter for a mobile number reaches 5 within a 15-minute (900-second) window, THEN THE Login_Throttle SHALL lock login for that mobile number for 15 minutes (900 seconds) and display a lockout message indicating when the customer may retry, without establishing a session.
10. THE Customer_Portal SHALL display a "Forgot PIN?" affordance on the PIN entry screen that initiates the flow defined in Requirement 17.
11. THE Customer_Portal SHALL accept mobile numbers in the format used by existing `users.mobile` records and normalize the submitted mobile number to that format before the eligibility check.

### Requirement 3: Pre-PIN Mobile Eligibility Check

**User Story:** As the business owner, I want the system to verify a mobile number belongs to a real or in-progress customer before revealing the PIN entry screen, so that non-customers cannot attempt to log in or access the app.

#### Acceptance Criteria

1. WHEN a customer submits a mobile number via the "Next" action on the login screen, THE Eligibility_Checker SHALL determine, within 3 seconds, whether the submitted mobile number is associated with a Customer_Record whose Onboarding_Status is IN_PROGRESS or COMPLETED.
2. IF the submitted value is not a syntactically valid mobile number (10 numeric digits, excluding any leading country code), THEN THE Eligibility_Checker SHALL reject the request, display a message indicating the mobile number format is invalid, and not reveal the PIN entry screen.
3. IF the submitted mobile number is associated with exactly one Customer_Record whose Onboarding_Status is IN_PROGRESS or COMPLETED, THEN THE Customer_Portal SHALL reveal the PIN entry screen defined in Requirement 2 for that mobile number.
4. IF the submitted mobile number is not associated with any Customer_Record whose Onboarding_Status is IN_PROGRESS or COMPLETED, THEN THE Eligibility_Checker SHALL reject the request and display the message "please contact admin" without revealing the PIN entry screen.
5. THE Eligibility_Checker SHALL perform the association check against Customer_Records only, excluding every user whose role is not CUSTOMER.
6. IF the submitted mobile number is associated with more than one Customer_Record whose Onboarding_Status is IN_PROGRESS or COMPLETED, THEN THE Eligibility_Checker SHALL reject the request, display a message indicating the account requires resolution before login can proceed, and not reveal the PIN entry screen.

### Requirement 4: Admin Quick-Onboarding Form

**User Story:** As an admin with limited time, I want to create a customer account with only priority information plus a subscription and payment status, so that the customer can enter the delivery process from the next day.

#### Acceptance Criteria

1. THE Admin_Dashboard SHALL provide a Quick_Onboarding_Form that captures, as required inputs, the customer's name (1 to 100 characters), a 10-digit mobile number, gender (Male, Female, or Other), and diet preference.
2. THE Quick_Onboarding_Form SHALL accept Veg or Non-Veg as the only diet preference values, consistent with existing `customer_profiles.dietary_preference` values.
3. THE Quick_Onboarding_Form SHALL accept an optional allergies input of up to 500 characters.
4. THE Quick_Onboarding_Form SHALL capture, as required inputs, a subscription start date that is on or after the next calendar day, a selected subscription plan from the active `subscription_plans`, and a payment status limited to Paid or Pending.
5. THE Quick_Onboarding_Form SHALL capture one address via the Address_Capture component and record that address as the customer's primary address.
6. IF the admin submits the Quick_Onboarding_Form with any required input (name, mobile number, gender, diet preference, subscription start date, subscription plan, or payment status) missing or failing its stated format, THEN THE Onboarding_Service SHALL reject the submission, display an error message identifying each invalid or missing field, and retain the previously entered values.
7. IF the admin submits the Quick_Onboarding_Form with a mobile number already associated with an existing Customer_Record, THEN THE Onboarding_Service SHALL reject the submission, display a duplicate-mobile message, and retain the previously entered values.
8. THE Quick_Onboarding_Form SHALL retain the legacy three-step customer creation flow as a separate, still-available option and SHALL NOT remove it.
9. THE Quick_Onboarding_Form SHALL capture or auto-generate a 6-digit numeric Temporary_PIN for the customer, replacing any prior temporary-password concept.
10. WHEN a customer is created via the Quick_Onboarding_Form, THE Onboarding_Service SHALL store the Temporary_PIN only as a secure hash with the temporary flag set, and SHALL never store or log the Temporary_PIN in plaintext.
11. IF the admin supplies a Temporary_PIN that is not exactly 6 numeric digits, THEN THE Onboarding_Service SHALL reject the submission, display a message indicating the Temporary_PIN must be 6 numeric digits, and retain the previously entered values.

### Requirement 5: Map-Based Address Capture

**User Story:** As an admin, I want to capture an address by selecting a location on a map, so that locality fields are filled accurately and quickly with minimal typing.

#### Acceptance Criteria

1. WHEN the Address_Capture is displayed, THE Address_Capture SHALL present an address-tag selector at the top of the component offering exactly the values "Home" and "Office", consistent with existing `addresses.tag` values, with "Home" selected by default.
2. WHEN the Address_Capture is displayed, THE Address_Capture SHALL present a Google Map and a location search box that accepts apartment name or locality text of 1 to 255 characters.
3. WHEN a location is selected on the map or from the search box, THE Address_Capture SHALL auto-fill the area, city, state, and pincode fields from the selected location and record the location's latitude and longitude into `addresses.lat` and `addresses.lng`.
4. THE Address_Capture SHALL accept flat number (1 to 50 characters) and floor number (0 to 20 characters) as the only manually entered address fields.
5. WHEN an address captured via the Address_Capture is saved during quick onboarding, THE Onboarding_Service SHALL store the address with `is_primary` set to true.
6. IF a location is selected whose pincode is outside the serviceable pincodes for the admin's franchise, THEN THE Address_Capture SHALL display a not-serviceable warning identifying that pincode and SHALL keep the warning visible until a serviceable pincode is selected.
7. IF the area, city, state, or pincode cannot be determined from the selected location, THEN THE Address_Capture SHALL leave the unresolved fields empty and display an error indicating the address could not be resolved, while retaining any already-entered field values.
8. IF flat number is empty when an admin attempts to save the captured address, THEN THE Address_Capture SHALL reject the save and display an error indicating flat number is required, while retaining the entered field values.

### Requirement 6: Onboard Customer Action and Dashboard Sections

**User Story:** As an admin, I want to click "Onboard Customer" to finalize the initial account, so that the customer becomes eligible for routing and meal delivery from the selected start date.

#### Acceptance Criteria

1. WHEN the admin activates the "Onboard Customer" action with a Quick_Onboarding_Form in which all required fields (customer name, contact phone number, primary address, selected subscription, and subscription start date) are present and non-empty and Payment_Status is PAID, THE Onboarding_Service SHALL create the Customer_Record with Onboarding_Status IN_PROGRESS.
2. WHEN the Customer_Record is created with Onboarding_Status IN_PROGRESS, THE Onboarding_Service SHALL attach the selected subscription with the given subscription start date to that Customer_Record.
3. WHEN the selected subscription is attached to the Customer_Record, THE Onboarding_Service SHALL record the primary address on that Customer_Record.
4. WHEN the admin activates the "Onboard Customer" action, THE Onboarding_Service SHALL complete the onboarding operation and return a result within 5 seconds.
5. IF the admin activates the "Onboard Customer" action while any required Quick_Onboarding_Form field (customer name, contact phone number, primary address, selected subscription, or subscription start date) is missing or empty, or while Payment_Status is not PAID, THEN THE Onboarding_Service SHALL reject the action, SHALL NOT create any Customer_Record, and SHALL return an error indication identifying the missing field or unmet payment condition.
6. IF any step of creating the Customer_Record, attaching the subscription, or recording the primary address fails during onboarding, THEN THE Onboarding_Service SHALL roll back the operation so that no partial Customer_Record persists, and SHALL return an error indication that onboarding did not complete.
7. WHEN a customer is onboarded, THE Onboarding_Service SHALL make the customer's subscription eligible for delivery routing on and after the selected subscription start date.
8. WHILE the current date is before the selected subscription start date, THE Onboarding_Service SHALL exclude the customer's subscription from delivery routing.
9. THE Admin_Dashboard SHALL list customers whose Onboarding_Status is IN_PROGRESS in an "onboarded customer" section under the Customers navigation.
10. THE Admin_Dashboard SHALL list customers whose Onboarding_Status is COMPLETED in an "onboarding completed customer" section under the Customers navigation.
11. WHEN a Customer_Record transitions from IN_PROGRESS to COMPLETED, THE Admin_Dashboard SHALL move that customer from the "onboarded customer" section to the "onboarding completed customer" section.

### Requirement 7: 5 PM Cutoff Warning and Acknowledgment

**User Story:** As an admin, I want a clear warning when I onboard a customer after the daily cutoff, so that I do not select a start date the automation cannot fulfill.

#### Acceptance Criteria

1. WHILE the current time, evaluated in the time zone in which Cutoff_Time is defined, is at or after the Cutoff_Time, THE Quick_Onboarding_Form SHALL display a warning message instructing the admin to contact the operations admin to confirm whether the automation can be re-run and to select only the next-day date (current date plus 1 day) or the day-after date (current date plus 2 days) as the subscription start date.
2. WHILE the warning in Acceptance Criterion 7.1 is displayed and the confirmation checkbox is not selected, THE Quick_Onboarding_Form SHALL keep the "Onboard Customer" action disabled.
3. WHEN the admin selects the confirmation checkbox while the warning in Acceptance Criterion 7.1 is displayed, THE Quick_Onboarding_Form SHALL enable the "Onboard Customer" action.
4. IF the admin deselects the confirmation checkbox while the warning in Acceptance Criterion 7.1 is displayed, THEN THE Quick_Onboarding_Form SHALL disable the "Onboard Customer" action.
5. WHILE the current time, evaluated in the time zone in which Cutoff_Time is defined, is before the Cutoff_Time, THE Quick_Onboarding_Form SHALL set the earliest selectable subscription start date to the next-day date (current date plus 1 day) and SHALL prevent selection of any earlier date.
6. WHILE the current time, evaluated in the time zone in which Cutoff_Time is defined, is at or after the Cutoff_Time, THE Quick_Onboarding_Form SHALL set the earliest selectable subscription start date to the day-after date (current date plus 2 days) and SHALL prevent selection of any earlier date.
7. IF the admin submits the form with a subscription start date earlier than the earliest selectable start date defined in Acceptance Criteria 7.5 and 7.6, THEN THE Quick_Onboarding_Form SHALL reject the submission, retain the admin's entered values, and display an error message indicating that the selected start date is not permitted.

### Requirement 8: Payment-Done Prerequisite

**User Story:** As the business owner, I want onboarding to be possible only after payment is marked done, so that no customer enters delivery routing without collected payment.

#### Acceptance Criteria

1. IF the admin activates the "Onboard Customer" action while Payment_Status is any value other than PAID, THEN THE Onboarding_Service SHALL reject the action, retain all entered onboarding data without persisting a routable customer record, and display a message indicating that payment must be marked done before onboarding can proceed.
2. WHEN the admin activates the "Onboard Customer" action while Payment_Status is PAID, THE Onboarding_Service SHALL proceed with onboarding and make the customer eligible for delivery routing.
3. WHEN the admin marks payment done during onboarding, THE Billing_Service SHALL record a `payments` row for the subscription with status PAID, set the recorded amount equal to the subscription amount due, and set `paid_at` to the timestamp at which the admin marked payment done.
4. IF payment is marked done during onboarding while a `payments` row with status PAID already exists for the same subscription, THEN THE Billing_Service SHALL reject the duplicate action, retain the existing PAID `payments` row unchanged, and display a message indicating that payment is already recorded.
5. THE Quick_Onboarding_Form SHALL provide a manual control that allows the admin to mark payment as collected at the counter.
6. WHEN a subscription is created during onboarding with payment marked PAID, THE Billing_Service SHALL generate exactly one invoice for that subscription.

### Requirement 9: Customer Profile Completion Flow

**User Story:** As a customer, I want to finish the remaining profile details after logging in, so that my onboarding is complete, while being able to skip fields I do not want to provide.

#### Acceptance Criteria

1. WHEN a customer with Onboarding_Status IN_PROGRESS lands on the customer dashboard after login, THE Customer_Portal SHALL present, within 3 seconds of the dashboard finishing load, a popup dialog containing an input field for each Customer_Record field that is currently empty.
2. THE profile completion dialog SHALL accept submission when zero fields are populated and when any number of fields up to all displayed fields are populated, treating every displayed field as optional.
3. WHEN the customer submits the profile completion dialog and every provided field value passes its format-validation rules, THE Customer_Portal SHALL persist the provided values to the corresponding Customer_Record fields within 3 seconds of submission.
4. WHEN the customer selects "mark completed onboarding", THE Onboarding_Service SHALL set the Customer_Record Onboarding_Status to COMPLETED regardless of how many fields were provided.
5. WHEN a customer's Onboarding_Status becomes COMPLETED, THE Customer_Portal SHALL NOT present the profile completion dialog on subsequent logins.
6. WHEN a customer opens the app to complete onboarding and the entered mobile number matches the mobile number the admin used to initiate onboarding, THE Eligibility_Checker SHALL permit the PIN entry screen to be revealed for PIN login.
7. IF the customer submits the profile completion dialog and one or more provided field values fail their format-validation rules, THEN THE Customer_Portal SHALL reject the submission, retain the entered values in the dialog, and display an indication identifying each field that is invalid.
8. IF persistence of the submitted profile values fails, THEN THE Customer_Portal SHALL retain the entered values in the dialog, apply no partial changes to the Customer_Record, and display an error indication that saving did not complete.
9. IF the entered mobile number does not match the mobile number the admin used to initiate onboarding, THEN THE Eligibility_Checker SHALL not reveal the PIN entry screen and display an error indication that the mobile number does not match.

### Requirement 10: Mobile-First Email Architecture

**User Story:** As the business owner, I want the customer identity to be mobile-first, so that customers without an email can still be onboarded and can add a real email later.

#### Acceptance Criteria

1. THE Onboarding_Service SHALL allow creation of a Customer_Record without a customer-provided email address.
2. WHERE the account creation process requires a non-null email, THE Quick_Onboarding_Form SHALL allow the admin to enter a placeholder Test_Email of 1 to 254 characters and mark it as a test email via a checkbox adjacent to the email field.
3. WHEN an email is marked as a Test_Email, THE Onboarding_Service SHALL flag that email so it is identifiable as a placeholder.
4. WHILE a customer's email is flagged as a Test_Email, THE Customer_Portal SHALL exclude the admin-entered Test_Email from any customer-facing display.
5. WHERE a customer's email is flagged as a Test_Email, THE profile completion dialog SHALL offer the customer an input to enter a real email address of 1 to 254 characters.
6. WHEN a customer submits a real email address that conforms to a valid email address format and is not already associated with another user, THE Onboarding_Service SHALL replace the Test_Email with the customer-provided email and clear the Test_Email flag.
7. IF a customer submits a real email address that is already associated with another user, THEN THE Onboarding_Service SHALL reject the submission, retain the existing Test_Email and its flag unchanged, and return an error indication that the email address is already in use.
8. IF a customer submits a real email address that does not conform to a valid email address format or exceeds 254 characters, THEN THE Onboarding_Service SHALL reject the submission, retain the existing Test_Email and its flag unchanged, and return an error indication that the email address is invalid.

### Requirement 11: Post-Completion Customer State

**User Story:** As a customer, I want to see my subscription and invoice already in place after onboarding, so that I can immediately use the app's meal features.

#### Acceptance Criteria

1. WHEN an onboarded customer opens the account view, THE Customer_Portal SHALL display the subscription attached during onboarding, including its plan name, start date, and status, within 3 seconds of the view loading.
2. IF an onboarded customer opens the account view and no subscription is attached to the account, THEN THE Customer_Portal SHALL display an error message indicating that no subscription was found and SHALL retain the customer on the account view without altering account data.
3. WHEN an onboarded customer opens the Billing view, THE Billing_Service SHALL display the invoice generated during onboarding, including its invoice amount, issue date, and payment status, within 3 seconds of the view loading.
4. IF an onboarded customer opens the Billing view and no invoice was generated during onboarding, THEN THE Billing_Service SHALL display an error message indicating that no invoice was found and SHALL retain the customer on the Billing view without altering billing data.
5. WHEN an onboarded customer is authenticated, THE Customer_Portal SHALL grant access to the meal planner, address selection, profile, dashboard, shop products, and my meals views, with the same navigation entry points and permissions available to a customer created through the pre-existing onboarding path.

### Requirement 12: Access Restriction to Registered Mobiles

**User Story:** As the business owner, I want only customers whose mobile is linked to a customer account to use the customer application, so that access is limited to clinic-registered customers.

#### Acceptance Criteria

1. IF a login attempt uses a mobile number that is not associated with any Customer_Record, THEN THE Auth_Service SHALL deny access to the Customer_Portal, SHALL NOT create an authenticated session, and SHALL return an error indication that the mobile number is not registered.
2. WHEN a session is authenticated via mobile + PIN login against a mobile number associated with exactly one Customer_Record whose Onboarding_Status is IN_PROGRESS or COMPLETED, THE Customer_Portal SHALL grant access to that session.
3. IF a login attempt uses a mobile number associated with a Customer_Record whose Onboarding_Status is neither IN_PROGRESS nor COMPLETED, THEN THE Auth_Service SHALL deny access to the Customer_Portal, SHALL NOT create an authenticated session, and SHALL return an error indication that access is not permitted for the account's current onboarding status.
4. IF a login attempt uses a mobile number associated with more than one Customer_Record, THEN THE Auth_Service SHALL deny access to the Customer_Portal, SHALL NOT create an authenticated session, and SHALL return an error indication that the account requires resolution before access can be granted.

### Requirement 13: Multi-Category Customer Foundation

**User Story:** As the business owner, I want the system architected for three customer categories with meal implemented first, so that kit and accommodation can be added later without rework.

#### Acceptance Criteria

1. THE Onboarding_Service SHALL model each customer's active services using the Customer_Category values MEAL, KIT, and ACCOMMODATION, and SHALL reject any Customer_Category value outside this set.
2. WHEN the admin starts onboarding a customer, THE Quick_Onboarding_Form SHALL require the selection of exactly one Primary_Category from the values MEAL, KIT, and ACCOMMODATION.
3. IF the admin submits the Quick_Onboarding_Form with zero Primary_Category selected, THEN THE Onboarding_Service SHALL reject the submission, SHALL display an error message indicating that exactly one Primary_Category must be selected, and SHALL preserve all previously entered form values without creating a customer record.
4. IF the admin submits the Quick_Onboarding_Form with more than one Primary_Category selected, THEN THE Onboarding_Service SHALL reject the submission, SHALL display an error message indicating that only one Primary_Category is allowed, and SHALL preserve all previously entered form values without creating a customer record.
5. THE Onboarding_Service SHALL implement the MEAL Primary_Category onboarding flow end to end.
6. WHERE the selected Primary_Category is KIT or ACCOMMODATION, THE Onboarding_Service SHALL represent the category in the data model without requiring the full delivery flow to be implemented.
7. WHEN a customer who has been onboarded with a Primary_Category requests activation of an Add_On_Category subscription for a remaining Customer_Category value, THE Onboarding_Service SHALL require successful payment for that Add_On_Category before starting it.
8. WHEN payment for an Add_On_Category subscription completes successfully, THE Onboarding_Service SHALL start the Add_On_Category subscription as a separately paid subscription associated with the customer.
9. IF payment for an Add_On_Category subscription fails, THEN THE Onboarding_Service SHALL not start the Add_On_Category subscription, SHALL display an error message indicating that payment failed, and SHALL leave the customer's existing subscriptions unchanged.
10. IF an activation request targets a Customer_Category for which the customer already has an active subscription, THEN THE Subscription_Service SHALL reject the request, SHALL display an error message indicating that the customer already subscribes to that Customer_Category, and SHALL not initiate payment or create a duplicate subscription.
11. THE Subscription_Service SHALL associate each subscription with exactly one Customer_Category so that meal, kit, and accommodation subscriptions coexist for a single customer, with at most one active subscription per Customer_Category value per customer.

### Requirement 14: Onboarding State Data Model

**User Story:** As a developer, I want onboarding state and category persisted on customer records, so that admin sections, login eligibility, and completion flows can be driven by stored state.

#### Acceptance Criteria

1. THE Onboarding_Service SHALL persist an Onboarding_Status on each Customer_Record constrained to exactly one of the enumerated values IN_PROGRESS or COMPLETED, and SHALL reject any attempt to persist a value outside this enumeration with an error indicating an invalid status.
2. WHEN a Customer_Record is created via quick onboarding, THE Onboarding_Service SHALL set its Onboarding_Status to IN_PROGRESS.
3. WHEN a Customer_Record's onboarding is completed, THE Onboarding_Service SHALL transition its Onboarding_Status from IN_PROGRESS to COMPLETED.
4. THE Onboarding_Service SHALL persist the Test_Email flag on the user identity as a boolean value, and SHALL retain that value unchanged across all sessions until it is explicitly updated.
5. WHEN a Customer_Record is created via quick onboarding, THE Onboarding_Service SHALL record the resolved `franchise_id` and `clinic_id` on that Customer_Record.
6. IF the `franchise_id` or `clinic_id` cannot be resolved during quick onboarding, THEN THE Onboarding_Service SHALL reject creation of the Customer_Record, return an error indicating the scope could not be resolved, and persist no partial Customer_Record.
7. WHEN a Customer_Record is created via quick onboarding, THE Onboarding_Service SHALL generate a `customer_code` that is unique across all Customer_Records.
8. IF a generated `customer_code` collides with an existing `customer_code`, THEN THE Onboarding_Service SHALL regenerate the `customer_code` until it is unique across all Customer_Records and SHALL persist no duplicate `customer_code`.
9. THE PIN_Service SHALL persist, on the customer identity, the hashed PIN, a `pin_is_temporary` boolean flag, and a `pin_set_at` timestamp, and SHALL never persist a PIN in plaintext.
10. WHEN a PIN is set or changed for a customer, THE PIN_Service SHALL update the stored hashed PIN, set `pin_is_temporary` to true when the PIN is a Temporary_PIN and false otherwise, and set `pin_set_at` to the timestamp at which the PIN was set.
11. THE PIN_Service SHALL persist each PIN_Reset_Token as a hashed token value with an expiry timestamp and a single-use consumed flag, and SHALL reject any reset attempt whose token is expired, already consumed, or not found.

### Requirement 15: Temporary PIN and Forced Reset

**User Story:** As the business owner, I want a customer's admin-set PIN to be temporary and force a reset on first login, so that the admin never knows the customer's permanent PIN and customers control their own secret.

#### Acceptance Criteria

1. WHEN the admin sets or generates a Temporary_PIN during quick onboarding, THE PIN_Service SHALL store the Temporary_PIN as a secure hash of exactly 6 numeric digits with the `pin_is_temporary` flag set to true.
2. WHEN a customer logs in successfully with a Temporary_PIN, THE Customer_Portal SHALL redirect the customer to a PIN-reset screen and SHALL NOT grant access to any other part of the app until a new PIN is set.
3. THE PIN-reset screen SHALL capture a new PIN and a confirm-new-PIN value, each required to be exactly 6 numeric digits.
4. IF the new PIN and the confirm-new-PIN do not match, THEN THE Customer_Portal SHALL reject the reset, display a message indicating the two values must match, and not change the stored PIN.
5. IF the new PIN or the confirm-new-PIN is not exactly 6 numeric digits, THEN THE Customer_Portal SHALL reject the reset, display a message indicating the PIN must be 6 numeric digits, and not change the stored PIN.
6. WHEN the customer submits a valid, matching new PIN on the PIN-reset screen, THE PIN_Service SHALL store the new hashed PIN, clear the `pin_is_temporary` flag (set it to false), update `pin_set_at`, and THE Customer_Portal SHALL proceed the customer to the dashboard and any remaining onboarding.

### Requirement 16: In-Dashboard PIN Change

**User Story:** As a customer, I want to change my PIN from within my dashboard, so that I can keep my login secret up to date without contacting the admin.

#### Acceptance Criteria

1. THE Customer_Portal Profile section SHALL provide a PIN-change control that captures a current PIN, a new PIN, and a confirm-new-PIN value.
2. WHEN the customer submits the PIN-change control, THE PIN_Service SHALL validate the submitted current PIN against the stored hashed PIN for that customer.
3. IF the submitted current PIN does not match the stored hashed PIN, THEN THE PIN_Service SHALL reject the change, display a message indicating the current PIN is incorrect, and not change the stored PIN.
4. IF the new PIN and the confirm-new-PIN do not match, or either is not exactly 6 numeric digits, THEN THE Customer_Portal SHALL reject the change, display a message indicating the new PIN must be 6 numeric digits and both values must match, and not change the stored PIN.
5. WHEN the submitted current PIN is valid and the new PIN is exactly 6 numeric digits and matches the confirm-new-PIN, THE PIN_Service SHALL store the new hashed PIN, set `pin_is_temporary` to false, and update `pin_set_at`.

### Requirement 17: Forgot PIN via Email

**User Story:** As a customer who forgot my PIN, I want to reset it through a link sent to my registered email, so that I can regain access without waiting for the admin.

#### Acceptance Criteria

1. WHEN the customer activates the "Forgot PIN" action on the PIN entry screen, THE Customer_Portal SHALL present a Forgot-PIN page that captures the customer's registered email address.
2. IF the submitted email matches the registered real email for that mobile number's Customer_Record, THEN THE PIN_Service SHALL generate a single-use PIN_Reset_Token that expires 30 minutes (1800 seconds) after it is generated, and SHALL email a reset link containing that token via the existing email provider.
3. WHEN the customer opens a reset link whose PIN_Reset_Token is valid, unexpired, and not yet consumed, THE Customer_Portal SHALL present a set-new-PIN screen capturing a new PIN and a confirm-new-PIN value, each required to be exactly 6 numeric digits.
4. WHEN the customer submits a valid, matching new PIN on the set-new-PIN screen, THE PIN_Service SHALL store the new hashed PIN, set `pin_is_temporary` to false, update `pin_set_at`, and mark the PIN_Reset_Token as consumed so it cannot be reused.
5. IF the customer opens a reset link whose PIN_Reset_Token is expired, already consumed, or not found, THEN THE Customer_Portal SHALL reject the request, display a message indicating the reset link is no longer valid, and not present the set-new-PIN screen.
6. IF the submitted email does not match the registered real email for that mobile number's Customer_Record, THEN THE PIN_Service SHALL not generate a PIN_Reset_Token and THE Customer_Portal SHALL display a message indicating the reset link, if the email is registered, has been sent, without revealing whether the email matched.
7. WHERE the Customer_Record has only a placeholder Test_Email and no real email, THE Customer_Portal SHALL make forgot-PIN-by-email unavailable and SHALL display a message instructing the customer to contact the admin to have a new PIN set per Requirement 18.

### Requirement 18: Admin Set/Reset Customer PIN

**User Story:** As an admin, I want to set or reset a customer's PIN at any time from the Customer 360 view, so that I can help customers who cannot use email-based recovery.

#### Acceptance Criteria

1. THE Admin_Dashboard Customer 360 view SHALL provide a control to set a new PIN or regenerate a Temporary_PIN for a customer at any time.
2. IF the admin supplies a PIN via this control that is not exactly 6 numeric digits, THEN THE Admin_Dashboard SHALL reject the action, display a message indicating the PIN must be 6 numeric digits, and not change the stored PIN.
3. WHEN the admin sets a new PIN via this control, THE PIN_Service SHALL store the new PIN as a secure hash and update `pin_set_at`, and SHALL never store or log the PIN in plaintext.
4. WHEN the admin sets the PIN via this control as a Temporary_PIN, THE PIN_Service SHALL set the `pin_is_temporary` flag to true so that the customer is forced to reset the PIN on the next login per Requirement 15.

### Requirement 19: UI/UX Consistency and Quality

**User Story:** As the business owner, I want every new onboarding screen to reuse the existing Design_System and match the portal it lives in, so that the mobile onboarding experience is visually and behaviorally consistent, high quality, and indistinguishable in polish from the current admin and customer dashboards.

#### Acceptance Criteria

1. THE Customer_Portal SHALL implement every new customer-facing onboarding screen — the mobile + PIN login screen, the PIN entry screen, the PIN-reset screen, the Forgot-PIN and set-new-PIN screens, and the profile completion dialog — using the Design_System, including the Shadcn UI components, Radix UI primitives, Tailwind CSS 4 design tokens, the Shared_Components in `src/shared/components`, and the established typography, spacing, color palette, and branding already used by the Customer_Portal.
2. THE Admin_Dashboard SHALL implement every new admin-facing onboarding screen — the Quick_Onboarding_Form, the map-based Address_Capture, the "onboarded customer" section, and the "onboarding completed customer" section — using the Design_System, including the Shadcn UI components, Radix UI primitives, Tailwind CSS 4 design tokens, the Shared_Components in `src/shared/components`, and the established typography, spacing, color palette, and branding already used by the Admin_Dashboard.
3. THE Admin_Dashboard SHALL render every new admin-facing onboarding screen using the same button styles, form control styles, modal and dialog styles, and navigation patterns already used by the existing screens at `admin.arogyadiet.com`.
4. THE Customer_Portal SHALL render every new customer-facing onboarding screen using the same button styles, form control styles, modal and dialog styles, and navigation patterns already used by the existing screens at `customer.arogyadiet.com`.
5. THE Customer_Portal SHALL render every new customer-facing onboarding screen using the mobile-first responsive behavior already applied to the existing Customer_Portal screens, presenting a usable single-column layout at a viewport width of 360 CSS pixels without horizontal scrolling.
6. THE Admin_Dashboard SHALL render every new admin-facing onboarding screen using the desktop-first responsive behavior already applied to the existing Admin_Dashboard screens.
7. WHILE an onboarding action that awaits a server response is in progress, THE new onboarding screen on which the action was initiated SHALL display a loading state consistent with the existing loading patterns of its portal.
8. WHILE a required precondition for an onboarding action is unmet, THE new onboarding screen SHALL render the control that triggers that action in a disabled state consistent with the existing disabled-control styling of its portal, including the "Onboard Customer" button before the Cutoff_Time confirmation checkbox is selected.
9. WHEN a submitted field value fails its validation rule on a new onboarding screen, THE new onboarding screen SHALL display an inline validation error adjacent to that field consistent with the existing inline-error styling of its portal.
10. WHEN a new onboarding section — the "onboarded customer" section or the "onboarding completed customer" section — contains zero records, THE Admin_Dashboard SHALL display an empty state consistent with the existing empty-state styling of the Admin_Dashboard.
11. WHEN an onboarding action completes successfully, THE new onboarding screen SHALL display success feedback using the toast or notification pattern already used by its portal.
12. THE Customer_Portal and the Admin_Dashboard SHALL implement every new onboarding screen so that all interactive controls are reachable and operable by keyboard, dialogs manage and trap focus while open and restore focus to the triggering control when closed, every form control has an associated accessible label, and text and interactive elements meet the WCAG 2.1 AA color-contrast ratio, consistent with the Radix and Shadcn accessibility baseline.
13. THE Admin_Dashboard SHALL render the map-based Address_Capture with a visual layout aligned to the existing address-capture user interface used in the legacy customer-creation flow, while adding the address-tag selector on top, the location search box, and the auto-fill layout specified in Requirement 5.
