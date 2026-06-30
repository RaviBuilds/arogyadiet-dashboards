// src/validations/franchiseInventory.ts
// Zod schemas for the franchise-inventory feature (franchise-inventory spec — Task 1.2).
//
// These guard the franchise Server Actions (`franchiseInventoryActions.ts`) and
// the admin dispatch action (`franchiseDispatchActions.ts`). Each schema is
// validated at the action layer before delegating to the service/RPC.
//
// Requirements validated: 6.6, 10.1, 10.4, 10.5, 10.6

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Stock-Out Reason enum (Requirement 10.1)
// ─────────────────────────────────────────────────────────────────────────────

export const STOCK_OUT_REASONS = [
  "MEAL_SUBSCRIPTION_SALE",
  "KIT_SUBSCRIPTION_SALE",
  "ONE_TIME_PURCHASE_SALE",
  "SPOILED",
  "DAMAGED",
  "OTHER",
] as const;

export const stockOutReasonSchema = z.enum(STOCK_OUT_REASONS);

// ─────────────────────────────────────────────────────────────────────────────
// Stock-Out Input (Requirements 10.1, 10.4, 10.5, 10.6)
//
// - reason: one of the allowed Stock_Out_Reason values
// - quantity: a positive whole number (integer > 0)
// - product_id: the finished product being depleted
// - comment: required (1–500 chars) when reason is OTHER; optional otherwise
// ─────────────────────────────────────────────────────────────────────────────

export const stockOutInputSchema = z
  .object({
    product_id: z.string().uuid("Invalid product ID"),
    reason: stockOutReasonSchema,
    quantity: z
      .number()
      .int("Quantity must be a whole number")
      .positive("Quantity must be greater than 0"),
    comment: z
      .string()
      .min(1, "Comment is required when reason is OTHER")
      .max(500, "Comment cannot exceed 500 characters")
      .nullable()
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.reason === "OTHER") {
      if (!data.comment || data.comment.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Comment is required when reason is OTHER",
          path: ["comment"],
        });
      }
    }
  });

export type StockOutInput = z.infer<typeof stockOutInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch-to-Franchise Input (Requirements 6.6)
//
// - dest_franchise_id: UUID of the active destination franchise
// - product_id: UUID of the finished product to dispatch
// - quantity: a positive number (> 0)
// ─────────────────────────────────────────────────────────────────────────────

export const dispatchToFranchiseInputSchema = z.object({
  dest_franchise_id: z.string().uuid("Invalid destination franchise ID"),
  product_id: z.string().uuid("Invalid product ID"),
  quantity: z.number().positive("Quantity must be greater than 0"),
});

export type DispatchToFranchiseInput = z.infer<typeof dispatchToFranchiseInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Transfer Action Inputs (Accept / Reject / Receive)
//
// Each transfer action requires the transfer ID and the franchise ID (used for
// authorization — the action layer overrides this with scope.franchise_id).
// ─────────────────────────────────────────────────────────────────────────────

export const transferActionInputSchema = z.object({
  transfer_id: z.string().uuid("Invalid transfer ID"),
  franchise_id: z.string().uuid("Invalid franchise ID"),
});

export type TransferActionInput = z.infer<typeof transferActionInputSchema>;
