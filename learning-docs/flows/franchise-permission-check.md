# Flow: Franchise Permission Check (end to end)

Example: a franchise user with `admin_access_level = "operations"` and `admin_operations_access = { customers: "view", riders: "manage" }` opens a customer and tries to edit it.

Files: `src/middleware.ts` → `src/lib/auth/adminAccessCore.ts` (`resolveAccessConfiguration`, `toCanonicalPath`, `isPortalPathAllowed`, `hasGroupAccess`, `canManageGroup`) → `src/app/franchise/(main)/layout.tsx` → `src/app/franchise/(main)/customers/[id]/page.tsx` (`guardFranchiseCustomersWorkspace`) → `src/actions/franchise-actions/franchiseCustomerManagementActions.ts` (`guardCustomersWrite`, `guardProfile`) → `src/lib/auth/adminAccess.ts` (`resolveFranchiseAccessContext`, `checkFranchiseGroupManage`) → `src/services/customerManagementCore.ts`.

```mermaid
flowchart TD
  A["GET franchies.*/customers/123"] --> B["middleware: role FRANCHISE_ADMIN, franchise active"]
  B --> C["owner? no -> config = {level: operations, groups: {customers: view, riders: manage}}"]
  C --> D["toCanonicalPath('/franchise/customers/123') -> '/admin/customers/123'"]
  D --> E["classify: operations area, group customers"]
  E --> F{"hasGroupAccess(config, customers)?"}
  F -- "view -> yes" --> G["layout re-check with x-portal-pathname -> allowed"]
  G --> H["page guardFranchiseCustomersWorkspace() -> read-only UI (no manage)"]
  H --> I["user clicks Save anyway (or POSTs the action directly)"]
  I --> J["franchiseUpdateCustomerBasicInfo(profileId, data)"]
  J --> K["guardProfile -> guardCustomersWrite -> checkFranchiseGroupManage('customers')"]
  K --> L["resolveFranchiseAccessContext(): session, FRANCHISE_ADMIN, franchise, not suspended, owner override"]
  L --> M{"canManageGroup(config, customers)?"}
  M -- "no (view)" --> N["return 'You have read-only access to this section.'"]
  M -- yes --> O["load customer_profiles.franchise_id"]
  O --> P{"== caller franchise?"}
  P -- no --> Q["error: not your franchise"]
  P -- yes --> R["customerManagementCore update (service role)"]
```

Takeaways:
1. **Path gate** (middleware + layout) decides reachability.
2. **Page guard** decides read-only vs editable rendering.
3. **Action gate** decides permission (manage vs view).
4. **Tenancy guard** decides ownership of the specific row.
5. The franchise owner (`franchises.owner_user_id`) skips 1–3 restrictions (full access) but not 4.
