import { create } from "zustand";

import {
  type DispatchStockReason,
  type InventorySourceType,
} from "@/lib/inventory/product-schema";

export type InboundCartItem = {
  id: string;
  productId: string;
  name: string;
  qty: number;
  cost: number;
  expiry?: string;
  sourceType: InventorySourceType;
  sourceName?: string;
  purchaseOrderFile?: File;
};

export type OutboundCartItem = {
  id: string;
  productId: string;
  name: string;
  qty: number;
  reason: DispatchStockReason;
};

type InboundCartInput = Omit<InboundCartItem, "id">;
type OutboundCartInput = Omit<OutboundCartItem, "id">;

interface InventoryStore {
  inboundCart: InboundCartItem[];
  outboundCart: OutboundCartItem[];
  addInboundItem: (item: InboundCartInput) => void;
  removeInboundItem: (id: string) => void;
  addOutboundItem: (item: OutboundCartInput) => void;
  removeOutboundItem: (id: string) => void;
  clearInboundCart: () => void;
  clearOutboundCart: () => void;
  clearCarts: () => void;
}

export const useInventoryStore = create<InventoryStore>((set) => ({
  inboundCart: [],
  outboundCart: [],
  addInboundItem: (item) =>
    set((state) => ({
      inboundCart: [
        ...state.inboundCart,
        { ...item, id: crypto.randomUUID() },
      ],
    })),
  removeInboundItem: (id) =>
    set((state) => ({
      inboundCart: state.inboundCart.filter((item) => item.id !== id),
    })),
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
  clearInboundCart: () => set({ inboundCart: [] }),
  clearOutboundCart: () => set({ outboundCart: [] }),
  clearCarts: () => set({ inboundCart: [], outboundCart: [] }),
}));

export function selectTotalCartCount(state: InventoryStore): number {
  return state.inboundCart.length + state.outboundCart.length;
}

export function selectInboundBatchCost(state: InventoryStore): number {
  return state.inboundCart.reduce((sum, item) => sum + item.cost, 0);
}
