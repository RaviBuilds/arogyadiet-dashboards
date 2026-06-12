# Requirements Document

## Introduction

This document defines the requirements for evolving ArogyaDiet from a single-location meal-delivery business into a multi-tenant Franchise SaaS platform. The platform follows a "Single Codebase · Shared Database · Isolated Data" model: every franchise runs the same application against one shared PostgreSQL (Supabase) database, while each franchise can only ever access its own slice of the operational data.

The requirements are derived from the approved technical design and capture the franchise registry, tenant data isolation enforced by Row Level Security (RLS), pincode-based customer assignment, subdomain-based portal routing, the shared RBAC-aware dashboard component layer, and the head-office (Master/Core Admin) network oversight capabilities. They also preserve the existing Hyderabad core operation as the founding franchise.

## Glossary

- **Platform**: The complete ArogyaDiet multi-tenant application (single codebase) serving all portals.
- **Franchise**: An independent operating business (e.g., Hyderabad Core, Gachibowli, Bangalore) identified by a unique `franchise_id`, holding its own customers, riders, inventory, and orders.
- **Franchise_Registry**: The component responsible for the central `franchises` table, including franchise identity, operational status, kitchen anchor, and served pincodes.
- **Tenant_Isolated_Record**: Any operational data record carrying a `franchise_id` stamp (e.g., customer profiles, subscriptions, delivery orders, riders, inventory, payments, notifications).
- **Global_Table**: A platform-wide shared table identical for every franchise (`system_settings`, `roles`, `subscription_plans`, `meal_categories`, `holidays`, `products`).
- **Franchise_Admin**: A user with the `FRANCHISE_ADMIN` role who operates a single franchise's dashboard. Their identity carries the `franchise_id` of the franchise they belong to.
- **Master_Admin**: A user with the `MASTER_ADMIN` or `ADMIN` role who operates above the franchise boundary with cross-franchise visibility (head office / Core Admin).
- **Franchise_User**: Any user belonging to one franchise (`FRANCHISE_ADMIN`, or the franchise's riders and customers) whose access is scoped to that franchise's `franchise_id`.
- **RLS_Layer**: The PostgreSQL Row Level Security enforcement layer that restricts row access based on the requester's `franchise_id`.
- **Assignment_Resolver**: The component that resolves a customer's delivery pincode to exactly one servicing franchise at signup.
- **Routing_Middleware**: The subdomain-based middleware that detects the portal (`franchies.arogyadiet.com`, `admin.arogyadiet.com`, `master.arogyadiet.com`) and routes the request after verifying role and franchise.
- **Shared_Component_Layer**: The portal-agnostic, RBAC-aware operational component library (`shared/components`) powering both the Admin and Franchise dashboards.
- **Master_Dashboard**: The head-office command center showing consolidated cross-franchise data and onboarding controls.
- **Franchise_Dashboard**: The local operating dashboard scoped to a single franchise, served at `franchies.arogyadiet.com`.
- **Waitlist_State**: A head-office "unassigned" holding state for customers whose pincode matches no active franchise.

## Requirements

### Requirement 1: Franchise Registry

**User Story:** As a Master Admin, I want a central franchise registry, so that each operating location has a distinct identity, status, location anchor, and service territory.

#### Acceptance Criteria

1. THE Franchise_Registry SHALL maintain a `franchises` record for each franchise containing a unique identifier that is unique across all `franchises` records, a name of 1 to 100 characters that is unique across all `franchises` records, an operational status, and a kitchen anchor reference.
2. THE Franchise_Registry SHALL restrict the operational status of each franchise to exactly one of the values active, onboarding, or suspended.
3. THE Franchise_Registry SHALL associate each franchise with a kitchen anchor reference that identifies exactly one existing record in the `kitchens` table.
4. THE Franchise_Registry SHALL associate each franchise with a set of 0 to 1000 served pincodes, where each pincode is a 6-digit numeric value, expressed through the pincode-based service-area model.
5. WHEN the Master Admin creates a new franchise with a name of 1 to 100 characters that is not already used by another franchise and a kitchen anchor reference that identifies an existing `kitchens` record, THE Platform SHALL persist the franchise with status onboarding.
6. IF the Master Admin attempts to create or update a franchise with a kitchen anchor reference that does not identify an existing `kitchens` record, a name that is empty, longer than 100 characters, or already used by another franchise, or an operational status outside the set {active, onboarding, suspended}, THEN THE Platform SHALL reject the operation, return an error indicating the specific validation failure, and persist no changes to the `franchises` record.
7. IF the Master Admin attempts to associate a franchise with a pincode that is not a 6-digit numeric value or that exceeds the maximum of 1000 served pincodes, THEN THE Platform SHALL reject the operation, return an error indicating the invalid pincode or count limit, and leave the franchise's existing served pincodes unchanged.

### Requirement 2: Franchise Onboarding and Lifecycle Control

**User Story:** As a Master Admin, I want to create, configure, and change the status of franchises, so that I can launch, pause, and reinstate locations without engineering work.

#### Acceptance Criteria

1. WHEN the Master Admin creates a franchise, THE Platform SHALL require assignment of exactly one Franchise_Admin owner to that franchise.
2. IF the Master Admin attempts to create a franchise without assigning exactly one Franchise_Admin owner, THEN THE Platform SHALL reject the creation, persist no franchise record, and return an error indicating the missing owner.
3. WHEN the Master Admin assigns served pincodes to a franchise, THE Platform SHALL record those pincodes against that franchise, where each pincode is a 6-digit numeric value.
4. IF the Master Admin attempts to assign a pincode to a franchise that is already assigned to another franchise, THEN THE Platform SHALL reject the assignment, leave the existing pincode assignments unchanged, and return an error indicating the pincode conflict.
5. WHEN the Master Admin activates a franchise that is not already active, THE Platform SHALL set the franchise status to active within 5 seconds.
6. WHEN the Master Admin suspends a franchise that is not already suspended, THE Platform SHALL set the franchise status to suspended within 5 seconds.
7. WHILE a franchise has status suspended, THE Platform SHALL deny all dashboard operations to that franchise's Franchise_Admin and present an indication that the franchise is suspended.
8. WHILE a franchise has status suspended, THE Platform SHALL retain that franchise's historical records without modification and keep them visible to the Master_Admin.
9. WHEN the Master Admin reactivates a suspended franchise, THE Platform SHALL set the franchise status to active within 5 seconds and restore dashboard operation to that franchise's Franchise_Admin.
10. IF the Master Admin attempts to activate a franchise that is already active, reactivate a franchise that is already active, or suspend a franchise that is already suspended, THEN THE Platform SHALL reject the request, leave the franchise status unchanged, and return an error indicating the invalid status transition.

### Requirement 3: Franchise Identity Association

**User Story:** As a Master Admin, I want every staff member linked to a franchise, so that the platform can scope their access correctly.

#### Acceptance Criteria

1. THE Platform SHALL record exactly one `franchise_id` association, referencing an existing `franchises` record, for each Franchise_User on the existing `users` identity record.
2. WHERE a user holds the `MASTER_ADMIN` or `ADMIN` role, THE Platform SHALL associate that user with no single `franchise_id` and SHALL permit that user access spanning all franchises.
3. WHEN a Franchise_Admin authenticates successfully, THE Platform SHALL resolve the single `franchise_id` carried by that user's identity and make that `franchise_id` available for access scoping for the duration of the authenticated session.
4. IF a Franchise_Admin authenticates and no `franchise_id` is associated with that user's identity, THEN THE Platform SHALL deny dashboard access, SHALL NOT grant any franchise-scoped access, and SHALL present an error indicating the missing franchise association.

### Requirement 4: Tenant Data Stamping

**User Story:** As a platform owner, I want every operational record tagged with its owning franchise, so that data ownership is unambiguous.

#### Acceptance Criteria

1. THE Platform SHALL store a non-null `franchise_id` reference on every Tenant_Isolated_Record, where the value matches the `franchise_id` of an existing Franchise.
2. WHEN a Franchise_User creates a Tenant_Isolated_Record, THE Platform SHALL stamp the record with that requesting user's own `franchise_id`, ignoring any `franchise_id` value supplied in the request payload.
3. IF a request attempts to create a Tenant_Isolated_Record under a `franchise_id` other than the requesting Franchise_User's own `franchise_id`, THEN THE Platform SHALL reject the write without persisting any record and return a response indicating the franchise ownership violation.
4. IF a request attempts to create a Tenant_Isolated_Record with a missing, null, or empty `franchise_id` that cannot be resolved from the requesting Franchise_User, THEN THE Platform SHALL reject the write without persisting any record and return a response indicating the missing franchise reference.
5. IF the requesting Franchise_User's resolved `franchise_id` does not match an existing Franchise, THEN THE Platform SHALL reject the write without persisting any record and return a response indicating the invalid franchise reference.

### Requirement 5: Tenant Data Isolation

**User Story:** As a franchise owner, I want my data to be invisible to other franchises, so that my customers, revenue, and operations remain private.

#### Acceptance Criteria

1. WHEN a Franchise_User reads a Tenant_Isolated_Record, THE RLS_Layer SHALL return the record only if its `franchise_id` equals the requesting user's `franchise_id`.
2. WHEN a Franchise_User attempts to modify or delete a Tenant_Isolated_Record whose `franchise_id` differs from the requesting user's `franchise_id`, THE RLS_Layer SHALL deny the operation, leave the stored record unchanged, and return a response indicating the operation is not permitted.
3. IF a Franchise_User requests a Tenant_Isolated_Record belonging to another franchise, THEN THE RLS_Layer SHALL return a result indistinguishable from that of a non-existent record and SHALL NOT disclose the existence of the record.
4. WHEN a Franchise_User issues a list or aggregate query over a tenant-isolated table, THE RLS_Layer SHALL exclude records whose `franchise_id` differs from the requesting user's `franchise_id` from both the returned rows and any aggregate computation.
5. IF a Franchise_User attempts to create a Tenant_Isolated_Record with a `franchise_id` other than the requesting user's `franchise_id`, THEN THE RLS_Layer SHALL deny the operation and persist no record.
6. IF the requesting Franchise_User has a null, empty, or unresolved `franchise_id`, THEN THE RLS_Layer SHALL deny all access to tenant-isolated records.
7. THE RLS_Layer SHALL enforce isolation across every tenant-isolated table for read, list, create, modify, and delete operations, regardless of the query interface used.

### Requirement 6: Master Cross-Franchise Access

**User Story:** As a Master Admin, I want full visibility across the network, so that I can oversee consolidated performance and manage every location.

#### Acceptance Criteria

1. WHEN a Master_Admin reads Tenant_Isolated_Records, THE RLS_Layer SHALL return records across all franchises.
2. IF a user who does not hold the `MASTER_ADMIN` or `ADMIN` role attempts a cross-franchise read, THEN THE RLS_Layer SHALL restrict the result to that user's assigned franchise.
3. THE Master_Dashboard SHALL present consolidated revenue across all franchises for a Master_Admin-selectable reporting period that defaults to the current calendar month.
4. WHEN the Master_Admin selects a single franchise to drill down, THE Master_Dashboard SHALL re-scope the displayed revenue and operations metrics to that selected franchise.
5. THE Master_Dashboard SHALL present network operations health within the selected reporting period, including active subscription count, completed versus scheduled delivery counts, and active rider count, rolled up across all franchises.
6. WHEN no operational data exists for the selected reporting period, THE Master_Dashboard SHALL present zero values for the affected metrics.
7. IF the Master_Dashboard fails to load any metric, THEN THE Master_Dashboard SHALL present an error indication for that metric without blocking the remaining metrics.
8. THE Master_Dashboard SHALL present the Hyderabad core operation as a labeled founding-franchise entry in the franchise list.

### Requirement 7: Global Table Consistency

**User Story:** As a platform owner, I want shared configuration centralized, so that the brand experience is consistent and controlled by head office.

#### Acceptance Criteria

1. WHEN any franchise requests a Global_Table, THE Platform SHALL return Global_Table data that is byte-for-byte identical to the data returned to every other franchise for the same Global_Table.
2. WHEN a Master_Admin submits a modification to a Global_Table, THE Platform SHALL persist the change and make the updated data available to all franchises within 5 seconds of successful persistence.
3. IF persistence of a Master_Admin modification to a Global_Table fails, THEN THE Platform SHALL reject the modification, retain the previously persisted Global_Table data unchanged for all franchises, and return an error response indicating the modification was not saved.
4. IF a Franchise_User attempts to modify a Global_Table, THEN THE Platform SHALL reject the modification, leave the existing Global_Table data unchanged, and return an error response indicating that modification is not permitted.
5. WHEN a Franchise_User reads a Global_Table, THE Platform SHALL return the current shared Global_Table data as last persisted by a Master_Admin.

### Requirement 8: Pincode-to-Franchise Assignment

**User Story:** As a customer, I want to be served by the franchise covering my area, so that my orders are fulfilled by the correct local kitchen.

#### Acceptance Criteria

1. WHEN a customer signs up with a delivery pincode that is served by exactly one active franchise, THE Assignment_Resolver SHALL assign that franchise's `franchise_id` to the customer profile before the signup is marked complete.
2. WHEN the Platform creates an operational record derived from an assigned customer, THE Platform SHALL stamp that record with the same `franchise_id` assigned to the customer.
3. IF a customer signs up with a delivery pincode served by no active franchise, THEN THE Platform SHALL accept the signup and place the customer in the Waitlist_State.
4. WHILE a customer is in the Waitlist_State, THE Platform SHALL prevent that customer from placing orders and SHALL present an indication that the customer's area is not yet served.
5. WHEN the Master Admin extends an existing franchise's served pincodes or onboards a new franchise covering a waitlisted customer's pincode, THE Platform SHALL assign the servicing franchise's `franchise_id` to that customer and remove the customer from the Waitlist_State.
6. THE Assignment_Resolver SHALL resolve each served pincode to exactly one active franchise.
7. IF a customer's delivery pincode is served by more than one active franchise, THEN THE Platform SHALL not auto-assign the customer, SHALL place the customer in the Waitlist_State, and SHALL surface the conflict to the Master_Admin.

### Requirement 9: Pincode Overlap Detection

**User Story:** As a Master Admin, I want overlapping pincode assignments surfaced during setup, so that customer assignment remains deterministic.

#### Acceptance Criteria

1. IF a pincode is mapped to more than one franchise during franchise setup, THEN THE Platform SHALL identify the assignment as a configuration conflict and present a conflict indication to the Master_Admin that names the duplicated pincode and lists every franchise the pincode is mapped to.
2. WHEN a pincode overlap conflict is detected, THE Platform SHALL present the conflict indication to the Master_Admin within 2 seconds of the conflicting franchise setup mapping being submitted.
3. THE Platform SHALL evaluate and surface pincode overlap conflicts only at the point of franchise setup, and SHALL NOT defer overlap detection to customer signup.
4. WHILE at least one pincode overlap conflict remains unresolved for a territory, THE Platform SHALL prevent that territory from transitioning to the live state, SHALL permit non-live state transitions (such as draft to review) for that territory, and SHALL permit the territory's non-conflicting pincodes to receive customers.
5. IF the Master_Admin attempts to set a territory live WHILE one or more pincode overlap conflicts for that territory are unresolved, THEN THE Platform SHALL reject the activation request, retain the territory in its pre-activation state, and present an indication identifying each unresolved conflicting pincode.
6. WHEN every pincode overlap conflict for a territory has been resolved such that each pincode is mapped to exactly one franchise, THE Platform SHALL clear the conflict indication for that territory and permit the territory to transition to the live state.

### Requirement 10: Subdomain Portal Routing

**User Story:** As a user, I want the correct portal to load for the web address I visit, so that I reach the workspace appropriate to my role.

#### Acceptance Criteria

1. WHEN a request arrives at `franchies.arogyadiet.com`, THE Routing_Middleware SHALL route the request to the Franchise portal within 500 milliseconds.
2. WHEN a request arrives at `admin.arogyadiet.com`, THE Routing_Middleware SHALL route the request to the head-office portal within 500 milliseconds.
3. WHEN an authenticated Franchise_Admin reaches the Franchise portal, THE Routing_Middleware SHALL route the user into a workspace scoped to only that user's franchise records, excluding records belonging to any other franchise.
4. IF an authenticated Franchise_Admin attempts to reach the head-office global workspace, THEN THE Routing_Middleware SHALL prevent access to the global workspace entirely and route the user back to their franchise-scoped workspace.
5. WHEN an authenticated Master_Admin reaches the head-office portal, THE Routing_Middleware SHALL route the user into the global workspace with visibility of records from all franchises.
6. IF a user without the required role reaches `franchies.arogyadiet.com` or `admin.arogyadiet.com`, THEN THE Routing_Middleware SHALL deny access at the middleware layer, route the user to the unauthorized page with an indication that the role is insufficient, and expose no franchise data regardless of the unauthorized page's implementation.
7. IF an unauthenticated user reaches `franchies.arogyadiet.com` or `admin.arogyadiet.com`, THEN THE Routing_Middleware SHALL route the user to the login page while preserving the requested subdomain.
8. IF a request arrives at a subdomain that maps to no defined portal, THEN THE Routing_Middleware SHALL route the request to the unauthorized page and expose no data.

### Requirement 11: Shared RBAC-Aware Dashboard

**User Story:** As a product owner, I want one operational dashboard reused across portals, so that every franchise and head office benefit from the same improvements.

#### Acceptance Criteria

1. THE Shared_Component_Layer SHALL render the customer, rider, inventory, order, and reporting interfaces from a single shared implementation for both the Master_Dashboard and the Franchise_Dashboard, such that an update applied to a shared interface is reflected identically in both dashboards.
2. WHERE a viewer holds the `FRANCHISE_ADMIN` role, THE Shared_Component_Layer SHALL scope all displayed data in the customer, rider, inventory, order, and reporting interfaces to only the records belonging to that viewer's assigned franchise, and SHALL exclude records belonging to any other franchise.
3. WHERE a viewer holds the `FRANCHISE_ADMIN` role, THE Shared_Component_Layer SHALL hide all master-level controls, including franchise onboarding, global configuration, and cross-franchise revenue.
4. WHERE a viewer holds the `MASTER_ADMIN` or `ADMIN` role, THE Shared_Component_Layer SHALL display master-level controls and cross-franchise data spanning all franchises.
5. IF a viewer holds none of the `FRANCHISE_ADMIN`, `MASTER_ADMIN`, or `ADMIN` roles, THEN THE Shared_Component_Layer SHALL deny access, render none of the customer, rider, inventory, order, or reporting interfaces, and display an indication that access is not authorized.
6. IF a `FRANCHISE_ADMIN` viewer has no assigned franchise, THEN THE Shared_Component_Layer SHALL display no franchise-scoped data and SHALL display an indication that no franchise is assigned.
7. IF the Shared_Component_Layer fails to retrieve the data for any rendered interface, THEN THE Shared_Component_Layer SHALL display an error indication for that interface, SHALL display no data from other franchises or roles, and SHALL retain the viewer's current role scope.

### Requirement 12: Core Operation Continuity

**User Story:** As the founding operator, I want the existing Hyderabad operation to keep working unchanged, so that the franchise transition introduces no regression.

#### Acceptance Criteria

1. WHERE the Hyderabad core operation runs as the founding franchise, THE Platform SHALL continue to provide the same customer, rider, inventory, and delivery workflows that existed before the franchise transition, without introducing an additional franchise-selection step for founding-franchise users.
2. WHEN the `franchise_id` model is applied to existing records, THE Platform SHALL associate every existing Hyderabad Tenant_Isolated_Record with the founding franchise.
3. IF the association of an existing Hyderabad record with the founding franchise fails during migration, THEN THE Platform SHALL roll back that association and report the failure without leaving the record partially migrated.
4. WHEN the `franchise_id` migration completes, THE Platform SHALL ensure that no Tenant_Isolated_Record remains without a `franchise_id`.
