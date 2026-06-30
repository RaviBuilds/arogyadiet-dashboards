import { create } from "zustand";

import type { StockOutReason } from "@/types/franchiseInventory";

/**
 * A single staged franchise outbound (dispatch / stock-out) item.
 * The franchise only dispatches stock OUT — incoming stock is automatic from
 * the central kitchen via Stock_Transfers.
 */
export type FranchiseOutboundCartItem = {
  id: string;
  productId: string;
  name: string;
  qty: number;
  /** Underlying stock-out reason persisted to the ledger. */
  reason: StockOutReason;
  /** Human-friendly destination label shown in the cart. */
  reasonLabel: string;
  /** Required when reason is OTHER. */
  comment?: string;
};

type FranchiseOutboundCartInput = Omit<FranchiseOutboundCartItem, "id">;

interface FranchiseInventoryStore {
  outboundCart: FranchiseOutboundCartItem[];
  addOutboundItem: (item: FranchiseOutboundCartInput) => void;
  removeOutboundItem: (id: string) => void;
  clearOutboundCart: () => void;
}

export const useFranchiseInventoryStore = create<FranchiseInventoryStore>(
  (set) => ({
    outboundCart: [],
    addOutboundItem: (item) =>
      set((state) => ({
        outboundCart: [
          ...state.outboundCart,
          { ...item, id: crypto.randomUUID() },
        ],
      })),
    removeOutboundItem: (id) =>
      set((state) => ({
        outboundCart: state.outboundCart.filter((item) => item.id !== id),
      })),
    clearOutboundCart: () => set({ outboundCart: [] }),
  }),
);

export function selectFranchiseOutboundCount(
  state: FranchiseInventoryStore,
): number {
  return state.outboundCart.length;
}

export function selectFranchiseOutboundUnits(
  state: FranchiseInventoryStore,
): number {
  return state.outboundCart.reduce((sum, item) => sum + item.qty, 0);
}
