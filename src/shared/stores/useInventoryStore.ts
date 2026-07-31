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

/**
 * A pending Stock_In line held in the Shop_Products_Cart
 * (clinic-scoped-shop-inventory spec, Requirement 7). Isolated from
 * `OperationsCart` (`inboundCart`/`outboundCart`) — this slice backs the
 * outbound-only warehouse-to-clinic stock-in flow, not the existing
 * inbound/outbound franchise dispatch carts.
 */
export type ShopStockInLine = {
  id: string;
  clinicId: string;
  productId: string;
  name: string;
  qty: number;
};

interface InventoryStore {
  inboundCart: InboundCartItem[];
  outboundCart: OutboundCartItem[];
  /** Package images attached to franchise dispatch batch (max 10) */
  franchisePackageImages: File[];
  /** Pending Stock_In lines for the warehouse-to-clinic Shop_Products_Cart. */
  shopStockInCart: ShopStockInLine[];
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
  /**
   * Add a pending Stock_In line, keeping exactly one line per
   * (clinicId, productId) pair — a repeat entry replaces that pair's line in
   * place (newest quantity wins) rather than appending a duplicate. Mirrors
   * `mergeStockInLine` in `src/lib/shop/clinicStock.ts`. (Req 7.3, 7.4)
   */
  addShopStockInLine: (line: Omit<ShopStockInLine, "id">) => void;
  removeShopStockInLine: (clinicId: string, productId: string) => void;
  clearShopStockInCart: () => void;
}

export const useInventoryStore = create<InventoryStore>((set) => ({
  inboundCart: [],
  outboundCart: [],
  franchisePackageImages: [],
  shopStockInCart: [],
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
  addShopStockInLine: (line) =>
    set((state) => {
      const incoming: ShopStockInLine = { ...line, id: crypto.randomUUID() };
      const index = state.shopStockInCart.findIndex(
        (existing) =>
          existing.clinicId === incoming.clinicId &&
          existing.productId === incoming.productId,
      );

      if (index === -1) {
        return { shopStockInCart: [...state.shopStockInCart, incoming] };
      }

      const updated = [...state.shopStockInCart];
      // Keep the existing line's id and position; the newest quantity wins.
      updated[index] = { ...incoming, id: updated[index].id };
      return { shopStockInCart: updated };
    }),
  removeShopStockInLine: (clinicId, productId) =>
    set((state) => ({
      shopStockInCart: state.shopStockInCart.filter(
        (line) => !(line.clinicId === clinicId && line.productId === productId),
      ),
    })),
  clearShopStockInCart: () => set({ shopStockInCart: [] }),
}));

export function selectTotalCartCount(state: InventoryStore): number {
  return state.inboundCart.length + state.outboundCart.length;
}

export function selectHasFranchiseItems(state: InventoryStore): boolean {
  return state.outboundCart.some((item) => !!item.franchiseId);
}
