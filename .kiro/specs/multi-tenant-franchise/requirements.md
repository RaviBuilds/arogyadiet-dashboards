# Requirements Document

## Introduction

This document defines the requirements for evolving ArogyaDiet from a single-location meal-delivery business into a multi-tenant Franchise SaaS platform. The platform follows a **"Single Codebase · Shared Database · Isolated Data"** model: every franchise runs the same application against one shared PostgreSQL (Supabase) database, while each franchise can only ever access its own slice of the operational data.

This spec is the franchise-hierarchy continuation that the completed `core-clinic-architecture` spec explicitly deferred. Core-clinic established the **Business → Kitchen → Clinic** model for the CORE operation (Business typed `Core` or `Franchise`, geo moved off Kitchen onto Clinic, one-pincode-one-clinic, automatic customer→clinic stamping by Primary_Address). This spec implements the franchise side of that model as the full multi-level hierarchy:

**Business (type `Franchise`) → City → Group → Kitchen → Franchise → Clinic**

Two architectural principles govern this transition and supersede the earlier "flat franchise registry with a single kitchen anchor that carries geo" framing, which is now stale:

1. **The existing Hyderabad Core_Operation remains the parent/base and is NOT converted into a franchise.** It continues to operate exactly as it does today through `admin.arogyadiet.com` — unchanged, unmigrated, and without a `franchise_id` stamp on its data. Core records keep `NULL` `franchise_id` or a designated core marker. The franchise expansion is strictly additive.
2. **Geo lives on the Clinic, never on the Kitchen.** A Kitchen is a meal-preparation and workload-aggregation entity with no address, latitude, or longitude. The rider pickup origin and routing origin geo coordinates are stored only on the Clinic, consistent with `core-clinic-architecture`.

All franchise-specific behavior remains gated behind the existing `FRANCHISE_FEATURES_ENABLED` flag. The Core (Hyderabad) operation is never modified or migrated by this spec.

## Glossary

- **Platform**: The complete ArogyaDiet multi-tenant application (single codebase) serving all portals.
- **Core_Operation**: The existing Hyderabad base operation that remains the parent/base of the platform. Core records carry no `franchise_id` (`NULL`) or a designated core marker. The Core_Operation is NOT a franchise and is NOT migrated by this spec.
- **Core_Record**: Any operational data record belonging to the Core_Operation (existing Hyderabad data). These records have `NULL` `franchise_id` (or a designated core marker) and are NOT tenant-isolated.
- **Business**: The top-level entity (introduced by `core-clinic-architecture`) typed `Core` or `Franchise`. Franchise operations hang under a Business whose type is `Franchise`.
- **Franchise_Business**: A Business whose type is `Franchise`. It owns the franchise-side City → Group → Kitchen → Franchise → Clinic hierarchy.
- **City**: A geographic grouping of franchise operations that belongs to a Franchise_Business. A City contains zero or more Groups. (Reuses the existing City entity from `core-clinic-architecture`.)
- **Group**: A grouping within a City that owns **exactly one Kitchen** and contains zero or more Franchises. A City has many Groups, hence many Kitchens (one Kitchen per Group).
- **Kitchen**: A meal-preparation and workload-aggregation entity owned by exactly one Group. A Kitchen carries **NO** street address, latitude, or longitude. (Reuses the existing `kitchens` entity, repurposed by `core-clinic-architecture`.)
- **Franchise**: A NEW independent operating location belonging to exactly one Group, identified by a unique `franchise_id`. A Franchise holds its own customers, riders, inventory, and orders, and wires to one or more Clinics. The Core_Operation is explicitly excluded from this definition.
- **Clinic**: The rider pickup origin and geographic routing origin. A Clinic carries the full address plus latitude and longitude. A franchise Clinic is wired to exactly one Franchise. (Reuses the Clinic entity from `core-clinic-architecture`, where `clinics.franchise_id` is `NULL` for Core Clinics and non-null for franchise Clinics.)
- **Hierarchy**: The franchise structure Business(`Franchise`) → City → Group → Kitchen → Franchise → Clinic.
- **Inter_Group_Move**: The relocation of a Franchise from one Group to another Group **within the same City**.
- **Agreement_Document**: An onboarding/agreement file uploaded for a Franchise and stored in the private Supabase Storage bucket named `franchise-documents`.
- **Document_Store**: The component responsible for upload, listing, replacement, and access control of Agreement_Documents in the `franchise-documents` private bucket.
- **Tenant_Isolated_Record**: Any operational data record belonging to a Franchise, carrying a non-null `franchise_id` stamp.
- **Global_Table**: A platform-wide shared table identical for every Franchise and the Core_Operation (`system_settings`, `roles`, `subscription_plans`, `meal_categories`, `holidays`, `products`).
- **Franchise_Admin**: A user with the `FRANCHISE_ADMIN` role who operates a single Franchise's dashboard at `franchies.arogyadiet.com`. Their identity carries the `franchise_id` of the Franchise they belong to.
- **Core_Admin**: A user with the `ADMIN` role who operates the Core_Operation through `admin.arogyadiet.com` and has oversight of both Hyderabad data AND all Franchise data.
- **Master_Admin**: A user with the `MASTER_ADMIN` role who operates above all boundaries with full cross-franchise and core visibility, plus management of the entire Hierarchy.
- **Franchise_User**: Any user belonging to one Franchise (`FRANCHISE_ADMIN`, or the Franchise's riders and customers) whose access is scoped to that Franchise's `franchise_id`. Does NOT include Core_Operation users.
- **Scope**: The access boundary derived from a user's role and `franchise_id` that determines which records, portals, and actions the user may reach.
- **Scope_Resolver**: The component that resolves a requesting user's Scope (Core_Operation, a single Franchise, or full network) for access-control enforcement.
- **RLS_Layer**: The PostgreSQL Row Level Security enforcement layer that restricts row access based on the requester's identity, role, and `franchise_id`.
- **Assignment_Resolver**: The component that resolves a customer's Primary_Address pincode to either the Core_Operation or exactly one servicing franchise Clinic at signup, reusing the `core-clinic-architecture` stamping flow.
- **Primary_Address**: The customer's designated primary (default) address whose pincode determines the customer's clinic/franchise association, per `core-clinic-architecture`.
- **Routing_Middleware**: The subdomain-based middleware that detects the portal (`franchies.arogyadiet.com`, `admin.arogyadiet.com`, `master.arogyadiet.com`) and routes the request after verifying role and Scope.
- **Shared_Component_Layer**: The portal-agnostic, RBAC-aware operational component library (`src/shared/components`) powering the Admin, Master, and Franchise dashboards.
- **Master_Dashboard**: The head-office command center showing consolidated cross-franchise and core data, plus full Hierarchy management controls. Served under `src/app/master/`.
- **Franchise_Dashboard**: The local operating dashboard scoped to a single Franchise, served at `franchies.arogyadiet.com`.
- **Admin_Dashboard**: The existing Core_Operation dashboard at `admin.arogyadiet.com`, which continues to manage Hyderabad operations AND provides oversight of all Franchise data.
- **Franchise_Warehouse**: A Franchise-scoped inventory store holding stock owned by that Franchise.
- **Stock_Transfer**: A relocation of inventory stock from a source store (Core_Operation warehouse or a Franchise_Warehouse) to a destination Franchise_Warehouse.
- **Waitlist_State**: A head-office "unassigned" holding state for customers whose Primary_Address pincode matches neither the Core_Operation nor any active Franchise Clinic.
- **FRANCHISE_FEATURES_ENABLED**: The existing feature flag gating all franchise-specific behavior. While false, the Core_Operation behaves exactly as today and no franchise runtime paths activate.

## Requirements

### Requirement 1: City Management Under a Franchise Business

**User Story:** As a Master_Admin, I want to create and manage Cities under a Franchise_Business, so that franchise operations are organized into a clean geographic level above Groups.

#### Acceptance Criteria

1. THE Platform SHALL associate each franchise City with exactly one Business whose type is `Franchise`.
2. WHEN the Master_Admin creates a City under a Franchise_Business with a name that is non-empty, 1 to 100 characters, and not already used (case-insensitively) by another City under the same Business, THE Platform SHALL persist the City and return its unique identifier.
3. IF the Master_Admin submits a City with a name that is empty, exceeds 100 characters, duplicates (case-insensitively) an existing City name under the same Business, or references a Business that does not exist or whose type is not `Franchise`, THEN THE Platform SHALL reject the operation, persist no changes, and return an error indicating the specific validation failure.
4. WHEN the Master_Admin deletes a City that contains zero Groups, THE Platform SHALL delete the City record.
5. IF the Master_Admin attempts to delete a City that contains at least one Group, THEN THE Platform SHALL reject the deletion, retain the City and its associations unchanged, and return an error indicating the City has associated Groups.
6. WHERE `FRANCHISE_FEATURES_ENABLED` is false, THE Platform SHALL keep franchise City management inactive and SHALL NOT alter any Core_Operation behavior.

### Requirement 2: Group Management With Exactly One Kitchen Per Group

**User Story:** As a Master_Admin, I want each Group to own exactly one Kitchen within a City, so that meal preparation and workload aggregation are organized one kitchen per group.

#### Acceptance Criteria

1. THE Platform SHALL associate each Group with exactly one City.
2. THE Platform SHALL associate each Group with exactly one Kitchen, and SHALL associate each Kitchen owned by a Group with exactly that one Group (a one-to-one Group-to-Kitchen relationship).
3. WHEN the Master_Admin creates a Group within a City with a name that is non-empty and 1 to 100 characters, THE Platform SHALL create the Group together with exactly one owned Kitchen and return the Group identifier.
4. THE Platform SHALL allow a City to contain more than one Group, with no upper limit, such that a City may contain many Kitchens with exactly one Kitchen per Group.
5. THE Platform SHALL NOT store a street address, a latitude, or a longitude on a Group's Kitchen; the full address and geo coordinates SHALL be stored only on the Clinic, consistent with `core-clinic-architecture`.
6. IF the Master_Admin attempts to create a Group with a name that is empty or exceeds 100 characters, references a City that does not exist, or attempts to associate a second Kitchen with an existing Group, THEN THE Platform SHALL reject the operation, persist no changes, and return an error indicating the specific validation failure.
7. WHEN the Master_Admin deletes a Group that contains zero Franchises, THE Platform SHALL delete the Group and its single owned Kitchen.
8. IF the Master_Admin attempts to delete a Group that contains at least one Franchise, THEN THE Platform SHALL reject the deletion, retain the Group and its associations unchanged, and return an error indicating the Group has associated Franchises.

### Requirement 3: Franchise Registry Under a Group

**User Story:** As a Master_Admin, I want a franchise registry where each Franchise belongs to exactly one Group, so that every new operating location has a distinct identity, status, and place in the Hierarchy.

#### Acceptance Criteria

1. THE Platform SHALL maintain a `franchises` record for each NEW Franchise containing a unique identifier, a name of 1 to 100 characters that is unique across all `franchises` records, an operational status, and a reference to exactly one existing Group.
2. THE Platform SHALL NOT contain a `franchises` record for the Core_Operation; the Core_Operation exists outside the franchise registry.
3. THE Platform SHALL restrict the operational status of each Franchise to exactly one of the values `active`, `onboarding`, or `suspended`.
4. THE Platform SHALL resolve each Franchise's City, Kitchen, and Business through its Group (Franchise → Group → City and Franchise → Group → Kitchen and City → Franchise_Business).
5. WHEN the Master_Admin creates a Franchise with a name of 1 to 100 characters not already used by another Franchise and a reference to an existing Group, THE Platform SHALL persist the Franchise with status `onboarding`.
6. IF the Master_Admin attempts to create or update a Franchise with a name that is empty, exceeds 100 characters, or duplicates another Franchise's name, with a Group reference that does not identify an existing Group, or with an operational status outside the set {`active`, `onboarding`, `suspended`}, THEN THE Platform SHALL reject the operation, return an error indicating the specific validation failure, and persist no changes to the `franchises` record.

### Requirement 4: Franchise Onboarding and Lifecycle Control

**User Story:** As a Master_Admin, I want to create, configure, and change the status of Franchises, so that I can launch, pause, and reinstate locations without engineering work.

#### Acceptance Criteria

1. WHEN the Master_Admin creates a Franchise, THE Platform SHALL require assignment of exactly one Franchise_Admin owner to that Franchise.
2. IF the Master_Admin attempts to create a Franchise without assigning exactly one Franchise_Admin owner, THEN THE Platform SHALL reject the creation, persist no Franchise record, and return an error indicating the missing owner.
3. WHEN the Master_Admin activates a Franchise that is not already active, THE Platform SHALL set the Franchise status to `active` within 5 seconds.
4. WHEN the Master_Admin suspends a Franchise that is not already suspended, THE Platform SHALL set the Franchise status to `suspended` within 5 seconds.
5. WHILE a Franchise has status `suspended`, THE Platform SHALL deny all dashboard operations to that Franchise's Franchise_Admin and present an indication that the Franchise is suspended.
6. WHILE a Franchise has status `suspended`, THE Platform SHALL retain that Franchise's historical records without modification and keep them visible to the Core_Admin and Master_Admin.
7. WHEN the Master_Admin reactivates a suspended Franchise, THE Platform SHALL set the Franchise status to `active` within 5 seconds and restore dashboard operation to that Franchise's Franchise_Admin.
8. IF the Master_Admin attempts to activate a Franchise that is already active or suspend a Franchise that is already suspended, THEN THE Platform SHALL reject the request, leave the Franchise status unchanged, and return an error indicating the invalid status transition.

### Requirement 5: Inter-Group Move Within a City

**User Story:** As a Master_Admin, I want to move a Franchise from one Group to another Group within the same City, so that I can reorganize franchise operations without recreating the Franchise.

#### Acceptance Criteria

1. WHEN the Master_Admin moves a Franchise from a source Group to a destination Group that belongs to the same City as the source Group, THE Platform SHALL atomically update the Franchise's Group reference to the destination Group such that on success the Franchise belongs only to the destination Group and on failure the Franchise remains only in the source Group.
2. IF the Master_Admin attempts to move a Franchise to a destination Group that belongs to a different City than the source Group, THEN THE Platform SHALL reject the move, leave the Franchise's Group reference unchanged, and return an error indicating that inter-group moves are permitted only within the same City.
3. IF the Master_Admin attempts to move a Franchise to a destination Group that does not exist, THEN THE Platform SHALL reject the move, leave the Franchise's Group reference unchanged, and return an error indicating the destination Group was not found.
4. WHEN a Franchise is moved between Groups, THE Platform SHALL re-resolve the Franchise's Kitchen through its new Group (Franchise → Group → Kitchen) and surface any cascade implications of the new Kitchen association to the Master_Admin before the move is confirmed.
5. WHEN an Inter_Group_Move completes, THE Platform SHALL preserve the Franchise's `franchise_id`, its tenant-isolated data, its Clinic wiring, and its served pincodes unchanged.

### Requirement 6: Franchise-to-Clinic Wiring

**User Story:** As a Master_Admin, I want to wire a Franchise to its Clinic(s), so that the Franchise has a defined rider pickup and routing origin that carries the geo coordinates.

#### Acceptance Criteria

1. THE Platform SHALL associate each Franchise with one or more Clinics, where each franchise Clinic carries a non-null `franchise_id` equal to that Franchise's identifier.
2. THE Platform SHALL store the full address, latitude, and longitude on each franchise Clinic and SHALL NOT store any address or geo coordinates on the Franchise's Kitchen.
3. THE Platform SHALL resolve each franchise Clinic's Kitchen as the single Kitchen owned by the Franchise's Group (Clinic → Franchise → Group → Kitchen).
4. WHEN the Master_Admin wires a Clinic to a Franchise with a non-empty name, a non-empty full address, a latitude in the range -90.0 to 90.0 inclusive, and a longitude in the range -180.0 to 180.0 inclusive, THE Platform SHALL persist the franchise Clinic with `franchise_id` set to that Franchise.
5. IF the Master_Admin attempts to wire a Clinic to a Franchise with a missing or out-of-range latitude or longitude, a missing name, or a missing full address, THEN THE Platform SHALL reject the operation, persist no Clinic record, and return an error indicating the offending field.
6. THE Routing_Middleware and routing engine SHALL use the franchise Clinic location, and never the Kitchen, as the rider pickup and routing origin for that Franchise.

### Requirement 7: Franchise Agreement Document Management

**User Story:** As a Master_Admin, I want to upload and manage each Franchise's agreement documents in a private store, so that onboarding paperwork is retained securely and access is controlled.

#### Acceptance Criteria

1. THE Document_Store SHALL store every Agreement_Document in the private Supabase Storage bucket named `franchise-documents`, associated with exactly one Franchise's `franchise_id`.
2. WHEN the Master_Admin uploads an Agreement_Document for a Franchise, THE Document_Store SHALL persist the file under that Franchise's `franchise_id` namespace and record its metadata (file name, content type, size, and upload timestamp).
3. WHEN the Master_Admin requests the Agreement_Documents for a Franchise, THE Document_Store SHALL return the list of that Franchise's documents and SHALL exclude documents belonging to any other Franchise.
4. WHEN the Master_Admin replaces an existing Agreement_Document for a Franchise, THE Document_Store SHALL store the new file and retain the association with that Franchise's `franchise_id`.
5. THE Document_Store SHALL grant read access to a Franchise's Agreement_Documents only to the Master_Admin, the Core_Admin, and the Franchise_Admin whose `franchise_id` matches the document's `franchise_id`.
6. IF any user other than the Master_Admin, the Core_Admin, or the owning Franchise_Admin requests an Agreement_Document, THEN THE Document_Store SHALL deny access and return a response indicating the access is not permitted, without disclosing the document's existence.
7. THE Document_Store SHALL serve Agreement_Documents only through time-limited signed access and SHALL NOT expose any Agreement_Document through a public URL.
8. THE Document_Store SHALL restrict uploads to the permitted content types `application/pdf`, `image/jpeg`, and `image/png`, and to a maximum file size of 10 MB (10,485,760 bytes).
9. IF an upload is attempted with a file whose content type is outside the permitted set {`application/pdf`, `image/jpeg`, `image/png`} or whose size exceeds 10 MB, THEN THE Document_Store SHALL reject the upload, persist no file, and return an error indicating the invalid file type or size.

### Requirement 8: Franchise Identity Association

**User Story:** As a Master_Admin, I want every franchise staff member linked to their Franchise, so that the Platform can scope their access correctly.

#### Acceptance Criteria

1. THE Platform SHALL record exactly one `franchise_id` association, referencing an existing `franchises` record, for each Franchise_User on the existing `users` identity record.
2. WHERE a user holds the `MASTER_ADMIN` or `ADMIN` (Core_Admin) role, THE Platform SHALL associate that user with no single `franchise_id` and SHALL permit that user access spanning all Franchises and the Core_Operation.
3. WHEN a Franchise_Admin authenticates successfully, THE Platform SHALL resolve the single `franchise_id` carried by that user's identity and make that `franchise_id` available for access scoping for the duration of the authenticated session.
4. IF a Franchise_Admin authenticates and no `franchise_id` is associated with that user's identity, THEN THE Platform SHALL deny dashboard access, SHALL NOT grant any franchise-scoped access, and SHALL present an error indicating the missing franchise association.
5. WHERE a user belongs to the Core_Operation (riders, customers, admin staff with `ADMIN` role), THE Platform SHALL NOT require a `franchise_id` association and SHALL permit that user to operate under the Core_Operation context.

### Requirement 9: Franchise Tenant Data Stamping

**User Story:** As a platform owner, I want every franchise operational record tagged with its owning Franchise, so that franchise data ownership is unambiguous and isolated from the Core_Operation.

#### Acceptance Criteria

1. THE Platform SHALL store a non-null `franchise_id` reference on every Tenant_Isolated_Record created by a Franchise, where the value matches the `franchise_id` of an existing Franchise.
2. WHEN a Franchise_User creates a Tenant_Isolated_Record, THE Platform SHALL stamp the record with that requesting user's own `franchise_id`, ignoring any `franchise_id` value supplied in the request payload.
3. IF a request from a Franchise_User attempts to create a Tenant_Isolated_Record under a `franchise_id` other than the requesting Franchise_User's own `franchise_id`, THEN THE Platform SHALL reject the write without persisting any record and return a response indicating the franchise ownership violation.
4. IF a request from a Franchise_User attempts to create a Tenant_Isolated_Record with a missing, null, or empty `franchise_id` that cannot be resolved from the requesting Franchise_User, THEN THE Platform SHALL reject the write without persisting any record and return a response indicating the missing franchise reference.
5. IF the requesting Franchise_User's resolved `franchise_id` does not match an existing Franchise, THEN THE Platform SHALL reject the write without persisting any record and return a response indicating the invalid franchise reference.
6. THE Platform SHALL NOT stamp Core_Operation records (existing Hyderabad data) with a `franchise_id`; Core_Records SHALL have `NULL` `franchise_id` or a designated core marker value.
7. WHEN a Core_Admin or Core_Operation user creates a record, THE Platform SHALL persist the record with `NULL` `franchise_id` (or the designated core marker), following the same behavior as the system operates today.

### Requirement 10: Tenant Data Isolation

**User Story:** As a franchise owner, I want my data invisible to other Franchises and to the Core_Operation's regular users, so that my customers, revenue, and operations remain private.

#### Acceptance Criteria

1. WHEN a Franchise_User reads a Tenant_Isolated_Record, THE RLS_Layer SHALL return the record only if its `franchise_id` equals the requesting user's `franchise_id`.
2. WHEN a Franchise_User attempts to modify or delete a Tenant_Isolated_Record whose `franchise_id` differs from the requesting user's `franchise_id`, THE RLS_Layer SHALL deny the operation, leave the stored record unchanged, and return a response indicating the operation is not permitted.
3. IF a Franchise_User requests a Tenant_Isolated_Record belonging to another Franchise, THEN THE RLS_Layer SHALL return a result indistinguishable from that of a non-existent record and SHALL NOT disclose the existence of the record.
4. WHEN a Franchise_User issues a list or aggregate query over a tenant-isolated table, THE RLS_Layer SHALL exclude records whose `franchise_id` differs from the requesting user's `franchise_id` from both the returned rows and any aggregate computation.
5. IF a Franchise_User attempts to create a Tenant_Isolated_Record with a `franchise_id` other than the requesting user's `franchise_id`, THEN THE RLS_Layer SHALL deny the operation and persist no record.
6. IF the requesting Franchise_User has a null, empty, or unresolved `franchise_id`, THEN THE RLS_Layer SHALL deny all access to tenant-isolated records.
7. THE RLS_Layer SHALL enforce isolation across every tenant-isolated table for read, list, create, modify, and delete operations, regardless of the query interface used.
8. WHEN a Franchise_User queries data, THE RLS_Layer SHALL exclude all Core_Records (records with `NULL` `franchise_id` or core marker) from the results.

### Requirement 11: Core and Master Cross-Franchise Access

**User Story:** As a Core_Admin or Master_Admin, I want full visibility across core operations and all Franchises, so that I can oversee consolidated performance and manage the entire network.

#### Acceptance Criteria

1. WHEN a Core_Admin or Master_Admin reads data, THE RLS_Layer SHALL return both Core_Records (`NULL` `franchise_id`) AND Tenant_Isolated_Records across all Franchises.
2. IF a user who does not hold the `MASTER_ADMIN` or `ADMIN` role attempts a cross-franchise or cross-core read, THEN THE RLS_Layer SHALL restrict the result to that user's assigned Franchise only.
3. THE Admin_Dashboard SHALL present Core_Operation data (Hyderabad customers, riders, inventory, orders) as the primary view, consistent with how it operates today, without requiring any franchise-selection step.
4. THE Admin_Dashboard SHALL additionally provide franchise oversight capabilities allowing the Core_Admin to view and manage Franchise data across all Franchises.
5. THE Master_Dashboard SHALL present consolidated revenue across the Core_Operation and all Franchises for a selectable reporting period that defaults to the current calendar month.
6. WHEN the Core_Admin or Master_Admin selects a single Franchise to drill down, THE dashboard SHALL re-scope the displayed revenue and operations metrics to that selected Franchise.
7. THE Master_Dashboard SHALL present network operations health within the selected reporting period, including active subscription count, completed versus scheduled delivery counts, and active rider count, rolled up across the Core_Operation and all Franchises.
8. WHEN no operational data exists for the selected reporting period, THE dashboard SHALL present zero values for the affected metrics.
9. IF the dashboard fails to load any metric, THEN THE dashboard SHALL present an error indication for that metric without blocking the remaining metrics.

### Requirement 12: Master Dashboard Hierarchy Management

**User Story:** As a Master_Admin, I want to create and manage the full City → Group → Kitchen → Franchise → Clinic hierarchy from the Master portal, so that I manage franchise structure visually rather than through the old flat franchise list.

#### Acceptance Criteria

1. THE Master_Dashboard SHALL present the franchise structure as the Hierarchy Business(`Franchise`) → City → Group → Kitchen → Franchise → Clinic and SHALL NOT present the deprecated flat franchise-with-kitchen-anchor model.
2. THE Master_Dashboard SHALL allow the Master_Admin to create, edit, and delete Cities, Groups, Franchises, and franchise Clinics, subject to the validation rules in Requirements 1 through 6.
3. WHEN the Master_Admin views a City, THE Master_Dashboard SHALL display that City's Groups, and for each Group its single Kitchen and its Franchises with each Franchise's wired Clinics.
4. THE Master_Dashboard SHALL provide the Inter_Group_Move action for a Franchise, constrained to destination Groups within the same City per Requirement 5.
5. THE Master_Dashboard SHALL provide the Agreement_Document upload, list, and replace actions for a Franchise per Requirement 7.
6. WHERE a viewer does not hold the `MASTER_ADMIN` role, THE Master_Dashboard SHALL deny access to the Hierarchy management controls and SHALL expose no franchise structure data.

### Requirement 13: Global Table Consistency

**User Story:** As a platform owner, I want shared configuration centralized, so that the brand experience is consistent and controlled by head office.

#### Acceptance Criteria

1. WHEN any Franchise or the Core_Operation requests a Global_Table, THE Platform SHALL return Global_Table data that is byte-for-byte identical to the data returned to every other Franchise and to the Core_Operation for the same Global_Table.
2. WHEN a Core_Admin or Master_Admin submits a modification to a Global_Table, THE Platform SHALL persist the change and make the updated data available to all Franchises and the Core_Operation within 5 seconds of successful persistence.
3. IF persistence of a modification to a Global_Table fails, THEN THE Platform SHALL reject the modification, retain the previously persisted Global_Table data unchanged for all Franchises and the Core_Operation, and return an error response indicating the modification was not saved.
4. IF a Franchise_User attempts to modify a Global_Table, THEN THE Platform SHALL reject the modification, leave the existing Global_Table data unchanged, and return an error response indicating that modification is not permitted.
5. WHEN a Franchise_User reads a Global_Table, THE Platform SHALL return the current shared Global_Table data as last persisted by a Core_Admin or Master_Admin.

### Requirement 14: Pincode-to-Clinic Assignment

**User Story:** As a customer, I want to be served by the correct operation covering my area, so that my orders are fulfilled by the correct local clinic — whether that is the Core_Operation or a Franchise.

#### Acceptance Criteria

1. WHEN a customer signs up and the customer's Primary_Address pincode resolves to exactly one franchise Clinic whose Franchise is active, THE Assignment_Resolver SHALL stamp that customer with the corresponding `clinic_id` and the Clinic's `franchise_id` before the signup is marked complete, reusing the `core-clinic-architecture` stamping flow.
2. WHEN a customer signs up and the Primary_Address pincode resolves to a Core_Operation Clinic, THE Assignment_Resolver SHALL stamp the customer with the Core Clinic's `clinic_id` and `NULL` `franchise_id` (or core marker), following the existing signup flow.
3. WHEN the Platform creates an operational record derived from a franchise-assigned customer, THE Platform SHALL stamp that record with the same `franchise_id` resolved from the customer's Clinic.
4. WHEN the Platform creates an operational record derived from a Core_Operation customer, THE Platform SHALL persist that record with `NULL` `franchise_id` (or core marker), consistent with existing behavior.
5. IF a customer signs up and the Primary_Address pincode resolves to no Clinic of any active Franchise and no Core_Operation Clinic, THEN THE Platform SHALL accept the signup and place the customer in the Waitlist_State.
6. WHILE a customer is in the Waitlist_State, THE Platform SHALL prevent that customer from placing orders and SHALL present an indication that the customer's area is not yet served.
7. WHEN a Franchise Clinic begins serving a waitlisted customer's Primary_Address pincode, THE Platform SHALL stamp the servicing Franchise's `franchise_id` and `clinic_id` to that customer and remove the customer from the Waitlist_State.
8. THE Platform SHALL determine each customer's clinic and franchise association solely from the customer's Primary_Address and SHALL NOT change that association when the customer selects a different Delivery_Address for a specific delivery day, consistent with the `core-clinic-architecture` Clinic_Conflict flow.

### Requirement 15: One-Pincode-One-Entity Invariant and Overlap Detection

**User Story:** As a Master_Admin, I want overlapping pincode assignments surfaced during setup, so that customer assignment remains deterministic across the Core_Operation and all Franchises.

#### Acceptance Criteria

1. THE Platform SHALL associate each served pincode with exactly one Clinic, such that no pincode is served by more than one Clinic and no pincode is served by both the Core_Operation and a Franchise simultaneously, consistent with the `core-clinic-architecture` one-pincode-one-clinic invariant.
2. IF a pincode is mapped to more than one franchise Clinic, or is mapped to a franchise Clinic while already served by the Core_Operation, during franchise setup, THEN THE Platform SHALL identify the assignment as a configuration conflict and present a conflict indication to the Master_Admin that names the duplicated pincode and lists every entity (franchise Clinic or Core_Operation) the pincode is mapped to.
3. WHEN a pincode overlap conflict is detected, THE Platform SHALL present the conflict indication to the Master_Admin within 2 seconds of the conflicting franchise setup mapping being submitted.
4. THE Platform SHALL evaluate and surface pincode overlap conflicts at the point of franchise setup and SHALL NOT defer overlap detection to customer signup.
5. WHILE at least one pincode overlap conflict remains unresolved for a Franchise, THE Platform SHALL prevent that Franchise from transitioning to the `active` state and SHALL permit the Franchise's non-conflicting pincodes to receive customers.
6. IF the Master_Admin attempts to activate a Franchise WHILE one or more pincode overlap conflicts for that Franchise are unresolved, THEN THE Platform SHALL reject the activation request, retain the Franchise in its pre-activation state, and present an indication identifying each unresolved conflicting pincode.
7. WHEN every pincode overlap conflict for a Franchise has been resolved such that each pincode is mapped to exactly one entity, THE Platform SHALL clear the conflict indication and permit the Franchise to transition to the `active` state.

### Requirement 16: Subdomain Portal Routing

**User Story:** As a user, I want the correct portal to load for the web address I visit, so that I reach the workspace appropriate to my role.

#### Acceptance Criteria

1. WHEN a request arrives at `franchies.arogyadiet.com`, THE Routing_Middleware SHALL route the request to the Franchise portal within 500 milliseconds.
2. WHEN a request arrives at `admin.arogyadiet.com`, THE Routing_Middleware SHALL route the request to the Admin_Dashboard (Core_Operation portal) within 500 milliseconds.
3. WHEN a request arrives at `master.arogyadiet.com`, THE Routing_Middleware SHALL route the request to the Master_Dashboard within 500 milliseconds.
4. WHEN an authenticated Franchise_Admin reaches the Franchise portal, THE Routing_Middleware SHALL route the user into a workspace scoped to only that user's franchise records, excluding records belonging to any other Franchise and excluding all Core_Records.
5. IF an authenticated Franchise_Admin attempts to reach the Admin_Dashboard or Master_Dashboard, THEN THE Routing_Middleware SHALL prevent access entirely and route the user back to their franchise-scoped workspace at `franchies.arogyadiet.com`.
6. WHEN an authenticated Core_Admin reaches `admin.arogyadiet.com`, THE Routing_Middleware SHALL route the user into the Admin_Dashboard with visibility of Core_Operation records and franchise oversight capabilities.
7. WHEN an authenticated Master_Admin reaches `master.arogyadiet.com`, THE Routing_Middleware SHALL route the user into the Master_Dashboard with visibility of records from all Franchises and the Core_Operation.
8. IF a user without the required role reaches `franchies.arogyadiet.com`, `admin.arogyadiet.com`, or `master.arogyadiet.com`, THEN THE Routing_Middleware SHALL deny access at the middleware layer, route the user to the unauthorized page with an indication that the role is insufficient, and expose no franchise or core data regardless of the unauthorized page's implementation.
9. IF an unauthenticated user reaches `franchies.arogyadiet.com`, `admin.arogyadiet.com`, or `master.arogyadiet.com`, THEN THE Routing_Middleware SHALL route the user to the login page while preserving the requested subdomain.
10. IF a request arrives at a subdomain that maps to no defined portal, THEN THE Routing_Middleware SHALL route the request to the unauthorized page and expose no data.

### Requirement 17: Shared RBAC-Aware Dashboard

**User Story:** As a product owner, I want one operational dashboard reused across portals, so that every Franchise and the Core_Operation benefit from the same improvements.

#### Acceptance Criteria

1. THE Shared_Component_Layer SHALL render the customer, rider, inventory, order, and reporting interfaces from a single shared implementation for the Admin_Dashboard, Master_Dashboard, and Franchise_Dashboard, such that an update applied to a shared interface is reflected identically across all dashboards.
2. WHERE a viewer holds the `FRANCHISE_ADMIN` role, THE Shared_Component_Layer SHALL scope all displayed data in the customer, rider, inventory, order, and reporting interfaces to only the records belonging to that viewer's assigned Franchise, and SHALL exclude records belonging to any other Franchise or the Core_Operation.
3. WHERE a viewer holds the `FRANCHISE_ADMIN` role, THE Shared_Component_Layer SHALL hide all master-level and core-level controls, including Hierarchy management, global configuration, cross-franchise revenue, and Core_Operation data.
4. WHERE a viewer holds the `ADMIN` role (Core_Admin), THE Shared_Component_Layer SHALL display Core_Operation data as the primary view and SHALL additionally display franchise oversight controls for viewing and managing Franchise data.
5. WHERE a viewer holds the `MASTER_ADMIN` role, THE Shared_Component_Layer SHALL display master-level controls, cross-franchise data, and Core_Operation data spanning the entire network.
6. IF a viewer holds none of the `FRANCHISE_ADMIN`, `MASTER_ADMIN`, or `ADMIN` roles, THEN THE Shared_Component_Layer SHALL deny access, render none of the customer, rider, inventory, order, or reporting interfaces, and display an indication that access is not authorized.
7. IF a `FRANCHISE_ADMIN` viewer has no assigned Franchise, THEN THE Shared_Component_Layer SHALL display no franchise-scoped data and SHALL display an indication that no Franchise is assigned.
8. IF the Shared_Component_Layer fails to retrieve the data for any rendered interface, THEN THE Shared_Component_Layer SHALL display an error indication for that interface, SHALL display no data from other Franchises, the Core_Operation, or other roles, and SHALL retain the viewer's current role scope.

### Requirement 18: Scope-Based Access Control

**User Story:** As a platform owner, I want every server action and data read to enforce the requester's Scope, so that access control is uniform regardless of which interface issues the request.

#### Acceptance Criteria

1. WHEN any request reaches a server action, THE Scope_Resolver SHALL resolve the requesting user's Scope as exactly one of Core_Operation, a single Franchise identified by `franchise_id`, or full network (`MASTER_ADMIN` or `ADMIN`).
2. WHERE the resolved Scope is a single Franchise, THE Platform SHALL constrain every read, list, create, modify, and delete performed by that request to records carrying that Franchise's `franchise_id`.
3. WHERE the resolved Scope is full network, THE Platform SHALL permit access to Core_Records and Tenant_Isolated_Records across all Franchises.
4. WHERE the resolved Scope is Core_Operation, THE Platform SHALL constrain access to Core_Records (`NULL` `franchise_id` or core marker).
5. IF a request attempts an action outside the requesting user's resolved Scope, THEN THE Platform SHALL deny the action, persist no changes, and return a response indicating the action is outside the user's Scope.
6. IF the Scope_Resolver cannot resolve a Scope for an authenticated request, THEN THE Platform SHALL deny the action and return a response indicating the Scope could not be determined.
7. THE Scope enforced by the Scope_Resolver SHALL be consistent with the boundaries enforced by the RLS_Layer for the same user, such that no action permitted by one layer is denied by the other for the same resolved Scope.

### Requirement 19: Franchise Warehouse and Stock Transfer

**User Story:** As a Master_Admin, I want each Franchise to have its own warehouse and to relocate stock into Franchises, so that franchise inventory is owned independently and can be replenished from core or other franchise stock.

#### Acceptance Criteria

1. THE Platform SHALL maintain a Franchise_Warehouse scoped to exactly one Franchise, where every stock record in a Franchise_Warehouse carries that Franchise's `franchise_id`.
2. WHEN a Stock_Transfer is initiated from a source store to a destination Franchise_Warehouse for a quantity that does not exceed the available quantity at the source, THE Platform SHALL atomically decrement the transferred quantity at the source and increment the same quantity at the destination Franchise_Warehouse such that the total quantity across source and destination is conserved.
3. IF a Stock_Transfer is initiated for a quantity that exceeds the available quantity at the source store, THEN THE Platform SHALL reject the transfer, leave both the source and destination quantities unchanged, and return an error indicating insufficient source stock.
4. IF a Stock_Transfer is initiated for a quantity that is zero or negative, THEN THE Platform SHALL reject the transfer, leave both the source and destination quantities unchanged, and return an error indicating an invalid transfer quantity.
5. WHEN a Stock_Transfer completes, THE Platform SHALL record a transfer entry capturing the source store, destination Franchise_Warehouse, item, quantity, and timestamp.
6. WHERE the resolved Scope is a single Franchise, THE Platform SHALL permit that Franchise to view only its own Franchise_Warehouse stock and SHALL exclude stock belonging to the Core_Operation or any other Franchise.
7. WHERE the resolved Scope is full network, THE Platform SHALL permit the Master_Admin or Core_Admin to initiate a Stock_Transfer from the Core_Operation warehouse or any Franchise_Warehouse to any Franchise_Warehouse.

### Requirement 20: Core and Franchise Coexistence (Additive Only)

**User Story:** As the platform owner, I want the existing Hyderabad Core_Operation to coexist with new Franchises without any migration or disruption, so that the franchise expansion introduces no regression to the running business.

#### Acceptance Criteria

1. THE Platform SHALL NOT require migration of any existing Core_Operation records (customers, riders, subscriptions, orders, inventory, payments) to add a `franchise_id` or to change any existing column values.
2. THE Platform SHALL treat existing Core_Operation records with `NULL` `franchise_id` (or core marker) as belonging to the Core_Operation without requiring any data transformation.
3. WHEN the franchise model is introduced, THE Platform SHALL ensure that all existing Core_Operation workflows (customer management, rider management, inventory, deliveries, routing, payments) continue to function identically to their pre-franchise behavior.
4. THE Admin_Dashboard at `admin.arogyadiet.com` SHALL continue to operate exactly as it does today for Core_Admin users managing the Hyderabad operation, without introducing any franchise-selection step or requiring franchise context.
5. WHEN daily delivery routing runs for the Core_Operation, THE Platform SHALL execute routing logic against Core_Records only (`NULL` `franchise_id`), without applying any `franchise_id` filtering, consistent with how routing operates today.
6. WHEN daily delivery routing runs for a Franchise, THE Platform SHALL scope the routing logic to only records matching that Franchise's `franchise_id`, isolated from both Core_Records and other Franchise records.
7. THE Platform SHALL support concurrent operation of the Core_Operation and multiple Franchises without any ordering dependency — Franchises can be created, activated, or suspended independently of Core_Operation status.
8. WHERE `FRANCHISE_FEATURES_ENABLED` is false, THE Platform SHALL keep all franchise-specific reads, writes, side effects, and Hierarchy management inactive, and the Core_Operation SHALL behave exactly as it does today.
9. IF a new feature is deployed to the Platform, THEN THE feature SHALL be available to both the Core_Operation and all active Franchises simultaneously, maintaining the single-codebase principle.

### Requirement 21: Franchise Daily Operations Scoping

**User Story:** As a franchise owner, I want my daily operations (routing, deliveries, inventory) fully scoped to my Franchise, so that I operate independently without interference from the Core_Operation or other Franchises.

#### Acceptance Criteria

1. WHEN daily delivery routing runs for a Franchise, THE Platform SHALL include only delivery orders, rider profiles, and customer addresses belonging to that Franchise (matching `franchise_id`) in the routing computation, using the Franchise's wired Clinic location as the routing origin.
2. WHEN daily delivery routing runs for a Franchise, THE Platform SHALL exclude all Core_Records and records from other Franchises from the routing computation.
3. WHEN a Franchise_Admin views inventory, THE Platform SHALL display only inventory lots, products, and transactions belonging to that Franchise.
4. WHEN a Franchise_Admin manages riders, THE Platform SHALL display only rider profiles and service areas belonging to that Franchise.
5. WHEN a Franchise_Admin views reports, THE Platform SHALL compute metrics (revenue, delivery counts, subscription counts) using only records belonging to that Franchise.
6. THE Core_Admin SHALL retain the ability to trigger and manage daily routing for both the Core_Operation and any Franchise, viewing both scopes from the Admin_Dashboard.
