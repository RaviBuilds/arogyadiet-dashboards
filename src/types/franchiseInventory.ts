// src/types/franchiseInventory.ts
// TypeScript interfaces for the franchise inventory feature.
// (franchise-inventory spec — Task 1.1)
//
// These types model the finished-product-only franchise inventory: transfer
// lifecycle states, stock-out reasons, batch records, catalog products,
// incoming stock transfers, and the per-franchise audit ledger.
//
// Requirements validated: 2.4, 7.2, 10.1, 11.1, 11.2

import type { BaseUom } from "@/lib/inventory/product-schema";

/**
 * The lifecycle state of a franchise stock transfer.
 * Legal transitions: DISPATCHED → ACCEPTED → RECEIVED, or DISPATCHED → REJECTED.
 */
export type FranchiseTransferState =
  | "DISPATCHED"
  | "ACCEPTED"
  | "RECEIVED"
  | "REJECTED";

/**
 * Allowed reasons for recording a stock-out from franchise inventory.
 */
export type StockOutReason =
  | "MEAL_SUBSCRIPTION_SALE"
  | "KIT_SUBSCRIPTION_SALE"
  | "ONE_TIME_PURCHASE_SALE"
  | "SPOILED"
  | "DAMAGED"
  | "OTHER";

/**
 * A single batch within a franchise inventory or transfer, identified by its
 * batch number, quantity, and expiry date (ISO string).
 */
export interface FranchiseBatch {
  batchNumber: string;
  quantity: number;
  expiryDate: string;
}

/**
 * A finished product in the franchise catalog with its on-hand quantity and
 * batch breakdown. On-hand counts only ACTIVE lots (excludes in-transit).
 */
export interface FranchiseCatalogProduct {
  productId: string;
  name: string;
  imageUrl: string | null;
  baseUom: BaseUom;
  onHandQuantity: number;
  batches: FranchiseBatch[];
}

/**
 * A stock transfer record as seen by the franchise (incoming transfers).
 * Includes the per-batch breakdown (lines) and the originating kitchen source.
 */
export interface FranchiseStockTransfer {
  id: string;
  destFranchiseId: string;
  productId: string;
  productName: string;
  quantity: number;
  state: FranchiseTransferState;
  lines: FranchiseBatch[];
  dispatchedAt: string;
  sourceCentralKitchenId: string | null;
}

/**
 * A single entry in the per-franchise audit ledger. IN entries are created on
 * receipt of a transfer; OUT entries are created on stock-out recording.
 * Sorted newest-first with ties broken by descending insertion order (id).
 */
export interface FranchiseLedgerEntry {
  id: number;
  direction: "IN" | "OUT";
  productName: string;
  quantity: number;
  batchBreakdown: FranchiseBatch[];
  stockOutReason: StockOutReason | null;
  comment: string | null;
  sourceCentralKitchenId: string | null;
  occurredAt: string;
}
