# Requirements Document

## Introduction

This feature introduces three **admin access levels** as a sub-classification within the existing `ADMIN` role of the ArogyaDiet admin portal (`admin.arogyadiet.com`). It does not create new roles; the `ADMIN` role and its existing login, subdomain routing, and RLS posture remain intact. What changes is *which slices of the admin portal a given admin can see and reach*.

The three access levels are:

| Access Level           | Stored value           | Operations access | `/inventory` access |
| ---------------------- | ---------------------- | ----------------- | ------------------- |
| Inventory only         | `inventory`            | No                | Yes                 |
| Operations only        | `operations`           | Yes               | No                  |
| Inventory + Operations | `inventory_operations` | Yes               | Yes                 |

A Master Admin (`master.arogyadiet.com`) sets an admin's access level when creating the account and can edit it later. When an existing admin's access level is changed, that admin receives an on-dashboard notification. Access levels are stored in a new nullable column on `public.users`, where a `NULL` value is resolved as full access for backward compatibility. Enforcement is layered (middleware, layout guards, server-action guards, and UI gating) so that hiding navigation is never the only barrier.

## Glossary

- **Admin**: A user whose role code is `ADMIN`, authenticated against the admin portal.
- **Master_Admin**: A super-admin user operating the master portal who creates and edits Admin accounts.
- **Access_Level**: The sub-classification of an Admin, one of `inventory`, `operations`, or `inventory_operations`.
- **Access_Area**: A capability area that an admin route belongs to, one of `operations` or `inventory`.
- **Operations_Area**: The set of admin routes covering Dashboard, Customers, Subscriptions, Riders, Operations, Shop Products, and Franchises.
- **Inventory_Area**: The set of admin routes under `/inventory` (the warehouse system).
- **Neutral_Path**: An admin path that belongs to no Access_Area and is loadable by every Admin (e.g. `/admin/profile`, `/admin/login`).
- **Landing_Route**: The home route an Admin is sent to after login and on redirect-on-deny, computed from the Access_Level.
- **Access_Resolver**: The pure function `resolveAccessLevel` that normalizes a raw stored value into a valid Access_Level.
- **Access_Gate**: The middleware path-based gate that permits or denies a request based on Access_Level and the requested path.
- **Layout_Guard**: A server component (operations layout and inventory layout) that re-resolves the Access_Level and redirects when access is not permitted.
- **Action_Guard**: The `assertAdminAccess` utility invoked at the top of sensitive server actions.
- **Admin_Management_Service**: The master server actions `createAdminUser` and `updateAdminUser` that persist Access_Level.
- **Notification_Service**: The existing `sendNotificationToUser` path that inserts a row into `public.notifications`.
- **Notification_Bell**: The UI component that displays notifications, mounted on both the operations surface and the inventory surface.
- **Users_Table**: The `public.users` table holding the new `admin_access_level` column.
- **Path_Classifier**: The function that maps a request path to an Access_Area or a Neutral_Path.
- **Landing_Router**: The function `landingRouteFor` that computes the Landing_Route from an Access_Level.
- **Admin_Navbar**: The operations-surface navigation component.
- **Inventory_Header**: The inventory-surface header component.
- **Executive_Dashboard**: The operations dashboard component that renders KPIs and quick actions.
- **Master_Portal**: The master-admin user-management interface.
- **Admin_Portal**: The admin-subdomain application as a whole.

## Requirements

### Requirement 1: Persist Access Level on Admin Users

**User Story:** As a Master_Admin, I want each admin's access level stored as a constrained attribute, so that the platform can consistently enforce what each admin can reach.

#### Acceptance Criteria

1. THE Users_Table SHALL provide an `admin_access_level` column that accepts exactly one of the values `inventory`, `operations`, `inventory_operations`, or `NULL`, and SHALL default to `NULL` when no value is supplied at row creation.
2. WHERE a user's role code is not `ADMIN`, THE Users_Table SHALL store `admin_access_level` as `NULL` regardless of any non-`NULL` value supplied in the write.
3. IF a write supplies a non-`NULL` `admin_access_level` for a user whose role code is not `ADMIN`, THEN THE Users_Table SHALL persist the column as `NULL` and complete the remainder of the write without error.
4. IF a write attempts to store an `admin_access_level` value outside the set `inventory`, `operations`, `inventory_operations`, `NULL`, THEN THE Users_Table SHALL reject the entire write via a database constraint, leave any existing row value unchanged, and return an error indicating the value is not permitted.

### Requirement 2: Resolve Access Level with Backward Compatibility

**User Story:** As an existing admin, I want my account to keep full access after the feature ships, so that the change does not disrupt my work.

#### Acceptance Criteria

1. WHEN the Access_Resolver receives an input value that exactly matches a member of the permitted Access_Level set (case-sensitive, after trimming no characters), THE Access_Resolver SHALL return that same Access_Level value unchanged.
2. IF the Access_Resolver receives `NULL`, `undefined`, an empty string, or any value not exactly matching a member of the permitted Access_Level set, THEN THE Access_Resolver SHALL return the default Access_Level `inventory_operations`.
3. THE Access_Resolver SHALL return exactly one member of the permitted Access_Level set for every input, including malformed, missing, or unexpected-type inputs, without raising an error, throwing an exception, or returning `NULL`/`undefined`.
4. WHEN the Access_Resolver receives an input of a non-string type (such as number, boolean, object, or array), THE Access_Resolver SHALL return the default Access_Level `inventory_operations`.

### Requirement 3: Classify Admin Paths into Access Areas

**User Story:** As a platform operator, I want each admin path mapped to an access area, so that access decisions are consistent across enforcement layers.

#### Acceptance Criteria

1. WHEN a request path begins with the `/admin/inventory` prefix at a path-segment boundary (the prefix is immediately followed by either the end of the path or a `/` character) using case-sensitive comparison, THE Path_Classifier SHALL classify it as the `inventory` Access_Area.
2. WHEN a request path begins with an Operations_Area prefix, including `/admin/dashboard`, at a path-segment boundary (the prefix is immediately followed by either the end of the path or a `/` character) using case-sensitive comparison, THE Path_Classifier SHALL classify it as the `operations` Access_Area.
3. WHEN a request path begins with neither an Inventory_Area prefix nor an Operations_Area prefix at a path-segment boundary, THE Path_Classifier SHALL classify it as a Neutral_Path.
4. IF a request path begins with both an Inventory_Area prefix and an Operations_Area prefix at a path-segment boundary, THEN THE Path_Classifier SHALL classify it using the longest matching prefix, and SHALL classify it as the `inventory` Access_Area when both matching prefixes are of equal length.
5. IF a request path is empty, null, or not a well-formed absolute path beginning with `/`, THEN THE Path_Classifier SHALL classify it as a Neutral_Path.

### Requirement 4: Determine Area Permission by Access Level

**User Story:** As a platform operator, I want a single source of truth for which access level may enter which area, so that all layers enforce the same rules.

#### Acceptance Criteria

1. WHILE the Access_Level is `inventory`, THE Access_Gate SHALL permit a request targeting the `inventory` Access_Area and SHALL deny a request targeting the `operations` Access_Area with an access-denied indication to the caller.
2. WHILE the Access_Level is `operations`, THE Access_Gate SHALL permit a request targeting the `operations` Access_Area and SHALL deny a request targeting the `inventory` Access_Area with an access-denied indication to the caller.
3. WHILE the Access_Level is `inventory_operations`, THE Access_Gate SHALL permit a request targeting the `operations` Access_Area and SHALL permit a request targeting the `inventory` Access_Area.
4. WHEN a requested path is a Neutral_Path, THE Access_Gate SHALL permit the request for every Access_Level, including an absent or unrecognized Access_Level.
5. IF the Access_Level is absent, null, or any value other than `inventory`, `operations`, or `inventory_operations`, THEN THE Access_Gate SHALL deny the request and return an access-denied indication to the caller.
6. IF a requested path targets an Access_Area that is neither `inventory` nor `operations` and is not a Neutral_Path, THEN THE Access_Gate SHALL deny the request and return an access-denied indication to the caller.

### Requirement 5: Compute the Landing Route from Access Level

**User Story:** As an admin, I want to land on a route I can actually use, so that I am never dropped on a page I am not permitted to see.

#### Acceptance Criteria

1. WHEN the Access_Level is exactly `inventory`, THE Landing_Router SHALL return the route string `/inventory`.
2. WHEN the Access_Level is exactly `operations`, THE Landing_Router SHALL return the route string `/dashboard`.
3. WHEN the Access_Level is exactly `inventory_operations`, THE Landing_Router SHALL return the route string `/dashboard`.
4. THE Landing_Router SHALL return exactly one route string per evaluation and SHALL perform the Access_Level comparison as case-sensitive.

### Requirement 6: Enforce Access at the Middleware Gate

**User Story:** As a security owner, I want path-based access enforced before a route renders, so that admins cannot reach areas outside their access level.

#### Acceptance Criteria

1. IF an authenticated Admin requests an admin path that the Access_Gate does not permit for the Admin's Access_Level, THEN THE Access_Gate SHALL redirect the request to the Landing_Route computed for that Access_Level without rendering the requested path's content.
2. IF a user requesting an admin-subdomain path has a role code other than `ADMIN`, THEN THE Access_Gate SHALL redirect the request to `/unauthorized` without rendering the requested path's content.
3. WHEN an authenticated Admin requests the root path, a login path, or a signup path, THE Access_Gate SHALL redirect the Admin to the Landing_Route computed for the Admin's Access_Level.
4. WHEN an Admin with Access_Level `inventory` requests `/admin/dashboard` or any Operations_Area path, THE Access_Gate SHALL redirect the Admin to `/inventory`.
5. WHEN an Admin with Access_Level `operations` requests any Inventory_Area path, THE Access_Gate SHALL redirect the Admin to `/dashboard`.
6. THE Access_Gate SHALL complete its access evaluation and any resulting redirect before the requested path's content is rendered.
7. IF an unauthenticated user requests any admin-subdomain path, THEN THE Access_Gate SHALL redirect the request to a login path without rendering the requested path's content.

### Requirement 7: Enforce Access at Layout Guards

**User Story:** As a security owner, I want server-rendered layouts to re-check access, so that requests bypassing the middleware matcher are still blocked.

#### Acceptance Criteria

1. WHEN the operations Layout_Guard resolves an Access_Level that does not permit the `operations` Access_Area, THE Layout_Guard SHALL redirect the request to the Landing_Route computed for that Access_Level before rendering any child component.
2. WHEN the inventory Layout_Guard resolves an Access_Level that does not permit the `inventory` Access_Area, THE Layout_Guard SHALL redirect the request to the Landing_Route computed for that Access_Level before rendering any child component.
3. IF a Layout_Guard resolves a role code other than `ADMIN`, THEN THE Layout_Guard SHALL redirect the request to `/unauthorized` and SHALL NOT render any child component.
4. WHEN a Layout_Guard permits a request, THE Layout_Guard SHALL pass the resolved Access_Level to its child components.
5. IF a Layout_Guard cannot resolve an Access_Level for the request because no authenticated session exists or the session lacks an Access_Level, THEN THE Layout_Guard SHALL redirect the request to `/unauthorized` and SHALL NOT render any child component.
6. WHILE handling any incoming request, THE Layout_Guard SHALL evaluate the resolved Access_Level on every server render independently of whether the request matched the middleware matcher.

### Requirement 8: Enforce Access at Server Actions

**User Story:** As a security owner, I want sensitive server actions to verify access independently, so that a crafted request cannot mutate data outside the admin's scope.

#### Acceptance Criteria

1. WHEN the Action_Guard is invoked for an Access_Area that the current Admin's Access_Level permits, THE Action_Guard SHALL return the resolved Access_Level before any data mutation in the server action is performed.
2. IF the Action_Guard is invoked for an Access_Area that the current Admin's Access_Level does not permit, THEN THE Action_Guard SHALL raise an access-denied error, return control to the caller without executing the server action's mutation, and leave all persisted data unchanged.
3. IF the Action_Guard resolves a role code other than `ADMIN`, THEN THE Action_Guard SHALL raise an access-denied error, return control to the caller without executing the server action's mutation, and leave all persisted data unchanged.
4. IF the Action_Guard is invoked when no authenticated Admin session can be resolved, THEN THE Action_Guard SHALL raise an access-denied error, return control to the caller without executing the server action's mutation, and leave all persisted data unchanged.

### Requirement 9: Master Sets Access Level on Admin Creation

**User Story:** As a Master_Admin, I want to assign an access level when creating an admin, so that the admin's reach is correct from the start.

#### Acceptance Criteria

1. WHEN the Master_Admin submits a new admin with a selected Access_Level that is a member of the permitted Access_Level set, THE Admin_Management_Service SHALL create the Users_Table row with the selected Access_Level stored on that row.
2. WHEN the Admin_Management_Service successfully persists the new admin row, THE Admin_Management_Service SHALL return a success confirmation that includes the persisted Access_Level value.
3. IF the submitted Access_Level is not a member of the permitted Access_Level set, THEN THE Admin_Management_Service SHALL reject the creation request, SHALL NOT create any Users_Table row, and SHALL return an error indication identifying the Access_Level as invalid.
4. WHERE the Master_Admin does not change the access-level selector during submission, THE Admin_Management_Service SHALL persist the new admin's Access_Level as `inventory_operations`.
5. IF the submission omits the Access_Level value entirely, THEN THE Admin_Management_Service SHALL persist the new admin's Access_Level as `inventory_operations`.

### Requirement 10: Master Edits Access Level with Change Notification

**User Story:** As a Master_Admin, I want to change an existing admin's access level and have the admin notified, so that the admin learns their access changed.

#### Acceptance Criteria

1. WHEN the Master_Admin submits an edit with a selected Access_Level that is within the permitted Access_Level set and the target admin exists, THE Admin_Management_Service SHALL persist the resolved Access_Level on the target Users_Table row and return a success confirmation to the Master_Admin.
2. WHEN the resolved submitted Access_Level differs from the target admin's stored Access_Level and the persist operation completes successfully, THE Admin_Management_Service SHALL send exactly one access-level-changed notification to the target admin.
3. WHEN the resolved submitted Access_Level equals the target admin's stored Access_Level, THE Admin_Management_Service SHALL persist no change and send zero notifications.
4. IF the submitted Access_Level is outside the permitted Access_Level set, THEN THE Admin_Management_Service SHALL reject the edit request, leave the target admin's stored Access_Level unchanged, and return an error response indicating the Access_Level is invalid.
5. IF the target admin row does not exist in the Users_Table, THEN THE Admin_Management_Service SHALL reject the edit request, persist no change, and return an error response indicating the target admin was not found.
6. IF the persist operation fails after a valid edit is submitted, THEN THE Admin_Management_Service SHALL leave the target admin's stored Access_Level unchanged, send zero notifications, and return an error response indicating the change could not be saved.

### Requirement 11: Deliver the Access-Level-Changed Notification

**User Story:** As an admin, I want to be notified when my access level changes, so that I understand why my available areas changed.

#### Acceptance Criteria

1. WHEN the Admin_Management_Service sends an access-level-changed notification, THE Notification_Service SHALL set the notification's recipient to the edited admin's user id only, and SHALL exclude all other admin user ids from the recipient list.
2. WHEN the Admin_Management_Service sends an access-level-changed notification, THE Notification_Service SHALL include the new Access_Level label in the notification message as a non-empty text value.
3. IF the notification insert fails, THEN THE Notification_Service SHALL persist the access-level change, record the failure, and return successfully to the caller without raising an error.
4. IF the edited admin's user id is missing or does not match an existing admin, THEN THE Notification_Service SHALL persist the access-level change, skip sending the notification, record the failure, and return successfully to the caller without raising an error.

### Requirement 12: Display the Notification on the Landing Surface

**User Story:** As an admin, I want the access-level-changed notification visible on whichever surface I land on, so that I see it regardless of my access level.

#### Acceptance Criteria

1. WHEN a signed-in Admin lands on the operations surface, THE Admin_Navbar SHALL render a Notification_Bell wired with the signed-in Admin's user id.
2. WHEN the inventory Layout_Guard resolves the signed-in Admin's user id, THE Inventory_Header SHALL render a Notification_Bell wired with that resolved user id on the inventory surface.
3. WHEN an Admin lands on the route computed by the Landing_Router for the Admin's Access_Level, THE Admin_Portal SHALL present exactly one Notification_Bell wired with the signed-in Admin's user id.
4. IF the signed-in Admin's user id cannot be resolved on the landing surface, THEN THE Admin_Portal SHALL omit the Notification_Bell without blocking the rest of the surface from rendering.

### Requirement 13: Gate Navigation and Dashboard UI by Access Level

**User Story:** As an admin, I want to see only the areas I can use, so that the interface reflects my access level.

#### Acceptance Criteria

1. WHEN the Admin_Navbar renders for an Access_Level, THE Admin_Navbar SHALL display every navigation item whose Access_Area the Access_Level permits and every navigation item marked neutral, and SHALL omit every navigation item whose Access_Area the Access_Level does not permit.
2. WHEN the Executive_Dashboard renders for an Access_Level, THE Executive_Dashboard SHALL display every quick action and KPI card whose Access_Area the Access_Level permits, and SHALL omit every quick action and KPI card whose Access_Area the Access_Level does not permit.
3. WHILE the Access_Level is `inventory_operations`, THE Executive_Dashboard SHALL display the operations KPIs, the Warehouse Value KPI, and the Warehouse System quick action.
4. WHILE the Access_Level is `operations`, THE Executive_Dashboard SHALL display the operations KPIs and SHALL omit the Warehouse Value KPI and the Warehouse System quick action.
5. IF the Access_Level is missing, null, or not a recognized Access_Level value, THEN THE Admin_Navbar and THE Executive_Dashboard SHALL display only navigation items, quick actions, and KPI cards marked neutral, and SHALL omit all Access_Area-restricted items.

### Requirement 14: Master Surfaces Access Level in User Management

**User Story:** As a Master_Admin, I want to see and choose access levels in the user-management interface, so that I can manage them visually.

#### Acceptance Criteria

1. WHEN the Admin_Management_Service returns a list of admin users, THE Admin_Management_Service SHALL include the `admin_access_level` value for each admin user in the response.
2. WHEN the user-management table renders an admin row, THE Master_Portal SHALL display the human-readable label corresponding to that admin's resolved Access_Level, where each of the three Access_Level values maps to exactly one distinct label.
3. WHEN the Master_Admin opens a create dialog, THE Master_Portal SHALL present a selector listing all three Access_Level options.
4. WHEN the Master_Admin opens an edit dialog for an existing admin, THE Master_Portal SHALL present the selector listing all three Access_Level options with the admin's current resolved Access_Level pre-selected.

### Requirement 15: Preserve Behavior for Non-Admin Roles

**User Story:** As a platform operator, I want non-admin users unaffected by access levels, so that the feature changes nothing outside the ADMIN role.

#### Acceptance Criteria

1. WHEN a user whose role code is not `ADMIN` requests any route, THE Access_Gate SHALL produce a routing decision (granted destination or denied destination) identical to the decision produced for that same user, route, and session state when no `admin_access_level` value is set.
2. IF a user whose role code is not `ADMIN` has any non-null `admin_access_level` value present, THEN THE Access_Gate SHALL ignore that value and SHALL NOT alter the routing decision based on it.
3. THE Admin_Portal SHALL operate using only the set of roles that exist prior to the access-level feature, and SHALL NOT create, register, or require any additional role.
4. WHEN a non-`ADMIN` user accesses a resource governed by Row Level Security, THE Admin_Portal SHALL apply the same role-based RLS policies, granting and denying the same rows, as applied before the access-level feature was introduced.
