# Security and RBAC Questions

**1. Describe the authorization layers.**
Middleware (role ↔ subdomain, path gate) → layout re-check → page guard (`guardAdminGroup`, `guardCustomersWorkspace`) → action gate (`checkGroupManage`, `checkFranchiseGroupManage`, `resolveScope`) + tenancy (`guardProfile`) → DB (RPC ownership checks, RLS for session client). `06`.

**2. Why duplicate checks?**
Middleware doesn't run for `/api` and can be bypassed by matcher gaps; layouts persist across navigations; actions are public POST endpoints; tenancy differs from permission.

**3. How are manage/view permissions stored and enforced?**
`users.admin_access_level` + `admin_operations_access` JSONB `{group: "manage"|"view"}`; `hasGroupAccess` for read, `canManageGroup` for write; errors distinguish read-only vs no access.

**4. What happens with a NULL access level?**
Treated as full access (`DEFAULT_ACCESS_LEVEL = "inventory_operations"`) for backward compatibility. Risk acknowledged; master UI always sets one.

**5. How do dietitians fit?**
`ADMIN`/`FRANCHISE_ADMIN` with level `dietitian`; allow-list of paths; read-only Customer 360; SQL `dietitian_can_read_customer` + TS scope requiring `customer_profiles.dietitian_id = me`.

**6. How do you stop franchise A reading franchise B?**
Scope from session, explicit `franchise_id` filters, RPC re-checks, row ownership guards. Client-supplied franchise ids are ignored in newer actions.

**7. Is the Supabase anon key a secret?**
No, it's public by design; security depends on RLS and EXECUTE grants. That's why ungranted SECURITY DEFINER functions are risky.

**8. How do you protect cron routes and webhooks?**
Cron: shared secret (better: header + Vault). Webhook: HMAC-SHA256 of raw body with webhook secret; idempotent processing.

**9. How do you secure PIN login?**
bcrypt cost 10, constant-time compare, per-mobile throttle (5/15 min), eligibility gate with generic messages, PIN never logged. Known gap: `setPermanentPinAction` needs a temp-PIN proof token.

**10. What's the risk of a shared customer server password?**
Single secret unlocks every customer account via Supabase Auth; better per-user random credentials or server-minted sessions.

**11. What did your audit find? (be ready — this is a strength)**
Unauthenticated `/api/reset-franchise-password` and `/api/migrate/*`; Server Actions without gates (admin user CRUD, PIN reset, finance, franchise rider onboarding); hard-coded cron secret in SQL; SECURITY DEFINER EXECUTE grants; temp-PIN takeover path. Plan: delete/gate, rotate, revoke, add static gate test.

**12. Why does `assertGroupManage` reject non-ADMIN roles even for a shared component?**
Because `Customer360Dashboard` imports admin actions into the franchise bundle; without the role check a franchise user could call admin actions on core customers.

**13. How is the franchise owner handled?**
`franchises.owner_user_id === users.id` → full access config, applied identically in middleware, layout and `resolveFranchiseAccessContext`.

**14. How are suspended franchises blocked?**
Middleware and layout check `franchises.status === "suspended"` → `/unauthorized`.

**15. Clinic-scoped admins?**
`users.admin_clinic_id` with level `operations`; allowed groups limited; `resolveReadableClinicId` confines reads; trigger ensures clinic is core.

**16. How do you avoid secrets in the client bundle and APK?**
Only `NEXT_PUBLIC_*` values reach the browser; native uploader uses anon key; `scripts/verify-apk-secrets.*` and `docs/capacitor-build-security-audit.md`.

**17. How is the APK download protected?**
Turnstile verification before rate-limit claim, hashed IPs, short-lived signed Storage URLs.

**18. CSRF on Server Actions?**
Next.js Server Actions are POST-only and compare `Origin` with `Host` by default (framework behaviour, not code in this repo). Route handlers like the webhook rely on signatures instead.

**19. What would you add for audit logging?**
`logAdminAction` exists (`admin_activity_logs`); extend to every privileged action via the gate wrapper; include actor, before/after.

**20. Sensitive data at rest?**
Medical documents in Storage (`medical_records`) via signed URLs; PIN hashes only; placeholder emails flagged and hidden.
