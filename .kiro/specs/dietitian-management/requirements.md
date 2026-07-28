# Requirements Document

## Introduction

This feature introduces the Dietitian role to ArogyaDiet. A Dietitian is a clinical staff member who reviews a customer's profile, addresses and self-submitted health logs, and who records structured Health_Logs against that customer on a fixed cadence.

The feature spans four portals:

- **Master Portal** (`master.arogyadiet.com`) — creates and edits Dietitian accounts, creates Franchise users including Franchise Dietitians, and exposes a per-Dietitian activity report.
- **Admin Portal** (`admin.arogyadiet.com`) — hosts the read-only, Dietitian-scoped Customers workspace and the Log Customer workflow.
- **Franchise Portal** (`franchies.arogyadiet.com`) — becomes multi-user with access-level-restricted views, hosts the Franchise Dietitian experience, and gives the Franchise Owner a franchise-scoped activity report.
- **Customer Portal** (`customer.arogyadiet.com`) — unchanged in behavior; its existing KIT Self_Logs become visible to the assigned Dietitian.

The feature also extends the onboarding and Customer_360 flows so that every Customer_Record carries a Dietitian_Link, and adds a Health_Log data model that supports a fixed field set per Customer_Category plus operator-defined Custom_Parameters.

### Baseline observed in the existing system

These facts were verified against the live schema and code and constrain the requirements below:

- `users.admin_access_level` is a nullable text column constrained to `inventory`, `operations`, `inventory_operations`; access levels are resolved by `src/lib/auth/adminAccessCore.ts` and enforced in `src/middleware.ts` plus `guardAdminGroup`.
- `roles` contains `ADMIN`, `MASTER_ADMIN`, `FRANCHISE_ADMIN`, `RIDER`, `CUSTOMER`. The Admin Portal admits `ADMIN` only; the Franchise Portal admits `FRANCHISE_ADMIN` only.
- `clinics` holds four rows: `Madhapur Clinic`, `Uppal`, `Uppal Clinic` (Core_Business, `franchise_id IS NULL`) and `Dr. Mohan Clinic` (`franchise_id` = `Be-Fit Vizag`).
- `subscriptions.customer_category` takes the values `MEAL`, `KIT`, `ACCOMMODATION`.
- Existing health data is fragmented: `admin_health_logs` (weight, BP, sugar, notes; keyed to `stay_entry_id`) and `customer_health_logs` (water, activity) serve Accommodation only; `kit_daily_logs` holds KIT Self_Logs with `status ∈ {FOOD_TAKEN, FOOD_SKIPPED}` and `UNIQUE (subscription_id, log_date)`.
- Pause state is held per day in `subscription_daily_preferences.is_paused` / `pause_credit_used`.
- Row Level Security is enabled on every public table; franchise scoping is enforced by `is_global_role()` and `current_franchise_id()`.
- None of the four named Dietitians currently exists in `users`.

## Glossary

- **Access_Control_Layer**: The combined enforcement of subdomain routing and role/access-level gating in `src/middleware.ts`, the server-side route guards, and PostgreSQL Row Level Security policies.
- **Admin_Portal**: The portal served on the `admin` subdomain.
- **Assignment_Service**: The component that creates, reads and updates a Dietitian_Link.
- **Cadence_Engine**: The component that computes Cadence_Interval, Eligible_Day, Days_Not_Logged and Pending_Log_Count.
- **Cadence_Interval**: The maximum number of Eligible_Days permitted between two consecutive Dietitian_Logs for a customer. The value is 1 for Customer_Category `ACCOMMODATION` and 3 for Customer_Category `MEAL` and `KIT`.
- **Closing_Comment**: A single free-text comment, mandatory on every Health_Log submission.
- **Core_Business**: The non-franchise tenant, identified by `franchise_id IS NULL`.
- **Custom_Parameter**: An operator-defined health metric captured as a triple of label, value and unit, stored on a Health_Log without a schema change.
- **Customer_Category**: The value of `subscriptions.customer_category` for the customer's governing subscription, one of `MEAL`, `KIT`, `ACCOMMODATION`.
- **Customer_360**: The per-customer profile workspace rendered by `Customer360Dashboard`.
- **Customer_Portal**: The portal served on the `customer` subdomain.
- **Customer_Record**: A row in `customer_profiles`.
- **Days_Not_Logged**: The count of Eligible_Days strictly after the Last_Dietitian_Log_Date up to and including the current IST calendar date.
- **Dietitian**: A user account whose role is `ADMIN` (Core_Business) or `FRANCHISE_ADMIN` (Franchise) and whose Access_Level is `dietitian`.
- **Dietitian_Account_Service**: The component that creates, edits, activates, deactivates and lists Dietitian accounts.
- **Dietitian_Activity_Report**: The aggregated per-Dietitian view of Pending_Log_Count, Max_Days_Not_Logged and Self_Log adherence.
- **Dietitian_Clinic_Link**: The association between a Dietitian and exactly zero or one Clinic.
- **Dietitian_Link**: The association between a Customer_Record and zero or one Dietitian.
- **Dietitian_Log**: A Health_Log whose author is a Dietitian.
- **Eligible_Day**: An IST calendar date that falls inside the customer's Logging_Window and that is not a Paused_Day.
- **Franchise_Owner**: The user referenced by `franchises.owner_user_id`.
- **Franchise_Portal**: The portal served on the `franchies` subdomain.
- **Health_Log**: A dated record of health measurements for one Customer_Record, authored by either a Dietitian or the customer.
- **Health_Log_Service**: The component that validates, persists, versions and reads Health_Logs.
- **Last_Dietitian_Log_Date**: The most recent `log_date` among the customer's Dietitian_Logs, or the Logging_Window start date minus one day when no Dietitian_Log exists.
- **Log_Audit_Trail**: The append-only record of every Health_Log create and update, capturing author, timestamp and changed values.
- **Logging_Window**: For `MEAL` and `KIT`, the interval from the governing subscription's `starts_on` to the earlier of `effective_end_on` and the current IST date; for `ACCOMMODATION`, the interval from the stay's `start_date` to the earlier of the stay end date and the current IST date.
- **Master_Portal**: The portal served on the `master` subdomain.
- **Max_Days_Not_Logged**: The largest Days_Not_Logged value across a set of Customer_Records.
- **Migration_Script**: The idempotent SQL and data-seeding routine delivered with this feature.
- **Paused_Day**: An IST calendar date for which `subscription_daily_preferences.is_paused` is true for the governing subscription.
- **Pending_Log_Count**: `floor(Days_Not_Logged / Cadence_Interval)` — the number of Dietitian_Logs the customer is overdue.
- **Report_Service**: The component that assembles and exports a Report_Card.
- **Report_Card**: A per-customer summary of Health_Log history, trends and adherence.
- **Self_Log**: A Health_Log whose author is the customer, captured in the Customer_Portal.
- **Skipped_Self_Log**: A Self_Log whose recorded status is `FOOD_SKIPPED`.
- **Access_Level**: The value of `users.admin_access_level`, extended by this feature to include `dietitian`.

## Requirements

### Requirement 1: Dietitian Access_Level

**User Story:** As a master admin, I want a dedicated Dietitian access level, so that dietitian accounts are provisioned through the same governed mechanism as other admin accounts.

#### Acceptance Criteria

1. THE Access_Control_Layer SHALL recognise `dietitian` as a valid Access_Level value in addition to `inventory`, `operations` and `inventory_operations`.
2. WHEN the Migration_Script executes, THE Migration_Script SHALL extend the `users.admin_access_level` check constraint to admit the value `dietitian`.
3. WHEN the Migration_Script executes a second time against the same database, THE Migration_Script SHALL leave the schema and seeded rows unchanged (idempotence property).
4. WHERE a `users` row has an Access_Level value that is not a recognised Access_Level, THE Access_Control_Layer SHALL resolve that row to `inventory_operations`, preserving the existing backward-compatible default.
5. THE Access_Control_Layer SHALL resolve Access_Level `dietitian` to an empty operations-group map.
6. FOR ALL Access_Level values, resolving a persisted Access_Level and then persisting the resolved Access_Level SHALL produce the original stored value (round-trip property).

### Requirement 2: Create a Dietitian account in the Master Portal

**User Story:** As a master admin, I want to create a dietitian account with a mobile number and an assigned clinic, so that the dietitian can log in and see the right customers.

#### Acceptance Criteria

1. THE Master_Portal SHALL display `Dietitian` as a selectable option in the Access Level dropdown of the Create New Admin dialog.
2. WHEN the master admin selects Access Level `Dietitian` in the Create New Admin dialog, THE Master_Portal SHALL display a Mobile number input and an Assign Clinic dropdown.
3. WHEN the master admin opens the Assign Clinic dropdown, THE Master_Portal SHALL list every Clinic recorded in the `clinics` table, showing the Clinic name and the owning Franchise name when the Clinic belongs to a Franchise.
4. IF the master admin submits the Create New Admin dialog with Access Level `Dietitian` and an empty Mobile number, THEN THE Dietitian_Account_Service SHALL reject the submission and return the message `Mobile number is required for a dietitian`.
5. IF the master admin submits the Create New Admin dialog with Access Level `Dietitian` and a Mobile number that is not exactly 10 digits, THEN THE Dietitian_Account_Service SHALL reject the submission and return the message `Enter a 10-digit mobile number`.
6. IF the master admin submits the Create New Admin dialog with a Mobile number that already exists on another `users` row, THEN THE Dietitian_Account_Service SHALL reject the submission and return the message `This mobile number is already registered`.
7. WHEN the Migration_Script executes, THE Migration_Script SHALL add a database check constraint requiring every `users` row with Access_Level `dietitian` to carry a Mobile number of exactly 10 digits, so that criteria 4 and 5 cannot be bypassed by a direct database write.
8. THE Access_Control_Layer SHALL enforce criterion 6 at the data layer through the existing `users_mobile_key` unique constraint.
9. WHEN the Dietitian_Account_Service creates a Dietitian for a Clinic whose `franchise_id` is NULL, THE Dietitian_Account_Service SHALL assign role `ADMIN` and set `users.franchise_id` to NULL.
10. WHEN the Dietitian_Account_Service creates a Dietitian for a Clinic whose `franchise_id` is set, THE Dietitian_Account_Service SHALL assign role `FRANCHISE_ADMIN` and set `users.franchise_id` to that Clinic's `franchise_id`.
11. IF the master admin submits a Dietitian for a Clinic that belongs to a Franchise and that Franchise already has an active Dietitian, THEN THE Dietitian_Account_Service SHALL reject the submission and return the message `This franchise already has a dietitian`.
12. THE Dietitian_Account_Service SHALL evaluate the Franchise Dietitian uniqueness check of criterion 11 inside the same database transaction that writes the Dietitian, so that two concurrent submissions produce at most one active Franchise Dietitian.
13. WHEN the Dietitian_Account_Service creates a Dietitian, THE Dietitian_Account_Service SHALL record a create entry in `admin_activity_logs` identifying the acting master admin, the created Dietitian and the assigned Clinic.
14. IF any step of Dietitian creation fails after the authentication account is created, THEN THE Dietitian_Account_Service SHALL delete the created authentication account and leave no `users` row (atomicity property).

### Requirement 3: List and edit Dietitian accounts

**User Story:** As a master admin, I want dietitians listed separately from other admins and always editable, so that I can maintain clinic assignments over time.

#### Acceptance Criteria

1. THE Master_Portal SHALL render Dietitian accounts in a Dietitians section that is separate from the Admin Users section on the User Management page.
2. THE Master_Portal SHALL exclude Dietitian accounts from the Admin Users section.
3. THE Master_Portal SHALL display, for each Dietitian, the full name, email, mobile, assigned Clinic name, owning Franchise name, active status and created date.
4. WHERE a Dietitian has no Dietitian_Clinic_Link, THE Master_Portal SHALL display the assigned Clinic as `Unassigned`.
5. WHEN the master admin opens the edit dialog for a Dietitian, THE Master_Portal SHALL present the assigned Clinic as an editable dropdown listing every Clinic.
6. WHEN the master admin changes a Dietitian's assigned Clinic, THE Dietitian_Account_Service SHALL persist the new Dietitian_Clinic_Link, update `users.franchise_id` to the new Clinic's `franchise_id`, and record an update entry in `admin_activity_logs`.
7. IF the master admin reassigns a Dietitian to a Clinic that belongs to a Franchise that already has a different active Dietitian, THEN THE Dietitian_Account_Service SHALL reject the change and return the message `This franchise already has a dietitian`.
8. WHEN the master admin changes a Dietitian's assigned Clinic, THE Assignment_Service SHALL retain every existing Dietitian_Link that references that Dietitian.
9. WHEN the master admin deactivates a Dietitian, THE Dietitian_Account_Service SHALL set `users.is_active` to false and ban the authentication account.
10. THE Health_Log_Service SHALL retain every Health_Log and every Log_Audit_Trail entry authored by a Dietitian, independent of that Dietitian's active status, ban status and Dietitian_Clinic_Link.
11. WHEN the master admin bans a Dietitian's authentication account without changing `users.is_active`, THE Access_Control_Layer SHALL deny that Dietitian access to every portal.

### Requirement 4: Seed the four existing Dietitians

**User Story:** As a master admin, I want the four dietitians already working in the business to exist in the system on release, so that logging can begin immediately.

#### Acceptance Criteria

1. WHEN the Migration_Script executes, THE Migration_Script SHALL create four Dietitian accounts with Access_Level `dietitian`: `Avinash` / `9154850031` / `arogyadiet.avinashd@gmail.com`, `Nandini` / `9154850030` / `nandini.dt03.arogyadiet@gmail.com`, `Divya` / `9154850029` / `divya.dt03.arogyadiet@gmail.com`, and `Joshitha` / `9059410172` / `joshitha.dt04.arogyadiet@gmail.com`.
2. WHEN the Migration_Script creates a seeded Dietitian, THE Migration_Script SHALL set role `ADMIN`, `franchise_id` NULL, `is_active` true and `force_password_change` true.
3. WHEN the Migration_Script creates a seeded Dietitian, THE Migration_Script SHALL leave the Dietitian_Clinic_Link empty.
4. WHILE a Dietitian has an empty Dietitian_Clinic_Link, THE Admin_Portal SHALL display only the Customer_Records whose Dietitian_Link references that Dietitian, and SHALL display the message `No clinic assigned. Contact the master admin.`
5. WHILE at least one Dietitian has an empty Dietitian_Clinic_Link, THE Master_Portal SHALL display a warning banner on the User Management page naming each such Dietitian.
6. IF a `users` row with a seeded Dietitian's email or mobile already exists, THEN THE Migration_Script SHALL leave that row unchanged and SHALL report the skipped row.

### Requirement 5: Dietitian portal access and scoping

**User Story:** As a dietitian, I want to sign in at the portal my organisation already uses and see only my own patients, so that my workspace is focused and no data leaks across tenants.

#### Acceptance Criteria

1. WHEN a Core_Business Dietitian authenticates on the `admin` subdomain, THE Access_Control_Layer SHALL grant access to the Admin_Portal.
2. WHEN a Franchise Dietitian authenticates on the `franchies` subdomain, THE Access_Control_Layer SHALL grant access to the Franchise_Portal.
3. WHEN a Dietitian requests any portal path other than the portal that matches that Dietitian's role, THE Access_Control_Layer SHALL redirect the request to `/unauthorized`.
4. WHEN a Dietitian requests an Admin_Portal or Franchise_Portal path outside the Customers workspace, the Log Customer workspace, the Report_Card workspace and the profile page, THE Access_Control_Layer SHALL redirect the request to the Dietitian's Customers workspace.
5. WHERE the Dietitian is a Core_Business Dietitian, THE Access_Control_Layer SHALL restrict that Dietitian's readable Customer_Records to Customer_Records whose `clinic_id` equals that Dietitian's linked Clinic, plus Customer_Records whose Dietitian_Link references that Dietitian.
6. WHERE the Dietitian is a Franchise Dietitian, THE Access_Control_Layer SHALL restrict that Dietitian's readable Customer_Records to Customer_Records whose `franchise_id` equals that Dietitian's `users.franchise_id`.
7. THE Access_Control_Layer SHALL enforce the Customer_Record scope of criteria 5 and 6 through Row Level Security policies in addition to application-layer filtering.
8. THE Access_Control_Layer SHALL restrict a Dietitian's write access to Health_Logs for Customer_Records inside that Dietitian's readable scope.
9. IF a Dietitian submits a Health_Log for a Customer_Record outside that Dietitian's readable scope, THEN THE Health_Log_Service SHALL reject the submission and return the message `Customer is not in your scope`.
10. THE Access_Control_Layer SHALL deny a Dietitian every write operation on Customer_Records, addresses, subscriptions, payments, shop orders and onboarding data.
11. FOR ALL Dietitians and all Customer_Records, a Customer_Record readable by a Dietitian SHALL satisfy that Dietitian's Clinic or Franchise scope predicate (scope invariant).

### Requirement 6: Dietitian_Link data model and backfill

**User Story:** As an operations lead, I want every customer to carry a dietitian link that may start empty, so that existing customers keep working while assignment is rolled out.

#### Acceptance Criteria

1. THE Assignment_Service SHALL store at most one Dietitian_Link per Customer_Record.
2. THE Assignment_Service SHALL accept an empty Dietitian_Link for a Customer_Record of any Customer_Category.
3. WHEN the Migration_Script executes, THE Migration_Script SHALL set the Dietitian_Link of every existing Customer_Record to empty.
4. IF a Dietitian_Link references a `users` row that is not a Dietitian, THEN THE Assignment_Service SHALL reject the write and return the message `Selected user is not a dietitian`.
5. WHEN a Dietitian account is deleted, THE Assignment_Service SHALL set every Dietitian_Link that references that Dietitian to empty and SHALL retain every referencing Customer_Record.
6. WHEN the Assignment_Service writes the same Dietitian_Link value for a Customer_Record twice, THE Assignment_Service SHALL produce the same stored state as a single write (idempotence property).
7. FOR ALL Customer_Records, reading a persisted Dietitian_Link and writing the read value back SHALL leave the stored Dietitian_Link unchanged (round-trip property).
8. WHEN the Assignment_Service changes a Dietitian_Link, THE Assignment_Service SHALL record an entry in `admin_activity_logs` identifying the acting user, the Customer_Record, the previous Dietitian and the new Dietitian.

### Requirement 7: Assign a Dietitian during Meal onboarding

**User Story:** As an admin onboarding a meal customer, I want to pick the dietitian right after the address step, so that the customer is linked to a dietitian from day one.

#### Acceptance Criteria

1. WHERE the selected Customer_Category is `MEAL` and the onboarding session is a Core_Business session, WHEN the address step resolves a Clinic, THE Admin_Portal SHALL display a Dietitian dropdown listing every active Dietitian linked to the resolved Clinic.
2. WHERE the selected Customer_Category is `MEAL` and the onboarding session is a Core_Business session, WHILE the address step has not resolved a Clinic, THE Admin_Portal SHALL display the Dietitian dropdown in a disabled state with the placeholder `Complete the address to load dietitians`.
3. WHEN the resolved Clinic of a Core_Business Meal onboarding changes, THE Admin_Portal SHALL reload the Dietitian dropdown options for the new Clinic and SHALL clear any previously selected Dietitian that is not linked to the new Clinic.
4. WHERE the resolved Clinic has exactly one active Dietitian, THE Admin_Portal SHALL pre-select that Dietitian in the Dietitian dropdown.
5. WHERE the resolved Clinic has no active Dietitian, THE Admin_Portal SHALL display the message `No dietitian is assigned to this clinic` and SHALL permit onboarding to continue with an empty Dietitian_Link.
6. WHERE the onboarding session is a Franchise session and the selected Customer_Category is `MEAL`, WHEN the address step completes, THE Franchise_Portal SHALL select that Franchise's single active Dietitian and SHALL display the selected Dietitian as read-only text.
7. WHEN onboarding completes, THE Assignment_Service SHALL persist the selected Dietitian as the new Customer_Record's Dietitian_Link within the same atomic operation that creates the Customer_Record.
8. IF the submitted Dietitian is not linked to the resolved Clinic, THEN THE Assignment_Service SHALL reject the onboarding submission and return the message `Selected dietitian does not belong to the resolved clinic`.

### Requirement 8: Assign a Dietitian to a KIT customer after onboarding

**User Story:** As an admin, I want to assign a dietitian to a KIT customer from the customer profile, so that KIT customers can be onboarded first and linked later.

#### Acceptance Criteria

1. WHERE the Customer_Category is `KIT` and the Customer_Record has no `franchise_id`, THE Customer_360 SHALL display a Dietitian dropdown inside the Clinic Assignment card.
2. WHERE the Customer_Record has an assigned Clinic, THE Customer_360 SHALL populate the Dietitian dropdown with every active Dietitian linked to that Clinic.
3. WHILE the Customer_Record has no assigned Clinic, THE Customer_360 SHALL display the Dietitian dropdown in a disabled state with no options and the placeholder `Assign a clinic first`.
4. WHERE the Customer_Category is `KIT`, WHEN the assigned Clinic of the Customer_Record changes and the newly assigned Clinic has exactly one active Dietitian, THE Assignment_Service SHALL set the Dietitian_Link to that Dietitian.
5. WHERE the Customer_Category is `KIT`, WHEN the assigned Clinic of the Customer_Record changes and the existing Dietitian_Link references a Dietitian not linked to the new Clinic, THE Assignment_Service SHALL set the Dietitian_Link to empty.
6. WHERE the Customer_Category is `MEAL` or `ACCOMMODATION`, WHEN the assigned Clinic of the Customer_Record changes, THE Assignment_Service SHALL leave the Dietitian_Link unchanged.
7. WHERE the Customer_Category is `KIT` and the Customer_Record has a `franchise_id`, THE Customer_360 SHALL display the Franchise's Clinic and that Franchise's single active Dietitian as read-only text in the Clinic Assignment card.
8. WHEN a KIT onboarding completes in a Franchise session, THE Assignment_Service SHALL set the new Customer_Record's Dietitian_Link to that Franchise's single active Dietitian.
9. WHEN the admin selects a Dietitian in the Clinic Assignment card, THE Assignment_Service SHALL persist the Dietitian_Link and THE Customer_360 SHALL display the persisted Dietitian name after the page revalidates.

### Requirement 9: Assign a Dietitian during Accommodation onboarding

**User Story:** As an admin onboarding an accommodation customer, I want to pick the dietitian directly in the wizard, so that daily logging starts on arrival.

#### Acceptance Criteria

1. WHERE the selected Customer_Category is `ACCOMMODATION`, THE Admin_Portal SHALL display a Dietitian dropdown in the Category & Plan step of the onboarding wizard.
2. WHERE the selected Customer_Category is `ACCOMMODATION`, THE Admin_Portal SHALL populate the Dietitian dropdown with every active Dietitian, independent of Clinic.
3. WHERE the selected Customer_Category is `ACCOMMODATION`, THE Admin_Portal SHALL permit onboarding to complete with an empty Dietitian_Link.
4. WHEN an Accommodation onboarding completes, THE Assignment_Service SHALL persist the selected Dietitian as the new Customer_Record's Dietitian_Link within the same atomic operation that creates the Customer_Record.
5. WHERE the Customer_Category is `ACCOMMODATION`, THE Customer_360 SHALL display an editable Dietitian dropdown populated with every active Dietitian.

### Requirement 10: Clinic to Dietitian cardinality

**User Story:** As a business owner, I want core clinics to support several dietitians while each franchise has exactly one, so that staffing matches each operating model.

#### Acceptance Criteria

1. THE Dietitian_Account_Service SHALL permit two or more active Dietitians to share one Clinic whose `franchise_id` is NULL.
2. THE Dietitian_Account_Service SHALL permit at most one active Dietitian per Clinic whose `franchise_id` is set.
3. THE Dietitian_Account_Service SHALL permit at most one Clinic per Franchise to carry a Dietitian_Clinic_Link.
4. IF a write would result in two active Dietitians linked to the same Franchise, THEN THE Dietitian_Account_Service SHALL reject the write and return the message `This franchise already has a dietitian`.
5. THE Access_Control_Layer SHALL enforce the at-most-one-active-Dietitian-per-Franchise rule with a database constraint in addition to application-layer validation.
6. FOR ALL Franchises, the count of active Dietitians linked to that Franchise SHALL be less than or equal to one (cardinality invariant).

### Requirement 11: Health_Log field sets

**User Story:** As a dietitian, I want the log form to show the parameters that apply to the customer's category, so that I capture the right clinical data without irrelevant fields.

#### Acceptance Criteria

1. THE Health_Log_Service SHALL define an Accommodation field set of 28 parameters: Weight, BP, BP medication in use, Fasting Sugar, PBS, Insulin units, Fat content taken (ml), Buttermilk content (litre), Soup (litre), Multivitamin (Yes/No), Omega (Yes/No), Ayurcalvita (Yes/No), PCOD (Yes/No), Meal Type (Veg/Non-veg/Eggetarian), Triglycerides Soup (Yes/No), Vegetable Juice (Yes/No), Walk (Yes/No), Step count (number), Yoga (Yes/No), Zumba (Yes/No), Water Intake (litres), Sleep (hrs), Panchakarma (Yes/No), Physiotherapy (Yes/No), Evening Activities (Yes/No), Remarks activity description (text), Dietitian/Doctor Remarks (text), Any Emergency Medication (text).
2. THE Health_Log_Service SHALL define a Meal and KIT field set as the Accommodation field set minus Yoga, Zumba, Panchakarma, Physiotherapy, Evening Activities and Remarks activity description, yielding 22 parameters.
3. WHERE the Customer_Category is `ACCOMMODATION`, THE Admin_Portal SHALL render the Accommodation field set in the log form.
4. WHERE the Customer_Category is `MEAL` or `KIT`, THE Admin_Portal SHALL render the Meal and KIT field set in the log form.
5. THE Health_Log_Service SHALL accept a Health_Log in which every parameter except the Closing_Comment is empty.
6. THE Health_Log_Service SHALL validate Weight in the inclusive range 20 to 300 kilograms.
7. THE Health_Log_Service SHALL validate BP as a systolic value in the inclusive range 60 to 250 and a diastolic value in the inclusive range 40 to 150.
8. THE Health_Log_Service SHALL validate Fasting Sugar and PBS in the inclusive range 30 to 600 milligrams per decilitre.
9. THE Health_Log_Service SHALL validate Step count in the inclusive range 0 to 100000.
10. THE Health_Log_Service SHALL validate Water Intake in the inclusive range 0 to 15 litres and Sleep in the inclusive range 0 to 24 hours.
11. IF a submitted parameter value falls outside the validated range for that parameter, THEN THE Health_Log_Service SHALL reject the submission and return a message naming the parameter and its permitted range.
12. WHERE a numeric parameter carries a value, THE Health_Log_Service SHALL store the unit of that parameter alongside the value.
13. WHERE a numeric parameter carries no value, THE Health_Log_Service SHALL store no unit for that parameter.
14. FOR ALL valid Health_Logs, persisting a Health_Log and then reading that Health_Log SHALL yield equal parameter values, units and Closing_Comment (round-trip property).

### Requirement 12: Custom_Parameters

**User Story:** As a dietitian, I want to add my own parameters to a log, so that new metrics can be tracked without waiting for a release.

#### Acceptance Criteria

1. THE Admin_Portal SHALL provide an Add Parameter control in the log form that captures a label, a value and a unit.
2. THE Health_Log_Service SHALL persist an ordered list of Custom_Parameters on each Health_Log.
3. THE Health_Log_Service SHALL accept a Custom_Parameter label of 1 to 60 characters, a value of 1 to 200 characters and a unit of 0 to 20 characters.
4. IF a submitted Custom_Parameter label is empty, THEN THE Health_Log_Service SHALL reject the submission and return the message `Custom parameter label is required`.
5. IF two Custom_Parameters in one submission share the same label after trimming and case folding, THEN THE Health_Log_Service SHALL reject the submission and return the message `Custom parameter labels must be unique`.
6. THE Health_Log_Service SHALL accept up to 20 Custom_Parameters per Health_Log.
7. THE Admin_Portal SHALL display every Custom_Parameter of a Health_Log when that Health_Log is read.
8. FOR ALL Custom_Parameter lists, serializing a list and then deserializing the serialized form SHALL yield an equal list in the same order (round-trip property).
9. WHEN a Dietitian opens the log form for a customer for whom a Custom_Parameter label was previously used, THE Admin_Portal SHALL offer that label as a suggestion.

### Requirement 13: Closing_Comment

**User Story:** As a clinical supervisor, I want every log to end with a written comment, so that each entry carries the dietitian's interpretation.

#### Acceptance Criteria

1. THE Admin_Portal SHALL display a Closing_Comment field as the final field of every log form.
2. IF a Health_Log submission has an empty Closing_Comment, THEN THE Health_Log_Service SHALL reject the submission and return the message `A closing comment is required`.
3. THE Health_Log_Service SHALL accept a Closing_Comment of 1 to 2000 characters.
4. THE Health_Log_Service SHALL store exactly one Closing_Comment per Health_Log.
5. THE Admin_Portal SHALL display the Closing_Comment with the author name and submission timestamp whenever a Health_Log is read.

### Requirement 14: Logging cadence and pending-log computation

**User Story:** As a master admin, I want a single defensible definition of how overdue a dietitian is, so that every dashboard and filter reports the same number.

#### Acceptance Criteria

1. THE Cadence_Engine SHALL set Cadence_Interval to 1 for Customer_Category `ACCOMMODATION`.
2. THE Cadence_Engine SHALL set Cadence_Interval to 3 for Customer_Category `MEAL` and Customer_Category `KIT`.
3. THE Cadence_Engine SHALL classify an IST calendar date as an Eligible_Day when that date falls inside the Logging_Window and is not a Paused_Day.
4. THE Cadence_Engine SHALL compute Days_Not_Logged as the count of Eligible_Days strictly after the Last_Dietitian_Log_Date up to and including the current IST calendar date.
5. THE Cadence_Engine SHALL compute Pending_Log_Count as the integer quotient of Days_Not_Logged divided by Cadence_Interval.
6. WHERE a customer has no Dietitian_Log, THE Cadence_Engine SHALL treat the Last_Dietitian_Log_Date as the Logging_Window start date minus one day.
7. WHILE the governing subscription status is not `ACTIVE`, THE Cadence_Engine SHALL report Days_Not_Logged as 0 and Pending_Log_Count as 0.
8. THE Cadence_Engine SHALL exclude every Paused_Day from Days_Not_Logged.
9. THE Cadence_Engine SHALL report Paused_Days_Count as the count of Paused_Days strictly after the Last_Dietitian_Log_Date up to and including the current IST calendar date.
10. WHEN a Dietitian_Log is recorded with a `log_date` equal to the current IST calendar date, THE Cadence_Engine SHALL report Days_Not_Logged as 0 and Pending_Log_Count as 0 for that customer.
11. FOR ALL customers, converting an Eligible_Day into a Paused_Day SHALL leave Days_Not_Logged unchanged or reduce Days_Not_Logged (monotonicity property).
12. FOR ALL customers, Pending_Log_Count SHALL be greater than 0 if and only if Days_Not_Logged is greater than or equal to Cadence_Interval (equivalence property).
13. FOR ALL customers, Days_Not_Logged SHALL be greater than or equal to 0 and less than or equal to the count of Eligible_Days in the Logging_Window (bounds invariant).
14. THE Cadence_Engine SHALL evaluate every calendar boundary in Asia/Kolkata time.

### Requirement 15: Record a Health_Log through the Log Customer workflow

**User Story:** As a dietitian, I want to find a customer and record a log in a few steps, so that daily logging is fast.

#### Acceptance Criteria

1. THE Admin_Portal SHALL display a Log Customer call to action in place of the Shop Orders and Onboarding calls to action when the signed-in user is a Dietitian.
2. THE Franchise_Portal SHALL display a Log Customer call to action in place of the Quick Onboard and Create Customer calls to action when the signed-in user is a Dietitian.
3. WHEN a Dietitian activates the Log Customer call to action, THE Admin_Portal SHALL display a searchable list of the Customer_Records in that Dietitian's readable scope, showing for each row the customer name, mobile, Customer_Category, Last_Dietitian_Log_Date, Days_Not_Logged and Pending_Log_Count.
4. THE Admin_Portal SHALL support searching the Log Customer list by customer name, mobile and customer code.
5. WHEN a Dietitian selects a customer from the Log Customer list, THE Admin_Portal SHALL display the log form for that customer's Customer_Category with the log date defaulted to the current IST calendar date.
6. THE Admin_Portal SHALL permit a Dietitian to set the log date to any Eligible_Day within the trailing 7 days.
7. IF a Dietitian submits a Health_Log with a log date later than the current IST calendar date, THEN THE Health_Log_Service SHALL reject the submission and return the message `Log date cannot be in the future`.
8. IF a Dietitian submits a Health_Log with a log date that is a Paused_Day, THEN THE Health_Log_Service SHALL reject the submission and return the message `The selected date is paused for this customer`.
9. WHEN a Dietitian submits a Health_Log for a customer and log date that already has a Dietitian_Log by the same Dietitian, THE Health_Log_Service SHALL update that Health_Log rather than create a second Health_Log.
10. WHERE a Dietitian_Log already exists for a log date, THE Health_Log_Service SHALL permit an update to that Dietitian_Log even when the log date has since become a Paused_Day, overriding criterion 8 for updates only.
11. THE Health_Log_Service SHALL permit at most one Dietitian_Log per Customer_Record per log date.
12. WHEN the Health_Log_Service persists a Health_Log, THE Health_Log_Service SHALL record the authoring user identifier, the author type, the submission timestamp and the Closing_Comment.
13. IF the authoring user identifier or the submission timestamp cannot be resolved, THEN THE Health_Log_Service SHALL reject the submission and return the message `Could not identify the author of this log`.
14. WHERE optional submission metadata beyond the authoring user identifier, author type, submission timestamp and Closing_Comment is unavailable, THE Health_Log_Service SHALL persist the Health_Log without that optional metadata.
15. WHEN a Dietitian submits a Health_Log successfully, THE Admin_Portal SHALL display a confirmation and SHALL return the Dietitian to the Log Customer list.

### Requirement 16: Read-only Customers workspace for Dietitians

**User Story:** As a dietitian, I want to review customer profiles, addresses and self-logs without being able to change them, so that operational data stays intact.

#### Acceptance Criteria

1. WHEN a Dietitian opens the Customers navigation page, THE Admin_Portal SHALL render the existing Customers workspace with every create, edit, deactivate, export-mutating and bulk-import control removed.
2. THE Admin_Portal SHALL display the customer profile, the customer's addresses, the governing subscription summary and the customer's Health_Log history to a Dietitian.
3. THE Admin_Portal SHALL display a Self_Log adherence panel for every Customer_Record containing the customer's Self_Logs, the count of Skipped_Self_Logs, the count of dates within the Logging_Window that have no Self_Log, and Paused_Days_Count.
4. WHERE the Customer_Category is `MEAL` or `ACCOMMODATION`, THE Admin_Portal SHALL display the Self_Log counts of criterion 3 as 0 and the Self_Log list as empty.
5. IF a Dietitian issues a write request against a Customer_Record, an address, a subscription, a payment, a shop order or onboarding data, THEN THE Access_Control_Layer SHALL reject the request and return an authorization error.
6. THE Admin_Portal SHALL display the assigned Dietitian name on each Customer_Record row visible to a Dietitian.

### Requirement 17: Dietitian list filters and sorting

**User Story:** As a dietitian, I want to filter and sort my customer list by logging status, so that I can work through the customers who need attention first.

#### Acceptance Criteria

1. THE Admin_Portal SHALL provide a filter that restricts the Dietitian's customer list to Customer_Records with at least one date in the Logging_Window that has no Self_Log.
2. THE Admin_Portal SHALL provide a filter that restricts the Dietitian's customer list to Customer_Records whose Pending_Log_Count is greater than 0.
3. THE Admin_Portal SHALL provide a filter that accepts a whole number of days and restricts the Dietitian's customer list to Customer_Records whose Days_Not_Logged is greater than or equal to that number.
4. THE Admin_Portal SHALL provide a sort on Last_Dietitian_Log_Date in ascending and descending order.
5. THE Admin_Portal SHALL provide a sort on Days_Not_Logged in ascending and descending order.
6. WHERE a Customer_Record has no Dietitian_Log, THE Admin_Portal SHALL treat that Customer_Record's Last_Dietitian_Log_Date as the earliest orderable value in every ordering of the Dietitian's customer list, including the default ordering.
7. WHEN two or more filters are active, THE Admin_Portal SHALL display only the Customer_Records that satisfy every active filter, combining the filters with logical conjunction.
8. FOR ALL filter combinations, the displayed row count SHALL be less than or equal to the unfiltered row count (monotonicity property).
9. FOR ALL sort directions, applying a sort SHALL preserve the multiset of displayed Customer_Records (permutation invariant).

### Requirement 18: Health_Log edit window and audit trail

**User Story:** As a clinical supervisor, I want log corrections limited and fully traceable, so that the record stays trustworthy.

#### Acceptance Criteria

1. WHILE the current IST calendar date equals the submission date of a Dietitian_Log, THE Health_Log_Service SHALL permit the authoring Dietitian to update that Dietitian_Log.
2. IF a Dietitian submits an update to a Dietitian_Log whose submission date is earlier than the current IST calendar date, THEN THE Health_Log_Service SHALL reject the update and return the message `This log can no longer be edited`.
3. IF a Dietitian submits an update to a Dietitian_Log authored by a different Dietitian, THEN THE Health_Log_Service SHALL reject the update and return the message `You can only edit your own logs`.
4. THE Health_Log_Service SHALL reject every request to delete a Health_Log and SHALL return the message `Health logs cannot be deleted`.
5. WHEN the Health_Log_Service accepts a Health_Log create or update, THE Health_Log_Service SHALL append an entry to the Log_Audit_Trail recording the acting user, the action, the outcome `ACCEPTED`, the timestamp, the Customer_Record, the log date and the changed parameter values.
6. WHEN the Health_Log_Service rejects a Health_Log create or update, THE Health_Log_Service SHALL append an entry to the Log_Audit_Trail recording the acting user, the action, the outcome `REJECTED`, the rejection reason, the timestamp, the Customer_Record and the log date.
7. THE Log_Audit_Trail SHALL reject updates and deletes of its own entries.
8. THE Master_Portal SHALL display the Log_Audit_Trail entries for a selected Customer_Record in reverse chronological order, showing the outcome of each entry.
9. FOR ALL sequences of Health_Log write attempts, the count of Log_Audit_Trail entries SHALL equal the count of attempted create and update operations (accounting invariant).
10. FOR ALL sequences of Health_Log write attempts, the count of Log_Audit_Trail entries whose outcome is `ACCEPTED` SHALL equal the count of persisted Health_Log versions (consistency invariant).

### Requirement 19: Per-customer Report_Card

**User Story:** As a dietitian, I want a report card per KIT and accommodation customer, so that I can review progress and share it.

#### Acceptance Criteria

1. WHERE the Customer_Category is `KIT` or `ACCOMMODATION`, THE Admin_Portal SHALL provide a Report Card action on the Customer_Record.
2. WHEN a Dietitian opens a Report_Card, THE Report_Service SHALL display a date-ordered table of every recorded parameter value across the customer's Health_Logs.
3. WHEN a Dietitian opens a Report_Card, THE Report_Service SHALL display trend charts for Weight, BP and Fasting Sugar over the Logging_Window.
4. WHEN a Dietitian opens a Report_Card, THE Report_Service SHALL display an adherence summary containing the count of Dietitian_Logs recorded, Pending_Log_Count, the count of Self_Logs recorded, the count of Skipped_Self_Logs and Paused_Days_Count.
5. WHEN a Dietitian opens a Report_Card, THE Report_Service SHALL display every Closing_Comment in reverse chronological order with the author name.
6. THE Report_Service SHALL provide a PDF export of the Report_Card.
7. WHEN the Report_Service generates a PDF export, THE Report_Service SHALL include the customer name, customer code, Customer_Category, assigned Dietitian name, generation timestamp in IST, the parameter table, the trend charts, the adherence summary and the Closing_Comment history.
8. IF a Report_Card is requested for a Customer_Record with no Health_Log, THEN THE Report_Service SHALL display the message `No health logs recorded yet` and SHALL disable the PDF export.
9. FOR ALL Report_Cards, the sum of Dietitian_Logs recorded and Pending_Log_Count SHALL be less than or equal to the count of Eligible_Days in the Logging_Window divided by Cadence_Interval plus one (accounting invariant).

### Requirement 20: Master Dietitian_Activity_Report

**User Story:** As a master admin, I want a dietitian activity view on the dashboard, so that I can see who is behind on logging.

#### Acceptance Criteria

1. THE Master_Portal SHALL display a Dietitian dropdown on the master dashboard listing every active Dietitian with the assigned Clinic name.
2. WHEN the master admin selects a Dietitian, THE Dietitian_Activity_Report SHALL display the count of that Dietitian's linked Customer_Records whose Pending_Log_Count is greater than 0.
3. WHEN the master admin selects a Dietitian, THE Dietitian_Activity_Report SHALL display the Max_Days_Not_Logged across that Dietitian's linked Customer_Records.
4. WHEN the master admin selects a Dietitian, THE Dietitian_Activity_Report SHALL display the exact count, computed from the Health_Log store at request time, of that Dietitian's linked Customer_Records that have at least one date in the Logging_Window with no Self_Log.
5. WHEN the master admin selects a Dietitian, THE Dietitian_Activity_Report SHALL display a per-customer table containing the customer name, Customer_Category, Last_Dietitian_Log_Date, Days_Not_Logged, Pending_Log_Count, the count of Skipped_Self_Logs and Paused_Days_Count.
6. THE Dietitian_Activity_Report SHALL provide navigation from a per-customer row to that customer's Report_Card.
7. WHERE the selected Dietitian has no linked Customer_Record, THE Dietitian_Activity_Report SHALL display the message `No customers are assigned to this dietitian`.
8. THE Dietitian_Activity_Report SHALL compute every metric using the Cadence_Engine.
9. FOR ALL selected Dietitians, the count of Customer_Records with Pending_Log_Count greater than 0 SHALL be less than or equal to the count of that Dietitian's linked Customer_Records (bounds invariant).
10. FOR ALL selected Dietitians, Max_Days_Not_Logged SHALL equal the maximum Days_Not_Logged in the per-customer table (consistency invariant).

### Requirement 21: Multi-user Franchise Portal

**User Story:** As a master admin, I want to create several franchise users with different access levels, so that a franchise team can share the dashboard the way the core admin team does.

#### Acceptance Criteria

1. THE Master_Portal SHALL provide a Franchise Users section on the Edit Franchise workspace listing every `users` row whose `franchise_id` equals the selected Franchise.
2. THE Master_Portal SHALL provide a Create Franchise User action on the Edit Franchise workspace that captures full name, email, mobile, password and Access_Level.
3. THE Dietitian_Account_Service SHALL assign role `FRANCHISE_ADMIN` and `users.franchise_id` equal to the selected Franchise to every user created through the Create Franchise User action.
4. THE Franchise_Portal SHALL reject any attempt to create, edit or delete a Franchise user.
5. THE Access_Control_Layer SHALL apply the same Access_Level path gate to Franchise_Portal routes that it applies to Admin_Portal routes.
6. THE Access_Control_Layer SHALL treat the Franchise_Owner referenced by `franchises.owner_user_id` as having Access_Level `inventory_operations`.
7. WHEN a Franchise user with a restricted Access_Level requests a Franchise_Portal path outside that Access_Level, THE Access_Control_Layer SHALL redirect the request to that user's landing route.
8. THE Access_Control_Layer SHALL restrict every Franchise user's readable data to rows whose `franchise_id` equals that user's `franchise_id`.
9. IF a Franchise user's `users.franchise_id` is empty, THEN THE Access_Control_Layer SHALL redirect that user to `/unauthorized`.
10. WHILE the Franchise status is `suspended`, THE Access_Control_Layer SHALL redirect every Franchise user of that Franchise to `/unauthorized`.
11. FOR ALL Franchise users, every row readable by that user SHALL carry a `franchise_id` equal to that user's `franchise_id` (tenant isolation invariant).

### Requirement 22: Create a Franchise Dietitian from Edit Franchise

**User Story:** As a master admin, I want to create a franchise's dietitian from the franchise hierarchy, so that franchise staffing is managed where the franchise is managed.

#### Acceptance Criteria

1. THE Master_Portal SHALL provide a Create Dietitian action on the Edit Franchise dialog in the Franchise Hierarchy workspace.
2. WHEN the master admin activates the Create Dietitian action, THE Master_Portal SHALL capture full name, email, mobile and password, and SHALL display the Franchise's Clinic as read-only text.
3. WHEN the Dietitian_Account_Service creates a Franchise Dietitian, THE Dietitian_Account_Service SHALL set Access_Level `dietitian`, role `FRANCHISE_ADMIN`, `users.franchise_id` equal to the Franchise, and the Dietitian_Clinic_Link to the Franchise's Clinic.
4. IF the selected Franchise has no Clinic, THEN THE Master_Portal SHALL disable the Create Dietitian action and SHALL display the message `Wire a clinic to this franchise first`.
5. IF the selected Franchise already has an active Dietitian, THEN THE Master_Portal SHALL replace the Create Dietitian action with an Edit Dietitian action for that Dietitian.
6. WHERE the selected Franchise has a Clinic and has no active Dietitian, THE Master_Portal SHALL display the Create Dietitian action in an enabled state.
7. IF any step of Franchise Dietitian creation fails, THEN THE Dietitian_Account_Service SHALL revert the authentication account, the `users` row and the Dietitian_Clinic_Link, leaving no partial Dietitian (atomicity property).
8. THE Access_Control_Layer SHALL grant a Franchise Dietitian read access to every Customer_Record whose `franchise_id` equals that Dietitian's Franchise.

### Requirement 23: Franchise Dietitian experience

**User Story:** As a franchise dietitian, I want the same read-only customer workspace and logging flow as a core dietitian, so that training and behaviour are consistent.

#### Acceptance Criteria

1. WHERE the signed-in user is a Franchise Dietitian, WHEN that user opens the Customers navigation page, THE Franchise_Portal SHALL render the franchise Customers workspace with every create, edit and deactivate control removed.
2. WHERE the signed-in user is not a Franchise Dietitian, THE Franchise_Portal SHALL render the Customers navigation page with the controls that user's Access_Level granted before this feature.
3. THE Franchise_Portal SHALL display a Log Customer call to action to a Franchise Dietitian in place of the Quick Onboard and Create Customer calls to action.
4. THE Franchise_Portal SHALL apply the field sets of Requirement 11, the Custom_Parameter rules of Requirement 12, the Closing_Comment rules of Requirement 13, the cadence rules of Requirement 14 and the edit-window rules of Requirement 18 to a Franchise Dietitian.
5. THE Franchise_Portal SHALL provide the filters and sorts of Requirement 17 to a Franchise Dietitian.
6. THE Franchise_Portal SHALL provide the Report_Card of Requirement 19 to a Franchise Dietitian.
7. THE Franchise_Portal SHALL import no module from the `src/app/admin` directory and SHALL import shared logging components from `src/shared` only, preserving portal isolation.

### Requirement 24: Franchise Owner activity report

**User Story:** As a franchise owner, I want the dietitian activity report for my franchise, so that I can hold my dietitian accountable.

#### Acceptance Criteria

1. THE Franchise_Portal SHALL provide a Dietitian Activity page to the Franchise_Owner.
2. WHEN the Franchise_Owner opens the Dietitian Activity page, THE Dietitian_Activity_Report SHALL display the metrics of Requirement 20 restricted to Customer_Records whose `franchise_id` equals the Franchise_Owner's `franchise_id`.
3. THE Access_Control_Layer SHALL deny access to the Dietitian Activity page to every Franchise user whose Access_Level does not grant the customers group.
4. WHERE the Franchise has no active Dietitian, THE Franchise_Portal SHALL display the message `No dietitian is assigned to this franchise`.
5. THE Dietitian_Activity_Report SHALL compute the Franchise-scoped metrics with the same Cadence_Engine used by the Master_Portal.
6. FOR ALL Franchises, the Franchise-scoped Dietitian_Activity_Report values SHALL equal the values the Master_Portal reports for the same Dietitian (consistency property).

### Requirement 25: Customer Self_Log visibility

**User Story:** As a dietitian, I want to see what my KIT customers logged themselves, so that my own log builds on their input.

#### Acceptance Criteria

1. THE Health_Log_Service SHALL expose every Self_Log of a Customer_Record to the Dietitian whose Dietitian_Link references that Customer_Record.
2. THE Health_Log_Service SHALL expose every Self_Log of a Customer_Record to Dietitians within that Customer_Record's Clinic or Franchise scope.
3. THE Admin_Portal SHALL display Self_Logs and Dietitian_Logs in a single date-ordered timeline that labels the author type of each entry.
4. THE Access_Control_Layer SHALL deny a Dietitian write access to Self_Logs.
5. THE Customer_Portal SHALL retain the existing Self_Log capture behavior without change.
6. WHEN a Dietitian opens the log form for a KIT customer and a Self_Log exists for the selected log date, THE Admin_Portal SHALL display the Self_Log values as read-only reference text beside the log form.
7. THE Admin_Portal SHALL leave every log form field empty when a Self_Log exists for the selected log date, so that no Self_Log value is copied into a Dietitian_Log.
8. THE Health_Log_Service SHALL persist only the values a Dietitian entered in the log form and SHALL persist no value derived from a Self_Log.

### Requirement 26: Data migration and rollout safety

**User Story:** As a release owner, I want the rollout to leave existing behavior intact, so that the release is safe to ship to production.

#### Acceptance Criteria

1. WHEN the Migration_Script executes, THE Migration_Script SHALL create the Health_Log storage, the Custom_Parameter storage, the Dietitian_Clinic_Link storage, the Dietitian_Link storage and the Log_Audit_Trail storage.
2. WHEN the Migration_Script executes, THE Migration_Script SHALL create Row Level Security policies for every table it creates.
3. THE Migration_Script SHALL retain every existing row in `admin_health_logs`, `customer_health_logs` and `kit_daily_logs`.
4. WHEN the Migration_Script executes, THE Migration_Script SHALL expose existing `admin_health_logs`, `customer_health_logs` and `kit_daily_logs` rows through the Health_Log read model, mapping each source row to its corresponding Customer_Record and log date.
5. THE Migration_Script SHALL preserve the existing behavior of every non-Dietitian Access_Level.
6. WHEN a user whose Access_Level is not `dietitian` signs in, THE Access_Control_Layer SHALL grant the same access that user had before this feature.
7. THE Migration_Script SHALL create indexes supporting lookup of Health_Logs by Customer_Record and log date, and lookup of Customer_Records by Dietitian_Link.
8. FOR ALL executions, running the Migration_Script twice SHALL produce the same database state as running the Migration_Script once (idempotence property).

## Assumptions Requiring Confirmation

1. Seeded Dietitians (Requirement 4) start with no Clinic because the four named Dietitians' clinics were not supplied. The master admin assigns each Clinic after release; until then those Dietitians see zero customers.
2. Existing Customer_Records receive an empty Dietitian_Link (Requirement 6.3) rather than an inferred link, because no historical customer-to-dietitian mapping exists in the database.
3. The Franchise Dietitian is modelled as a `FRANCHISE_ADMIN` with Access_Level `dietitian` so that the existing Franchise_Portal role gate and franchise RLS boundary apply without a new role code.

## Reconciled Review Findings

Three answers from the requirements review conflicted with tenant isolation or audit integrity. The criteria below encode a reconciled reading rather than the literal answer:

1. **A Dietitian with no Clinic (Requirement 4.4).** The literal answer was to display existing Customer_Records to an unassigned Dietitian. Showing every Customer_Record to a Dietitian with no scope predicate would breach the Clinic and Franchise boundary of Requirement 5. The criterion instead grants visibility of only the Customer_Records explicitly linked to that Dietitian, which shows existing work without widening the scope.
2. **Partial log metadata (Requirement 15.13, 15.14).** The literal answer permitted persisting a Health_Log when metadata capture fails. Losing the author or timestamp would make the Log_Audit_Trail unverifiable, so those two fields are mandatory and only optional metadata may be absent.
3. **Rejected write attempts in the audit trail (Requirement 18.6, 18.9, 18.10).** Recording rejected attempts is valuable, so it is now required, and the accounting invariant was restated over attempted operations with a separate invariant over accepted operations. Without that restatement, criteria 5 and 9 would have contradicted each other.
