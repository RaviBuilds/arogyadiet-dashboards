# Requirements Document

## Introduction

This feature introduces a City → Kitchen → Clinic hierarchy for the ArogyaDiet CORE business. It repurposes the existing kitchen entity from a rider pickup / routing origin into a meal-preparation and workload-aggregation entity, and introduces a new Clinic entity that becomes the rider pickup origin and geographic routing origin.

The Clinic model is built generically so it can later extend to franchises (a franchise will relate 1:1 to a clinic), but only the CORE path is implemented in this spec. All franchise behavior remains gated behind the existing `FRANCHISE_FEATURES_ENABLED` flag and is out of scope to implement here; the data model is kept franchise-ready (for example, `clinics.franchise_id` nullable, where `NULL` means a core clinic).

This is the first of three sequenced specs. The following are explicitly OUT OF SCOPE and belong to later specs: scope-based access-control overhaul; shop-products → warehouse relocation; franchise warehouse and core→franchise stock transfer; full franchise clinic wiring.

Key invariants established by this feature:
- One pincode belongs to exactly one clinic (no duplicates across clinics).
- When a pincode is moved between clinics, associated customers are automatically reassigned to the new clinic.
- A rider is linked to exactly one clinic, and a rider's service-area pincodes must belong to that rider's clinic.
- Per-clinic routing produces one batch per active rider; total batches equal the sum of riders across all clinics.
- Finalized workload snapshots are persisted (stored, not just computed live) for historical reporting.

## Glossary

- **City**: A new database entity representing a geographic city. Cities own kitchens. Created/edited/deleted by the Master_Admin.
- **Kitchen**: An existing entity (table `kitchens`, retained — not dropped) that belongs to a City. After this feature, the Kitchen performs meal preparation and workload aggregation and serves many Clinics. The Kitchen is no longer the rider pickup or routing origin.
- **Clinic**: A new entity representing a rider pickup origin and geographic routing origin. Each Clinic has a name and a full address with geo location (latitude and longitude) and belongs to exactly one Kitchen via `clinics.kitchen_id`. A Clinic optionally references a franchise via nullable `clinics.franchise_id` (`NULL` = core clinic).
- **Core Clinic**: A Clinic where `franchise_id` is `NULL`.
- **Franchise**: An existing, feature-flagged entity that will later relate 1:1 to a Clinic. Not implemented in this feature beyond keeping the model franchise-ready.
- **Routing_Engine**: The routing and batching engine implemented in `src/actions/system-actions/routeEngine.ts`.
- **Service_Area**: A record in `rider_service_areas` (pincode, rider_id, area_name, franchise_id) that maps a pincode to a rider, extended by this feature to also associate with a Clinic.
- **Customer**: A subscriber record (`customer_profiles`) with one or more `addresses`. Linked to a Clinic via the address pincode.
- **Rider**: A delivery partner (`rider_profiles`) linked to exactly one Clinic and assigned service-area pincodes.
- **Automation_Pipeline**: The existing central daily automation that runs order creation, product linking, workload snapshotting, and routing for all scopes.
- **Workload_Snapshot**: A persisted, finalized record of a Clinic's prep workload for a target date, including meal counts broken down by veg / non-veg / egg and shop product counts.
- **Admin**: A user with the `ADMIN` role (core admin).
- **Master_Admin**: A super-admin user with the `MASTER_ADMIN` role operating in the master portal.
- **Madhapur_Clinic**: The single temporary seed Clinic created during data migration using the existing central kitchen's address and coordinates as a placeholder.
- **Haversine_Multiplier**: The fixed `1.3` multiplier applied to Haversine distance to estimate road distance for payout.
- **Payout_Per_Km**: The system-wide setting `rider_payout_per_km` used to compute rider payout.
- **Delivery_Order**: A record in `delivery_orders` representing one delivery for one Customer on one delivery date, extended by this feature with a `clinic_id` column.
- **Delivery_Batch**: A record in `delivery_batches` representing a Rider's daily batch of deliveries for a delivery date, extended by this feature with a `clinic_id` column.
- **Order_Clinic_Stamp**: The `clinic_id` value recorded on a Delivery_Order at the time the order is created, and on a Delivery_Batch at the time the batch is created during routing. The Order_Clinic_Stamp is immutable after creation and is the authoritative basis for per-Clinic workload snapshots and per-Clinic routing and delivery history.

## Requirements

### Requirement 1: City Entity

**User Story:** As a Master_Admin, I want to manage cities, so that kitchens and clinics can be organized under a clean geographic hierarchy that can later host franchises.

#### Acceptance Criteria

1. THE System SHALL persist a City entity with a system-generated unique identifier and a city name, where the city name is a non-empty string of 1 to 100 characters and is unique (case-insensitive) across all City records.
2. WHEN a Master_Admin submits a city name that is non-empty, between 1 and 100 characters, and does not match (case-insensitively) any existing City name, THE System SHALL create a City record and return its unique identifier.
3. IF a Master_Admin submits a city name that is empty, exceeds 100 characters, or matches (case-insensitively) an existing City name, THEN THE System SHALL reject the create or update operation, leave existing City records unchanged, and return an error message indicating the specific validation failure (empty name, length exceeded, or duplicate name).
4. WHEN a Master_Admin edits an existing City with a city name that is non-empty, between 1 and 100 characters, and does not match (case-insensitively) any other existing City name, THE System SHALL update the City record.
5. WHEN a Master_Admin deletes an existing City that has zero associated Kitchen records, THE System SHALL delete the City record.
6. IF a Master_Admin attempts to delete a City that has at least one associated Kitchen record, THEN THE System SHALL reject the deletion, retain the City record and its associations, and return an error message indicating the City has associated Kitchens.
7. IF a Master_Admin attempts to edit or delete a City identifier that does not exist, THEN THE System SHALL reject the operation and return an error message indicating the City was not found.

### Requirement 2: Kitchen Belongs to City and Is Repurposed

**User Story:** As a Master_Admin, I want kitchens to belong to a city and serve many clinics, so that the kitchen represents meal preparation and workload aggregation rather than the rider pickup origin.

#### Acceptance Criteria

1. THE System SHALL retain the existing `kitchens` table without dropping it.
2. THE System SHALL associate each Kitchen with exactly one City.
3. THE System SHALL allow one Kitchen to be associated with one or more Clinics, with no upper limit on the number of Clinics served.
4. THE Routing_Engine SHALL NOT use Kitchen coordinates as the routing origin for core dispatch.
5. WHEN a Master_Admin saves a Kitchen (create or edit) with a valid associated City, THE System SHALL persist the Kitchen together with its City association and indicate that the save succeeded.
6. IF a Master_Admin attempts to save a Kitchen without a valid associated City, THEN THE System SHALL reject the operation, leave any existing Kitchen record unchanged, and display an error message indicating that a City association is required.
7. IF a Master_Admin attempts to associate a Clinic with a Kitchen whose City differs from the Clinic's City, THEN THE System SHALL reject the association, leave the existing Clinic-to-Kitchen associations unchanged, and display an error message indicating that the Kitchen and Clinic must belong to the same City.
8. THE System SHALL retain Kitchen records for use by the workload view and historical statistics.

### Requirement 3: Clinic Entity (Routing Origin)

**User Story:** As a Master_Admin, I want to define clinics with a name and geo location, so that each clinic acts as an independent rider pickup and routing origin.

#### Acceptance Criteria

1. THE System SHALL persist a Clinic entity with a unique identifier, a clinic name, a full address, a latitude, a longitude, a `kitchen_id`, and a nullable `franchise_id`.
2. THE System SHALL associate each Clinic with exactly one Kitchen via `clinics.kitchen_id`.
3. THE System SHALL allow one Kitchen to be associated with many Clinics.
4. WHERE a Clinic has a `franchise_id` of `NULL`, THE System SHALL treat the Clinic as a Core Clinic.
5. WHEN a Master_Admin creates a Clinic, THE System SHALL require a non-empty clinic name of 1 to 120 characters, a non-empty full address of 1 to 255 characters, a latitude in the range -90.0 to 90.0 inclusive, a longitude in the range -180.0 to 180.0 inclusive, and an existing `kitchen_id` before persisting the Clinic.
6. IF a Master_Admin submits a Clinic with a missing latitude, a missing longitude, a latitude outside -90.0 to 90.0, or a longitude outside -180.0 to 180.0, THEN THE System SHALL reject the creation, return an error message indicating the invalid or missing geo coordinate, and persist no Clinic record.
7. IF a Master_Admin submits a Clinic with a missing clinic name, a missing full address, a clinic name exceeding 120 characters, or a full address exceeding 255 characters, THEN THE System SHALL reject the creation, return an error message indicating the offending field, and persist no Clinic record.
8. IF a Master_Admin submits a Clinic with a `kitchen_id` that does not reference an existing Kitchen, THEN THE System SHALL reject the creation, return an error message indicating the Kitchen does not exist, and persist no Clinic record.
9. THE System SHALL keep the Clinic model franchise-ready WITHOUT implementing franchise-specific behavior in this feature.

### Requirement 4: One-Pincode-One-Clinic Invariant

**User Story:** As an Admin, I want each pincode to belong to exactly one clinic, so that there is no ambiguity about which clinic serves a given area.

#### Acceptance Criteria

1. THE System SHALL associate each Service_Area pincode in `rider_service_areas` with exactly one Clinic.
2. THE System SHALL enforce a database-level unique constraint on the pincode column of `rider_service_areas` such that no pincode value can be associated with more than one Clinic at any time.
3. IF an Admin attempts to add a pincode to a Clinic while that pincode is already associated with a different Clinic, THEN THE System SHALL reject the operation, leave the existing pincode-to-Clinic association unchanged, and return an error indicating that the pincode is already assigned and identifying the Clinic that currently owns it.
4. WHEN an Admin moves a pincode from a source Clinic to a destination Clinic, THE System SHALL atomically remove the association with the source Clinic and create the association with the destination Clinic, such that on success the pincode is associated only with the destination Clinic and on failure the pincode remains associated only with the source Clinic.
5. IF a concurrent or duplicate request causes the unique constraint to be violated during an add or move operation, THEN THE System SHALL reject the conflicting operation, retain the single existing association, and return an error indicating the pincode is already assigned.

### Requirement 5: Service Areas Administration by Clinic

**User Story:** As an Admin, I want the Service Areas section organized into clinic subsections, so that I can add, edit, delete, and move pincodes per clinic.

#### Acceptance Criteria

1. WHEN an Admin opens the Service Areas section, THE System SHALL display all Service_Area pincodes grouped under their associated Clinic subsection, with each pincode appearing under exactly one Clinic.
2. WHEN an Admin adds a 6-digit pincode that is not currently associated with any Clinic to a Clinic, THE System SHALL create a Service_Area association between the pincode and that Clinic and display the pincode under that Clinic's subsection.
3. IF an Admin attempts to add a pincode that is already associated with another Clinic, THEN THE System SHALL reject the operation, retain the existing association unchanged, and display an error message indicating the pincode is already assigned to a Clinic.
4. IF an Admin enters a pincode value that is not exactly 6 numeric digits when adding or editing, THEN THE System SHALL reject the operation, make no change to any Service_Area record, and display an error message indicating the pincode format is invalid.
5. WHEN an Admin edits a pincode entry within a Clinic to a new value that is a 6-digit pincode not associated with any other Clinic, THE System SHALL update the corresponding Service_Area record to the new pincode value.
6. WHEN an Admin deletes a pincode from a Clinic, THE System SHALL remove the Service_Area association for that pincode and remove the pincode from that Clinic's subsection.
7. WHEN an Admin moves a pincode from a source Clinic to a destination Clinic, THE System SHALL reassign the pincode association to the destination Clinic, remove it from the source Clinic, and ensure the pincode remains associated with exactly one Clinic.

### Requirement 6: Customer Linked to Clinic by Pincode (Stamping)

**User Story:** As an Admin, I want customers linked to a clinic based on their address pincode, so that customer-to-clinic assignment is consistent and stored.

#### Acceptance Criteria

1. WHEN a Customer creates an account with a delivery address whose pincode resolves to exactly one Clinic, THE System SHALL stamp the Customer with the corresponding `clinic_id` within the same operation before reporting completion.
2. WHEN a Customer updates a delivery address to a pincode that resolves to exactly one Clinic, THE System SHALL update the stamped `clinic_id` to that Clinic within the same operation before reporting completion.
3. THE System SHALL persist the resolved `clinic_id` on the Customer record and SHALL NOT recompute it only at read time.
4. IF a Customer's address pincode at signup does not resolve to any Clinic, THEN THE System SHALL leave the Customer `clinic_id` unset.
5. WHEN a Customer who was previously stamped updates a delivery address to a pincode that resolves to no Clinic, THE System SHALL set that Customer's `clinic_id` to unset.
6. IF a Customer's address pincode resolves to more than one Clinic, THEN THE System SHALL leave the Customer `clinic_id` unchanged and surface an ambiguity indication.
7. THE System SHALL preserve the existing outcomes, accepted inputs, and completion behavior of the customer signup and address-update flows, adding only the `clinic_id` stamping and clearing actions.

### Requirement 7: Customer Auto-Reassignment on Pincode Move

**User Story:** As an Admin, I want customers automatically reassigned when their pincode moves to another clinic, so that customer-to-clinic links stay accurate without manual updates.

#### Acceptance Criteria

1. WHEN a pincode is moved from Clinic A to Clinic B, THE System SHALL identify every Customer whose stamped address pincode equals the moved pincode and whose current stamped clinic is Clinic A, and reassign each such Customer to Clinic B.
2. WHEN reassigning an affected Customer, THE System SHALL update both that Customer's stamped `clinic_id` and the `clinic_id` of that Customer's matching address record to Clinic B.
3. WHEN the reassignment completes successfully, THE System SHALL report the total count of Customers reassigned, returning a count of zero when no Customer matches the moved pincode.
4. THE System SHALL apply the reassignment using the same batch-assignment pattern established by `assignWaitlistedCustomers` in `assignment-resolver.ts`.
5. IF the batch reassignment operation fails, THEN THE System SHALL leave the stamped `clinic_id` of all affected Customers unchanged and return an error indication describing the failure.

### Requirement 8: Rider Single-Clinic Linkage

**User Story:** As an Admin, I want to manually assign each rider to exactly one clinic, so that riders pick up from a single, well-defined origin.

#### Acceptance Criteria

1. THE System SHALL maintain at most one active Rider-to-Clinic linkage per Rider at any time.
2. WHEN an Admin assigns a Rider to a Clinic that exists and is active, THE System SHALL store the Rider-to-Clinic linkage and indicate to the Admin that the assignment succeeded.
3. WHEN an Admin reassigns a Rider that already has an active linkage to a different existing and active Clinic, THE System SHALL replace the existing Rider-to-Clinic linkage with the new linkage such that exactly one active linkage remains for that Rider.
4. THE System SHALL expose Rider-to-Clinic assignment and reassignment only as an explicit manual Admin action, and SHALL NOT create or modify a Rider-to-Clinic linkage automatically.
5. IF an Admin attempts to assign a Rider to a Clinic that does not exist or is not active, THEN THE System SHALL reject the assignment, leave any existing Rider-to-Clinic linkage unchanged, and return an error indicating the Clinic is invalid or unavailable.

### Requirement 9: Rider Service-Area Constraint by Clinic

**User Story:** As an Admin, I want to assign a rider's service-area pincodes only after the rider has a clinic, and only from that clinic's pincodes, so that service areas remain consistent with clinic boundaries.

#### Acceptance Criteria

1. IF an Admin attempts to assign a Service_Area pincode to a Rider that has no linked Clinic, THEN THE System SHALL reject the assignment, leave the Rider's Service_Area unchanged, and return an error indicating that a Clinic must be linked to the Rider before any service-area pincode can be assigned.
2. WHILE a Rider is linked to a Clinic, THE System SHALL make available for assignment only those pincodes that belong to that Rider's linked Clinic, and SHALL exclude all pincodes not belonging to that Clinic from the selectable set.
3. IF an Admin attempts to assign a pincode that does not belong to the Rider's linked Clinic, THEN THE System SHALL reject the assignment, leave the Rider's existing Service_Area associations unchanged, and return an error indicating that the pincode lies outside the Rider's linked Clinic boundary.
4. IF a pincode is moved to a Clinic that a Rider mapping that pincode is not linked to, THEN THE System SHALL display a warning that identifies the affected Rider and the affected pincode and prompts the Admin to fix the Rider's Clinic linkage and remove the Rider's Service_Area association for that pincode.

### Requirement 10: Per-Clinic Routing Origin

**User Story:** As an Admin, I want routing computed per clinic, so that each clinic's riders pick up at their clinic and payouts originate from the clinic location.

#### Acceptance Criteria

1. THE Routing_Engine SHALL treat each Clinic as an independent routing scope using the Clinic's stored latitude and longitude as the route origin coordinate.
2. WHEN routing runs for a target date, THE Routing_Engine SHALL produce exactly one batch per active Rider within each Clinic scope, where an active Rider is a Rider whose status is active and who is assigned to that Clinic on the target date.
3. WHEN routing completes for a target date, THE Routing_Engine SHALL produce a total batch count equal to the sum of active Riders across all Clinics that have at least one routable order.
4. THE Routing_Engine SHALL compute rider payout as the sum of per-leg distances in kilometers, where each leg distance is the Haversine distance multiplied by the Haversine_Multiplier of 1.3, covering the leg from the Clinic location to the first stop and each leg between subsequent consecutive stops, multiplied by the Payout_Per_Km setting and rounded to 2 decimal places.
5. THE Routing_Engine SHALL preserve the existing `route_sequence` ordering within each batch such that stops are numbered as consecutive integers beginning at 1 in delivery order with no gaps or duplicate sequence values.
6. WHEN one Clinic scope produces zero routable orders or has zero active Riders, THE Routing_Engine SHALL skip that Clinic scope and continue routing the remaining Clinic scopes without raising an error.
7. IF a Clinic's latitude or longitude is missing or outside the valid range (latitude -90 to 90, longitude -180 to 180), THEN THE Routing_Engine SHALL skip that Clinic scope, continue routing the remaining Clinic scopes, and record an error indication identifying the skipped Clinic.
8. WHERE `FRANCHISE_FEATURES_ENABLED` is false, THE Routing_Engine SHALL route only Core Clinics and SHALL keep franchise-scoped routing paths intact and inactive.

### Requirement 11: Automation Pipeline Extension

**User Story:** As an Admin, I want the central automation pipeline to produce per-clinic workloads and snapshots, so that order creation, product linking, snapshotting, and routing run in sequence for all scopes.

#### Acceptance Criteria

1. WHEN the order-creation step runs at 5:15 PM IST after the 5:00 PM IST cutoff, THE Automation_Pipeline SHALL produce a preliminary per-Clinic meal workload for the next delivery day within 30 minutes of starting.
2. WHILE the 5:00 PM IST cutoff is in effect, IF a Customer attempts a meal-planner edit, an address change, or a pause for the next delivery day, THEN THE System SHALL reject the operation, return an error indication that the cutoff has passed, and leave the affected data unchanged.
3. WHEN the product-linking step runs at 12:05 AM IST, THE Automation_Pipeline SHALL capture all shop purchases recorded from 12:00 AM IST to 11:59 PM IST of the previous calendar day, such that a purchase recorded at 12:01 AM IST is attributed to the next day's run.
4. WHEN product linking completes, THE Automation_Pipeline SHALL produce exactly one finalized Workload_Snapshot per Clinic containing meal counts broken down by veg, non-veg, and egg, plus shop product counts, each recorded as a non-negative integer.
5. WHEN the finalized Workload_Snapshot is produced, THE Automation_Pipeline SHALL run routing within 60 seconds, using each Clinic as the routing origin.
6. THE Automation_Pipeline SHALL execute order creation, product linking, snapshotting, and routing in that sequential order as a single central pipeline for all scopes.
7. IF any pipeline step fails, THEN THE Automation_Pipeline SHALL halt the pipeline, retain the last successfully produced output, and record which step failed.
8. IF the order-creation step or the product-linking step fails, THEN THE Automation_Pipeline SHALL retry that step up to 3 times before halting.

### Requirement 12: Persisted Workload Snapshots

**User Story:** As a Master_Admin, I want finalized workload snapshots persisted, so that kitchen and clinic workload statistics are available day-wise, week-wise, and month-wise.

#### Acceptance Criteria

1. WHEN a Workload_Snapshot is finalized, THE System SHALL persist one record associated with exactly one Clinic, exactly one Kitchen, and one target date, recording veg meal count, non-veg meal count, and egg meal count each as an integer from 0 to 100,000, and a shop product count for each shop product as an integer from 0 to 100,000.
2. IF a finalize request targets a Clinic, Kitchen, and target date combination for which a Workload_Snapshot already exists, THEN THE System SHALL reject the duplicate persistence, retain the existing record unchanged, and return an error response indicating that a snapshot for that combination already exists.
3. THE System SHALL retain each persisted Workload_Snapshot record, including records whose target date has passed, for a minimum of 36 months from its target date.
4. WHEN a Master_Admin requests workload statistics for a date range whose start date is on or before its end date, THE System SHALL aggregate persisted Workload_Snapshot records whose target date falls within that range, grouped day-wise, week-wise, or month-wise as requested, per Clinic and per Kitchen.
5. IF a Master_Admin requests workload statistics for a date range whose start date is after its end date, THEN THE System SHALL reject the request and return an error response indicating the date range is invalid.
6. WHEN a Master_Admin requests workload statistics for a date range that contains no persisted Workload_Snapshot records, THE System SHALL return an empty result set with each meal count and shop product count reported as 0.
7. THE System SHALL use the finalized Workload_Snapshot for a given Clinic, Kitchen, and target date as the basis for the kitchen-to-clinic transport decision for that Clinic, Kitchen, and target date.

### Requirement 13: Workload View in Operations

**User Story:** As an Admin, I want a per-clinic and per-kitchen prep workload view with historical stats, so that I can plan tomorrow's preparation.

#### Acceptance Criteria

1. WHEN an authorized user opens the workload view within the admin Operations area, THE System SHALL present, as an extension of the existing Daily Meal Roster, the total count of meals to be prepared for the next calendar day broken down per Clinic and per Kitchen.
2. WHEN the workload view is opened, THE System SHALL present historical workload statistics derived from persisted Workload_Snapshot records covering the most recent 30 calendar days up to and including the current day.
3. IF no Workload_Snapshot records exist for the requested period or no meals are scheduled for the next calendar day, THEN THE System SHALL present the workload view with a zero-count state and an indication that no workload data is available for that period, without returning an error.
4. THE System SHALL grant access to the workload view, including its kitchen workload breakdown, only to users with the Admin role and users with the Master_Admin role.
5. IF a user holding a franchise admin role requests the workload view, THEN THE System SHALL deny access, withhold all clinic and kitchen workload data, and present an access-denied indication.

### Requirement 14: Master Clinic Management UI

**User Story:** As a Master_Admin, I want a "Core Clinic Management" card in the master portal, so that I can create, edit, and delete clinics, kitchens, and cities.

#### Acceptance Criteria

1. THE System SHALL present a "Core Clinic Management" card within the master portal `/system` area.
2. WHEN a Master_Admin submits a new Clinic, THE System SHALL require a clinic name of 1 to 200 characters, a non-empty full address of 1 to 500 characters, a latitude between -90 and 90 (inclusive), and a longitude between -180 and 180 (inclusive), and SHALL persist the Clinic record only when all four values are present and within these bounds.
3. IF a Master_Admin submits a Clinic create or edit request with a missing name, a missing or empty address, a missing latitude or longitude, or a latitude or longitude outside the allowed bounds, THEN THE System SHALL reject the request, retain any previously stored values unchanged, and display an error message indicating which field is missing or out of range.
4. WHEN a Master_Admin submits edits to an existing Clinic, THE System SHALL update that Clinic's name, address, latitude, and longitude with the submitted values after applying the same validation defined in criteria 2 and 3.
5. WHEN a Master_Admin requests deletion of a Clinic, Kitchen, or City that has no dependent records referencing it, THE System SHALL delete that record.
6. IF a Master_Admin requests deletion of a Clinic, Kitchen, or City that is referenced by one or more dependent records, THEN THE System SHALL reject the deletion, retain the record unchanged, and display an error message indicating that dependent records prevent deletion.
7. WHEN a Master_Admin submits a create or edit for a Kitchen or a City, THE System SHALL persist the submitted Kitchen or City record to maintain the clinic hierarchy.

### Requirement 15: Data Migration and Seed (Madhapur Clinic)

**User Story:** As a Master_Admin, I want a temporary seed clinic created from the existing kitchen, so that existing customers, riders, and pincodes are migrated without orphaning any records.

#### Acceptance Criteria

1. WHEN the migration script runs, THE System SHALL create exactly one Madhapur_Clinic using the existing central kitchen's address, latitude, and longitude copied verbatim as placeholder values.
2. WHEN the migration script runs, THE System SHALL associate the Madhapur_Clinic with the existing central kitchen via `kitchen_id`.
3. WHEN the migration script runs, THE System SHALL stamp every existing Customer's `clinic_id` to reference the Madhapur_Clinic.
4. WHEN the migration script runs, THE System SHALL link every existing Rider to the Madhapur_Clinic.
5. WHEN the migration script runs, THE System SHALL associate every existing Service_Area pincode with the Madhapur_Clinic.
6. WHEN the migration completes, THE System SHALL leave zero existing Customer, Rider, or Service_Area records with a null or unset Clinic association.
7. IF the migration script is run more than once, THEN THE System SHALL ensure exactly one Madhapur_Clinic exists and SHALL create no duplicate Clinic associations (idempotent execution).
8. IF the migration fails partway through, THEN THE System SHALL roll back all changes transactionally so that no partial migration persists, and surface an error indication.
9. THE System SHALL allow the Master_Admin to edit the Madhapur_Clinic details and create additional Core Clinics after migration.
10. THE System SHALL deliver migration logic as additive SQL scripts in `/scripts` following the established additive pattern and respecting Supabase Row Level Security.

### Requirement 16: Clinic Visibility and Filters in Admin Portal

**User Story:** As an Admin, I want to see clinic associations and filter tables by clinic, so that I can understand and manage which clinic each rider and customer belongs to.

#### Acceptance Criteria

1. THE System SHALL display a "Clinic" column in the Rider List submenu showing the name of the Clinic each Rider is linked to.
2. THE System SHALL display a "Clinic" column in the Rider Activity (Today's Activity) submenu showing the name of the Clinic each Rider is linked to.
3. IF a Rider or Customer is not linked to any Clinic, THEN THE System SHALL display a placeholder indicating no linked Clinic (for example "—" or "Unassigned") in the Clinic column or field instead of leaving it blank.
4. THE System SHALL provide a Clinic filter control on the title bar of each data table that displays Rider or Customer records, populated with the list of available Clinics plus an "All Clinics" option.
5. WHEN an Admin selects a specific Clinic in the Clinic filter control, THE System SHALL display only the rows whose linked Clinic matches the selected Clinic.
6. WHEN an Admin selects the "All Clinics" option or clears the Clinic filter, THE System SHALL display all rows regardless of linked Clinic.
7. WHERE Rider or Customer data is displayed, THE System SHALL show the name of the Clinic the Rider or Customer is linked to.

### Requirement 17: Clinic-Selector-First Operational Views

**User Story:** As an Admin, I want clinic-selector-first behavior in routing and tracking views, so that I work within one clinic's riders at a time.

#### Acceptance Criteria

1. WHILE no Clinic has been selected in the Live Routing Board, THE System SHALL display the Clinic selector as the only operational content and SHALL NOT display any Rider, route, or tracking data.
2. WHEN an Admin selects a Clinic in the Live Routing Board, THE System SHALL display only Riders assigned to that selected Clinic and SHALL exclude all Riders belonging to other Clinics.
3. WHILE no Clinic has been selected in Live Tracking, THE System SHALL display the Clinic selector as the only operational content and SHALL NOT display any Rider or tracking data.
4. WHEN an Admin selects a Clinic in Live Tracking, THE System SHALL display only Riders assigned to that selected Clinic and SHALL exclude all Riders belonging to other Clinics.
5. WHILE no Clinic has been selected in the operations Sandbox, THE System SHALL display the Clinic selector as the only operational content and SHALL NOT display any Rider data.
6. WHEN an Admin selects a Clinic in the Sandbox, THE System SHALL display only Riders assigned to that selected Clinic and SHALL exclude all Riders belonging to other Clinics.
7. WHEN an Admin changes the selected Clinic in the Live Routing Board, Live Tracking, or Sandbox, THE System SHALL replace the currently displayed Riders with only the newly selected Clinic's Riders within 3 seconds and SHALL NOT retain any previously selected Clinic's Riders in the view.
8. IF an Admin selects a Clinic that has zero assigned Riders in the Live Routing Board, Live Tracking, or Sandbox, THEN THE System SHALL display an empty-state indication that the Clinic has no Riders and SHALL display no Rider rows or markers.
9. THE System SHALL restrict the Clinic selector in the Live Routing Board, Live Tracking, and Sandbox to only the Clinics the authenticated Admin is authorized to access.

### Requirement 18: Franchise Readiness Without Franchise Behavior

**User Story:** As a developer, I want the clinic model to be franchise-ready without activating franchise behavior, so that later specs can wire franchises without reworking the core model.

#### Acceptance Criteria

1. THE System SHALL provide a nullable `clinics.franchise_id` column where a `NULL` value denotes a Core Clinic and a non-`NULL` value denotes a franchise-owned clinic.
2. WHEN the `clinics.franchise_id` column is introduced, THE System SHALL set `franchise_id` to `NULL` for every pre-existing clinic record so that all existing clinics resolve as Core Clinics.
3. WHERE `FRANCHISE_FEATURES_ENABLED` is false, THE System SHALL retain all franchise-gated code paths in the codebase so that they compile and deploy without removal, while producing no franchise-specific reads, writes, or side effects at runtime.
4. WHERE `FRANCHISE_FEATURES_ENABLED` is unset, THE System SHALL treat its value as false.
5. THE System SHALL NOT implement franchise-to-clinic wiring, franchise warehouse behavior, or scope-based access control within this feature.
6. WHILE `FRANCHISE_FEATURES_ENABLED` is false, THE System SHALL produce Routing_Engine results and customer assignment outcomes identical to those produced before the `clinics.franchise_id` column was introduced, given the same inputs.

### Requirement 19: Order-Level Clinic Stamping and Historical Immutability

**User Story:** As an Admin, I want each delivery order and delivery batch to record the clinic that served it at creation time, so that per-clinic workload and history stay accurate even after customers move between clinics.

**User Story:** As a Master_Admin, I want clinic-attributed delivery history to remain stable over time, so that historical reporting reflects the clinic that actually served each order rather than a customer's current clinic.

#### Acceptance Criteria

1. THE System SHALL persist a nullable `clinic_id` column on each Delivery_Order in `delivery_orders` and a nullable `clinic_id` column on each Delivery_Batch in `delivery_batches`.
2. WHEN a Delivery_Order is created and that Customer's delivery address resolves to exactly one Clinic at creation time, THE System SHALL set the Delivery_Order `clinic_id` to that single resolved Clinic exactly once, recording the value as the Order_Clinic_Stamp.
3. WHEN a Delivery_Batch is created during routing, THE System SHALL set the Delivery_Batch `clinic_id` exactly once to the Rider's linked Clinic at routing time, recording the value as the Order_Clinic_Stamp.
4. WHILE a Delivery_Order or Delivery_Batch exists with an assigned `clinic_id`, THE System SHALL treat that `clinic_id` as immutable, such that a Customer Clinic change, a pincode move, or a Customer auto-reassignment SHALL leave the `clinic_id` of every already-created Delivery_Order and Delivery_Batch unchanged.
5. IF an operation attempts to modify the `clinic_id` of an existing Delivery_Order or Delivery_Batch, THEN THE System SHALL reject the operation, retain the original stamped `clinic_id` value unchanged, and return an error indicating that the Order_Clinic_Stamp is immutable.
6. WHEN per-Clinic Workload_Snapshots and per-Clinic routing and delivery history are computed, THE System SHALL derive them from the Delivery_Order Order_Clinic_Stamp rather than from the Customer's current `clinic_id`.
7. WHEN a Customer is later moved to a different Clinic, THE System SHALL retain that Customer's prior Delivery_Orders under the Clinic recorded in each order's Order_Clinic_Stamp at the time those orders were created.
8. IF a Delivery_Order is created for a Customer whose delivery address does not resolve to any Clinic at creation time, THEN THE System SHALL leave the Delivery_Order `clinic_id` null, consistent with the customer stamping rules in Requirement 6, and SHALL NOT block order creation solely due to the unresolved Clinic.
9. IF a Delivery_Batch is created during routing for a Rider with no linked Clinic at routing time, THEN THE System SHALL leave the Delivery_Batch `clinic_id` null and SHALL NOT block batch creation solely due to the unresolved Clinic.
