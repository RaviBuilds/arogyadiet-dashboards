# Requirements Document

## Introduction

This feature replaces the existing coarse admin access model (three flat levels: `inventory`, `operations`, `inventory_operations`) with a richer, configurable access-control model for the `ADMIN` role in the admin portal. A Master_Admin assigns each admin one of three top-level access levels when creating or editing the admin. Two of those levels behave like today (full inventory manage access; full inventory + operations manage access), while the third — **Operations only** — unlocks a second configuration step where the Master_Admin selects which operations groups the admin can reach and, per group, whether the admin has **Manage** (read + write) or **View** (read-only) permission.

The existing inventory (warehouse) experience is retained unchanged: an admin granted **Inventory only** keeps full manage access to the current inventory/warehouse pages with no read-only/manage distinction. The full-access level (**Inventory + Operations**) continues to grant unrestricted access to the entire admin dashboard.

This spec covers the access model itself: the per-admin configuration captured at create/edit time, its persistence and validation, the enforcement of that configuration across navigation, route access, and write operations, and the migration that discards the old access values in favor of the new model. It explicitly does not redesign the underlying pages, change the warehouse/inventory behavior, or introduce new roles beyond the existing `ADMIN` / `MASTER_ADMIN` roles.

### Scope decisions and assumptions

These assumptions are baked into the acceptance criteria below; flag any that should change.

- The model applies in this spec only to users with the `ADMIN` role (core admins). `MASTER_ADMIN`, `RIDER`, `CUSTOMER`, and franchise roles are unaffected at the enforcement layer here.
- The permission model (the three levels, the six operations groups, and the manage/view distinction) is **identical** to the model the business intends for franchise admins (`FRANCHISE_ADMIN`). Per the business model, a Franchise Admin is configured with the same levels and groups as a Core Admin. This spec therefore defines the model role-agnostically so it can be reused for `FRANCHISE_ADMIN` later, while wiring enforcement only into the core admin portal now. Franchise-portal enforcement stays out of scope and gated behind `FRANCHISE_FEATURES_ENABLED` (see Requirement 13).
- The six operations groups and their pages are: **Customers** (`/admin/customers`), **Subscriptions** (`/admin/subscriptions`), **Riders** (`/admin/riders`), **Operations** (`/admin/operations`), **Franchises** (`/admin/franchises`), and **Shop Products** (`/admin/kitchen-shop`).
- The **Dashboard** (`/admin/dashboard`) is the default landing page for every operations admin and shows operations KPIs. It is treated as an operations-neutral page available to any admin who has at least one granted operations group, so an Operations-only admin always has a home page to land on. Per-admin KPI customization is out of scope and may be added later.
- **Manage** = read plus all create/update/delete/mutation actions for that group. **View** = read-only; all mutations for that group are rejected and write controls are hidden or disabled.
- The `finance` and `test-routing` directories under the admin portal contain no page files and render nothing on the admin dashboard (finance was relocated to the master portal). They are therefore not part of this access model and require no classification.

## Glossary

- **Master_Admin**: A super-admin (`MASTER_ADMIN` role) who creates and configures admins from the master portal user-management screen.
- **Admin**: A user with the `ADMIN` role whose access is governed by an Access_Configuration.
- **Access_Level**: One of exactly three top-level selections assigned to an Admin: `inventory`, `operations`, or `inventory_operations`.
- **Operations_Group**: One of the six configurable operations capability groups (Customers, Subscriptions, Riders, Operations, Franchises, Shop Products), each mapping to one admin dashboard page/section.
- **Permission_Level**: The access granted for a single Operations_Group — either `manage` (read + write) or `view` (read-only).
- **Access_Configuration**: The complete access definition stored for an Admin: the Access_Level plus, when the level is `operations`, the set of selected Operations_Groups each paired with a Permission_Level.
- **Manage**: Read access plus all create/update/delete/mutation operations within a group.
- **View**: Read-only access; all mutating operations within the group are rejected.
- **Inventory_Area**: The existing warehouse/inventory pages under `/admin/inventory`, retained unchanged.
- **Route_Guard**: The middleware and layout-level enforcement that allows or redirects admin route requests based on the Access_Configuration.
- **Action_Guard**: The server-action-level enforcement that permits or rejects a mutation based on the Access_Configuration.

## Requirements

### Requirement 1: Top-Level Access Level Selection

**User Story:** As a Master_Admin, I want to choose one of three access levels when creating or editing an admin, so that I can set the broad scope of that admin's access.

#### Acceptance Criteria

1. WHEN a Master_Admin opens the create-admin or edit-admin form, THE System SHALL present exactly three selectable Access_Levels labeled "Inventory only", "Operations only", and "Inventory + Operations (Full Access)".
2. WHEN a Master_Admin selects an Access_Level and submits a valid admin form, THE System SHALL persist the selected Access_Level on the Admin record.
3. IF a Master_Admin submits an admin form with no Access_Level selected, THEN THE System SHALL reject the submission, persist no Access_Level change, and display an error indicating that an access level is required.
4. IF a Master_Admin submits an Access_Level value that is not one of the three permitted values, THEN THE System SHALL reject the submission and leave any existing Access_Configuration unchanged.
5. THE System SHALL apply the Access_Configuration only to users holding the `ADMIN` role and SHALL NOT alter access for `MASTER_ADMIN`, `RIDER`, `CUSTOMER`, or franchise-role users.

### Requirement 2: Inventory-Only Access Level

**User Story:** As a Master_Admin, I want an Inventory-only admin to retain full warehouse access exactly as it works today, so that existing inventory operations are unaffected.

#### Acceptance Criteria

1. WHEN an Admin's Access_Level is `inventory`, THE System SHALL grant that Admin full Manage access to the existing Inventory_Area pages with no read-only restriction.
2. WHEN an Admin whose Access_Level is `inventory` authenticates, THE System SHALL route that Admin to the inventory landing route (`/inventory`).
3. IF an Admin whose Access_Level is `inventory` requests any operations page, THEN THE Route_Guard SHALL deny the request and redirect the Admin to the inventory landing route.
4. THE System SHALL NOT present any per-group Manage/View configuration for the `inventory` Access_Level.
5. THE System SHALL preserve the current behavior, accepted inputs, and outcomes of the Inventory_Area pages for `inventory` admins without modification.

### Requirement 3: Inventory + Operations (Full Access) Level

**User Story:** As a Master_Admin, I want a full-access admin to reach the entire admin dashboard with no restrictions, so that trusted admins can operate everything.

#### Acceptance Criteria

1. WHEN an Admin's Access_Level is `inventory_operations`, THE System SHALL grant Manage access to every Inventory_Area page and every Operations_Group page.
2. WHEN an Admin whose Access_Level is `inventory_operations` authenticates, THE System SHALL route that Admin to the operations landing route (`/dashboard`).
3. THE Route_Guard SHALL permit an `inventory_operations` Admin to access every admin route that any admin may access.
4. THE Action_Guard SHALL permit every mutating operation across inventory and all operations groups for an `inventory_operations` Admin.
5. THE System SHALL NOT present any per-group Manage/View configuration for the `inventory_operations` Access_Level.

### Requirement 4: Operations-Only Group Selection

**User Story:** As a Master_Admin, I want to pick which operations groups an Operations-only admin can access, so that each admin only sees the parts of operations relevant to their job.

#### Acceptance Criteria

1. WHEN a Master_Admin selects the `operations` Access_Level in the admin form, THE System SHALL reveal a group-selection control listing all six Operations_Groups: Customers, Subscriptions, Riders, Operations, Franchises, and Shop Products.
2. WHEN a Master_Admin selects one or more Operations_Groups and submits a valid form, THE System SHALL persist each selected Operations_Group together with its Permission_Level as part of the Admin's Access_Configuration.
3. IF a Master_Admin submits the `operations` Access_Level with zero Operations_Groups selected, THEN THE System SHALL reject the submission, persist no change, and display an error indicating that at least one operations group must be selected.
4. THE System SHALL grant an `operations` Admin access only to the Operations_Groups present in that Admin's Access_Configuration and SHALL deny access to every Operations_Group not present.
5. THE System SHALL NOT grant an `operations` Admin any access to the Inventory_Area.
6. IF a Master_Admin submits an Operations_Group value that is not one of the six permitted groups, THEN THE System SHALL reject the submission and leave the existing Access_Configuration unchanged.

### Requirement 5: Per-Group Manage/View Permission

**User Story:** As a Master_Admin, I want to set each selected operations group to Manage or View, so that some admins can only read certain areas while editing others.

#### Acceptance Criteria

1. WHEN a Master_Admin selects an Operations_Group for an `operations` Admin, THE System SHALL default that group's Permission_Level to `manage`.
2. WHEN a Master_Admin changes a selected Operations_Group's Permission_Level to `view`, THE System SHALL persist that group as read-only for the Admin.
3. WHILE an Admin holds `view` permission for an Operations_Group, THE Action_Guard SHALL reject every create, update, or delete operation scoped to that group, leave the underlying data unchanged, and return an indication that the Admin has read-only access.
4. WHILE an Admin holds `view` permission for an Operations_Group, THE System SHALL allow that Admin to open and read the group's page and SHALL hide or disable controls that trigger mutations for that group.
5. WHILE an Admin holds `manage` permission for an Operations_Group, THE System SHALL allow that Admin to read the group's page and perform all create, update, and delete operations scoped to that group.
6. IF a Master_Admin submits a Permission_Level that is neither `manage` nor `view` for a selected group, THEN THE System SHALL reject the submission and leave the existing Access_Configuration unchanged.

### Requirement 6: Operations Group to Page Mapping

**User Story:** As an Admin, I want each operations group to map to the correct dashboard page, so that my granted groups open the right screens and ungranted groups are blocked.

#### Acceptance Criteria

1. THE System SHALL map the Customers group to `/admin/customers`, the Subscriptions group to `/admin/subscriptions`, the Riders group to `/admin/riders`, the Operations group to `/admin/operations`, the Franchises group to `/admin/franchises`, and the Shop Products group to `/admin/kitchen-shop`.
2. WHEN an `operations` Admin requests a page that maps to an Operations_Group present in that Admin's Access_Configuration, THE Route_Guard SHALL permit the request.
3. IF an `operations` Admin requests a page that maps to an Operations_Group not present in that Admin's Access_Configuration, THEN THE Route_Guard SHALL deny the request and redirect the Admin to that Admin's landing route.
4. THE System SHALL match a route to its Operations_Group at a path-segment boundary so that a sub-path of a granted group's page (for example `/admin/customers/{id}`) resolves to the same group.

### Requirement 7: Operations-Only Landing and Navigation

**User Story:** As an Operations-only admin, I want to land on a usable page and see only the groups I can access, so that the dashboard reflects my permissions.

#### Acceptance Criteria

1. WHEN an `operations` Admin authenticates, THE System SHALL route that Admin to the operations Dashboard landing route (`/dashboard`).
2. THE System SHALL display in the admin navigation only the Operations_Groups present in the Admin's Access_Configuration, plus operations-neutral items (Dashboard, Profile).
3. THE System SHALL omit from the admin navigation every Operations_Group not present in the Admin's Access_Configuration and the entire Inventory_Area for an `operations` Admin.
4. WHERE a navigation item is displayed for a group held at `view` permission, THE System SHALL still allow navigation to that page (read-only), distinguishing visibility from write capability.
5. THE System SHALL treat navigation trimming as a usability aid only and SHALL rely on the Route_Guard and Action_Guard as the authoritative access barriers.

### Requirement 8: Route-Level Enforcement

**User Story:** As a Master_Admin, I want route access enforced on the server, so that an admin cannot reach a page by typing its URL.

#### Acceptance Criteria

1. WHEN any admin route request is received, THE Route_Guard SHALL resolve the requesting Admin's Access_Configuration and classify the requested path.
2. IF the classified path belongs to the Inventory_Area and the Admin's Access_Configuration does not grant inventory access, THEN THE Route_Guard SHALL deny the request and redirect to the Admin's landing route.
3. IF the classified path belongs to an Operations_Group not granted to the Admin, THEN THE Route_Guard SHALL deny the request and redirect to the Admin's landing route.
4. WHEN the classified path is operations-neutral (Dashboard, Profile) and the Admin has any granted access, THE Route_Guard SHALL permit the request.
5. THE Route_Guard SHALL apply classification case-sensitively at path-segment boundaries and SHALL treat unclassifiable admin paths as neutral.

### Requirement 9: Write-Operation Enforcement

**User Story:** As a Master_Admin, I want write operations checked against the admin's permission level, so that a View-only admin cannot change data even through a direct action call.

#### Acceptance Criteria

1. WHEN an Admin invokes a mutating server action scoped to an Operations_Group, THE Action_Guard SHALL resolve the Admin's Access_Configuration before performing any data change.
2. IF the Admin does not have the Operations_Group in their Access_Configuration, THEN THE Action_Guard SHALL reject the operation, perform no data change, and return an access-denied indication.
3. IF the Admin holds `view` permission for the Operations_Group, THEN THE Action_Guard SHALL reject the mutating operation, perform no data change, and return a read-only indication.
4. WHEN the Admin holds `manage` permission for the Operations_Group OR holds the `inventory_operations` Access_Level, THE Action_Guard SHALL permit the mutating operation.
5. THE Action_Guard SHALL permit read-only queries for any Operations_Group the Admin can access at either `view` or `manage` permission.

### Requirement 10: Access Configuration Persistence and Validation

**User Story:** As a Master_Admin, I want the access configuration stored reliably and validated, so that only well-formed configurations are saved.

#### Acceptance Criteria

1. THE System SHALL persist, per Admin, the Access_Level and — when the Access_Level is `operations` — the set of selected Operations_Groups each paired with exactly one Permission_Level.
2. THE System SHALL store at most one Permission_Level per Operations_Group per Admin.
3. WHEN the Access_Level is `inventory` or `inventory_operations`, THE System SHALL store no per-group permission entries for that Admin.
4. IF a stored Access_Configuration is read and contains an unknown or malformed value, THEN THE System SHALL resolve it to a safe default that grants no operations-group access until reconfigured, and SHALL NOT throw.
5. THE System SHALL validate the submitted Access_Configuration on the server before persistence and SHALL reject any configuration that violates Requirements 1, 4, or 5.

### Requirement 11: Discarding the Existing Access Model (Migration)

**User Story:** As a Master_Admin, I want the old access values replaced by the new model with all existing admins kept on full access, so that no admin loses access during the switch and I can customize each admin afterward.

#### Acceptance Criteria

1. THE System SHALL discard the prior flat access model (`inventory`, `operations`, `inventory_operations` as the only stored value) in favor of the Access_Configuration model defined in this spec, delivered as additive SQL scripts in `/scripts` respecting Row Level Security.
2. WHEN the migration runs, THE System SHALL set every existing Admin to the `inventory_operations` (full access) Access_Level regardless of their prior value, so that no existing Admin loses access during the transition.
3. THE System SHALL store no per-group permission entries for any existing Admin after migration, consistent with the `inventory_operations` level carrying no per-group configuration.
4. THE System SHALL allow a Master_Admin to subsequently edit any existing Admin and reassign them to `inventory` or to `operations` with a customized per-group configuration.
5. IF the migration is run more than once, THEN THE System SHALL produce the same final Access_Configuration state without creating duplicate per-group entries (idempotent execution).

### Requirement 12: Master UI for Access Configuration

**User Story:** As a Master_Admin, I want a clear UI to configure access when creating or editing an admin, so that I can assign and adjust granular permissions easily.

#### Acceptance Criteria

1. WHEN a Master_Admin opens the create-admin or edit-admin dialog, THE System SHALL present the Access_Level selector and, upon selecting `operations`, the per-group selection with Manage/View controls.
2. WHEN a Master_Admin selects the `operations` Access_Level, THE System SHALL display each of the six Operations_Groups as selectable, each defaulting to `manage` when selected.
3. WHEN a Master_Admin edits an existing `operations` Admin, THE System SHALL pre-populate the dialog with that Admin's currently selected groups and per-group Permission_Levels.
4. WHEN a Master_Admin saves a valid Access_Configuration, THE System SHALL persist it, reflect the updated configuration in the admin list, and notify the affected Admin that their access level changed.
5. IF a Master_Admin changes an Admin from `operations` to `inventory` or `inventory_operations`, THEN THE System SHALL clear that Admin's stored per-group permission entries on save.
6. WHEN the affected Admin next loads the admin portal after a configuration change, THE System SHALL apply the new Access_Configuration to navigation, Route_Guard, and Action_Guard without requiring a manual cache reset.

### Requirement 13: Role-Agnostic Model and Franchise Readiness

**User Story:** As a developer, I want the access model defined independently of the core admin role, so that the same levels and groups can later govern franchise admins without reworking the model.

#### Acceptance Criteria

1. THE System SHALL define the Access_Level set, the six Operations_Groups, the Permission_Levels, and the configuration resolution and permission-checking logic as role-neutral primitives that do not assume the `ADMIN` role.
2. THE System SHALL wire route-level and write-level enforcement of the Access_Configuration only into the core admin portal in this feature, and SHALL NOT wire franchise-portal enforcement.
3. WHERE `FRANCHISE_FEATURES_ENABLED` is false or unset, THE System SHALL produce no franchise-specific access-control reads, writes, or side effects at runtime.
4. THE System SHALL keep the permission primitives reusable for the `FRANCHISE_ADMIN` role WITHOUT activating any franchise access-control behavior in this feature.
5. THE System SHALL NOT alter the existing access of `FRANCHISE_ADMIN`, `Franchise_owner`, `MASTER_ADMIN`, `RIDER`, or `CUSTOMER` users as a result of this feature.
