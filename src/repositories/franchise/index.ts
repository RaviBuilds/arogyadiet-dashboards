// src/repositories/franchise/index.ts
// Barrel for the franchise-hierarchy data-access layer (multi-tenant-franchise
// — Task 3.4). Repositories are data-access ONLY — no business validation, no
// 'use server' wrappers. All access uses the service-role admin client
// (createAdminClient) and applies `applyScope` where a franchise Scope is in
// play (warehouse stock, Req 19.6). Consumed by the master-portal / franchise
// Server Actions.

export * from "./cityRepository";
export * from "./groupRepository";
export * from "./franchiseRepository";
export * from "./franchiseClinicRepository";
export * from "./agreementDocRepository";
export * from "./warehouseRepository";
