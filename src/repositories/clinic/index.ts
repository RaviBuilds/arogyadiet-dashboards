// src/repositories/clinic/index.ts
// Barrel for the clinic-domain data-access layer (core-clinic-architecture).
// Repositories are data-access ONLY — no business validation, no 'use server'
// wrappers. Consumed by the master-portal and admin-portal Server Actions.

export * from "./businessRepository";
export * from "./cityRepository";
export * from "./kitchenRepository";
export * from "./clinicRepository";
export * from "./serviceAreaRepository";
export * from "./snapshotRepository";
