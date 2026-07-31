// src/validations/clinicShopInventory.ts
// Zod schemas for the per-clinic shop stock overlay, its ledger movements, and
// the clinic-level access assignment (clinic-scoped-shop-inventory spec —
// Task 2.2).
//
// These guard the server-action layer (`clinicShopInventoryActions.ts`,
// `inventoryActions.ts`, `master-actions/adminActions.ts`) and the client forms
// that feed it. Bounds mirror the database exactly: `clinic_product_settings`
// holds a stock level in 0..1,000,000, `clinic_product_ledger` holds a movement
// quantity in 1..1,000,000, and both are whole numbers.
//
// The pure equivalents in `src/lib/shop/clinicStock.ts`
// (`validateStockLevel` / `validateMovementQuantity`) remain the canonical
// rejection-cause classifiers used by the decision layer; these schemas carry
// the user-facing wording each requirement specifies.
//
// Requirements validated: 1.5, 1.7, 1.8, 2.2, 2.3, 7.13, 10.7, 13.11

import { z } from "zod";

import { STOCK_QUANTITY_MAXIMUM } from "@/lib/shop/clinicStock";
import {
  CLINIC_SCOPED_GROUPS,
  PERMISSION_LEVELS,
} from "@/lib/auth/adminAccessCore";

// ─────────────────────────────────────────────────────────────────────────────
// Quantity bounds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A stored clinic shop stock level: a whole number in 0..1,000,000 inclusive.
 * Mirrors the `stock_quantity` CHECK on `clinic_product_settings`.
 *
 * The whole-number wording is passed to `z.number()` as well as to `.int()`,
 * because Zod fails the type-level check for a non-number, `NaN` or either
 * infinity and never reaches `.int()`. Without it those inputs would carry
 * Zod's default text ("Invalid input: expected number, received boolean")
 * instead of the wording Requirement 1.8 asks for. An integer above the cap
 * still reaches `.max()` and so still states the maximum stock quantity.
 * (Req 1.5, 1.6, 1.7, 1.8, 18.8)
 */
const STOCK_QUANTITY_WHOLE_NUMBER_MESSAGE =
  "Stock quantity must be a whole number";

export const clinicStockQuantitySchema = z
  .number(STOCK_QUANTITY_WHOLE_NUMBER_MESSAGE)
  .int(STOCK_QUANTITY_WHOLE_NUMBER_MESSAGE)
  .min(0, "Stock quantity cannot go below 0")
  .max(
    STOCK_QUANTITY_MAXIMUM,
    "Stock quantity cannot exceed the maximum stock quantity of 1,000,000",
  );

/**
 * A single stock movement quantity: a whole number in 1..1,000,000 inclusive.
 * Mirrors the `quantity` CHECK on `clinic_product_ledger`, and carries the
 * wording Requirements 2.3, 7.13, 10.7, 17.4 and 18.7 ask for on *every*
 * rejected submission — the message is given to the type-level check too, so a
 * string, a boolean, `null`, `NaN` or an infinity is told the range rule rather
 * than Zod's default "expected number, received …" text.
 * (Req 2.2, 2.3, 7.13, 10.7, 17.4, 18.7)
 */
const MOVEMENT_QUANTITY_MESSAGE =
  "Quantity must be a whole number between 1 and 1,000,000";

export const movementQuantitySchema = z
  .number(MOVEMENT_QUANTITY_MESSAGE)
  .int(MOVEMENT_QUANTITY_MESSAGE)
  .min(1, MOVEMENT_QUANTITY_MESSAGE)
  .max(STOCK_QUANTITY_MAXIMUM, MOVEMENT_QUANTITY_MESSAGE);

// ─────────────────────────────────────────────────────────────────────────────
// Stock In (Requirement 7)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One pending Stock_In line. The destination clinic lives on the submission
 * rather than the line, because a submission always targets exactly one Core
 * Clinic. (Req 7.1, 7.13)
 */
export const stockInLineSchema = z.object({
  productId: z.string().uuid("Invalid product ID"),
  quantity: movementQuantitySchema,
});

export type StockInLineInput = z.infer<typeof stockInLineSchema>;

/**
 * A whole Shop_Products_Cart submission: one destination Core Clinic and at
 * least one pending line. Every line is validated before the action reaches the
 * RPC, so a malformed submission never starts a transaction. (Req 7.6, 7.12)
 */
export const stockInSubmissionSchema = z.object({
  clinicId: z.string().uuid("Invalid clinic ID"),
  lines: z
    .array(stockInLineSchema)
    .min(1, "Add at least one stock-in line before submitting"),
});

export type StockInSubmissionInput = z.infer<typeof stockInSubmissionSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Per-clinic visibility (Requirement 6)
// ─────────────────────────────────────────────────────────────────────────────

/** A Clinic_Visibility toggle for one (clinic, product) pair. (Req 6.2, 6.4) */
export const clinicVisibilitySchema = z.object({
  clinicId: z.string().uuid("Invalid clinic ID"),
  productId: z.string().uuid("Invalid product ID"),
  isVisible: z.boolean(),
});

export type ClinicVisibilityInput = z.infer<typeof clinicVisibilitySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Master Catalog product link (Requirement 3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A Product_Link change: `inventoryProductId` is `null` to leave the Shop
 * Product unlinked. Existence of the referenced Master Catalog Product and the
 * zero-aggregate-stock restriction are enforced in the action, not here.
 * (Req 3.1, 3.7, 3.8)
 */
export const productInventoryLinkSchema = z.object({
  productId: z.string().uuid("Invalid product ID"),
  inventoryProductId: z
    .string()
    .uuid("Invalid Master Catalog Product ID")
    .nullable(),
});

export type ProductInventoryLinkInput = z.infer<
  typeof productInventoryLinkSchema
>;

// ─────────────────────────────────────────────────────────────────────────────
// Clinic level access assignment (Requirement 13)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A clinic level access submission from the User_Management_Form: the checkbox
 * state, the selected Core Clinic, and the per-group permission levels.
 *
 * A checked checkbox requires a clinic (Req 13.11); an unchecked checkbox
 * clears the assignment (Req 13.16). Clinic existence and the Core-Clinic-only
 * rule (Req 13.12), the access-level rule (Req 13.14), and the group
 * restriction (Req 13.13) are enforced in `createAdminUser` / `updateAdminUser`
 * via `validateClinicScopeAssignment`.
 */
export const clinicScopeAssignmentSchema = z
  .object({
    clinicAccess: z.boolean(),
    clinicId: z.string().uuid("Invalid clinic ID").nullable(),
    groups: z.partialRecord(
      z.enum(CLINIC_SCOPED_GROUPS),
      z.enum(PERMISSION_LEVELS),
    ),
  })
  .superRefine((data, ctx) => {
    if (data.clinicAccess && !data.clinicId) {
      ctx.addIssue({
        code: "custom",
        message: "A clinic must be selected for clinic level access",
        path: ["clinicId"],
      });
    }
  });

export type ClinicScopeAssignmentInput = z.infer<
  typeof clinicScopeAssignmentSchema
>;
