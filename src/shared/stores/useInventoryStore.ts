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
  /** When dispatching to a franchise, stores the franchise ID */
  franchiseId?: string;
  /** Human-friendly franchise name for display in the cart */
  franchiseName?: string;
};

type InboundCartInput = Omit<InboundCartItem, "id">;
type OutboundCartInput = Omit<OutboundCartItem, "id">;

interface InventoryStore {
  inboundCart: InboundCartItem[];
  outboundCart: OutboundCartItem[];
  /** Package images attached to franchise dispatch batch (max 10) */
  franchisePackageImages: File[];
  addInboundItem: (item: InboundCartInput) => void;
  removeInboundItem: (id: string) => void;
  addOutboundItem: (item: OutboundCartInput) => void;
  removeOutboundItem: (id: string) => void;
  addFranchisePackageImage: (file: File) => void;
  removeFranchisePackageImage: (index: number) => void;
  clearFranchisePackageImages: () => void;
  clearInboundCart: () => void;
  clearOutboundCart: () => void;
  clearCarts: () => void;
}

export const useInventoryStore = create<InventoryStore>((set) => ({
  inboundCart: [],
  outboundCart: [],
  franchisePackageImages: [],
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
  addFranchisePackageImage: (file) =>
    set((state) => {
      if (state.franchisePackageImages.length >= 10) return state;
      return { franchisePackageImages: [...state.franchisePackageImages, file] };
    }),
  removeFranchisePackageImage: (index) =>
    set((state) => ({
      franchisePackageImages: state.franchisePackageImages.filter(
        (_, i) => i !== index,
      ),
    })),
  clearFranchisePackageImages: () => set({ franchisePackageImages: [] }),
  clearInboundCart: () => set({ inboundCart: [] }),
  clearOutboundCart: () => set({ outboundCart: [], franchisePackageImages: [] }),
  clearCarts: () => set({ inboundCart: [], outboundCart: [], franchisePackageImages: [] }),
}));

export function selectTotalCartCount(state: InventoryStore): number {
  return state.inboundCart.length + state.outboundCart.length;
}

export function selectHasFranchiseItems(state: InventoryStore): boolean {
  return state.outboundCart.some((item) => !!item.franchiseId);
}
