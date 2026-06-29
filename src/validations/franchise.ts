// src/validations/franchise.ts
// Zod schemas for the multi-tenant franchise hierarchy
// (multi-tenant-franchise spec — Task 2.2).
//
// Hierarchy: Business (type 'Franchise') → City → Group → Kitchen → Franchise →
// Clinic. These guard the form layer (React Hook Form + Zod) and the
// master/admin/franchise Server Actions. They are the franchise-side companion
// to `src/validations/clinic.ts` and REUSE the core-clinic schemas rather than
// duplicating them (e.g. `clinicCreateSchema` is extended for franchise clinics).
//
// Field names mirror the additive SQL schema (snake_case), matching
// `src/types/franchise.ts` and the rest of `src/validations/`.

import { z } from "zod";
import { clinicCreateSchema } from "@/validations/clinic";

/**
 * Franchise City input (Requirement 1.2): a trimmed name 1..100 and a required
 * owning Franchise Business reference. Mirrors the core-clinic `citySchema`
 * bounds and adds the `business_id` scope carried by `FranchiseCity`.
 */
export const franchiseCitySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "City name is required")
    .max(100, "City name cannot exceed 100 characters"),
  business_id: z.string().uuid("Invalid business ID"),
});

export type FranchiseCitySchemaInput = z.infer<typeof franchiseCitySchema>;

/**
 * Group input (Requirement 2.6): a trimmed name 1..100 and a required City
 * reference. The Group owns exactly one Kitchen at the DB level, so no
 * `kitchen_id` is collected here.
 */
export const groupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Group name is required")
    .max(100, "Group name cannot exceed 100 characters"),
  city_id: z.string().uuid("Invalid city ID"),
});

export type GroupSchemaInput = z.infer<typeof groupSchema>;

/**
 * Franchise input (Requirement 3.6): a trimmed name 1..100, a required Group
 * reference (Kitchen resolved via the Group), and a required FRANCHISE_ADMIN
 * owner. `status` is optional on create (the franchise is persisted as
 * `onboarding` by default).
 */
export const franchiseSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Franchise name is required")
    .max(100, "Franchise name cannot exceed 100 characters"),
  group_id: z.string().uuid("Invalid group ID"),
  owner_user_id: z.string().uuid("Invalid owner user ID"),
  status: z.enum(["onboarding", "active", "suspended"]).optional(),
});

export type FranchiseSchemaInput = z.infer<typeof franchiseSchema>;

/**
 * Franchise Clinic input (Requirement 6.4). Reuses the core-clinic
 * `clinicCreateSchema` (name 1..120, address 1..255, latitude -90..90 inclusive,
 * longitude -180..180 inclusive) — the geographic routing origin always lives on
 * the Clinic — and narrows the tenant reference: a franchise clinic always
 * carries a non-null `franchise_id`. The Kitchen is resolved via the Franchise's
 * Group, so no `kitchen_id` is collected here.
 */
export const franchiseClinicSchema = clinicCreateSchema
  .omit({ kitchen_id: true })
  .extend({
    franchise_id: z.string().uuid("Invalid franchise ID"),
  });

export type FranchiseClinicSchemaInput = z.infer<typeof franchiseClinicSchema>;

/**
 * Franchise agreement document metadata (Requirements 7.8). The file lives in a
 * private bucket; only this metadata is validated here.
 *   - content_type: one of application/pdf, image/jpeg, image/png
 *   - size_bytes: a positive integer up to 10 MB (10,485,760 bytes)
 *   - file_name: non-empty
 */
export const agreementDocMetaSchema = z.object({
  content_type: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  size_bytes: z
    .number()
    .int("File size must be a whole number of bytes")
    .positive("File size must be greater than 0")
    .max(10_485_760, "File size cannot exceed 10 MB"),
  file_name: z
    .string()
    .trim()
    .min(1, "File name is required"),
});

export type AgreementDocMetaSchemaInput = z.infer<typeof agreementDocMetaSchema>;

/**
 * Stock transfer input (Requirements 19.4). The source may be Core or another
 * Franchise; `source_franchise_id` is nullable but REQUIRED when
 * `source_kind === 'FRANCHISE'` and must be absent/null when the source is Core.
 *   - source_kind: 'CORE' | 'FRANCHISE'
 *   - source_franchise_id: uuid, nullable (see refinement)
 *   - dest_franchise_id: uuid
 *   - product_id: uuid
 *   - quantity: > 0
 */
export const stockTransferSchema = z
  .object({
    source_kind: z.enum(["CORE", "FRANCHISE"]),
    source_franchise_id: z
      .string()
      .uuid("Invalid source franchise ID")
      .nullable(),
    dest_franchise_id: z.string().uuid("Invalid destination franchise ID"),
    product_id: z.string().uuid("Invalid product ID"),
    quantity: z.number().positive("Quantity must be greater than 0"),
  })
  .superRefine((data, ctx) => {
    if (data.source_kind === "FRANCHISE" && data.source_franchise_id == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "source_franchise_id is required when the source is a franchise",
        path: ["source_franchise_id"],
      });
    }
    if (data.source_kind === "CORE" && data.source_franchise_id != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "source_franchise_id must be null when the source is Core",
        path: ["source_franchise_id"],
      });
    }
  });

export type StockTransferSchemaInput = z.infer<typeof stockTransferSchema>;
