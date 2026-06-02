"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import {
  fetchUnavailableCartItemIds,
  getOutOfStockCartItemIds,
} from "@/lib/cart/sync-cart-stock";
import { useCartStore } from "@/store/useCartStore";
import { Product } from "@/types/product";

function notifyRemovedItems(count: number) {
  if (count === 1) {
    toast.info("An out-of-stock item was removed from your cart.");
    return;
  }

  toast.info(`${count} out-of-stock items were removed from your cart.`);
}

export function useSyncCartStockFromProducts(
  products: Pick<Product, "id" | "in_stock">[],
) {
  const items = useCartStore((state) => state.items);
  const removeOutOfStockItems = useCartStore(
    (state) => state.removeOutOfStockItems,
  );

  useEffect(() => {
    const unavailableIds = getOutOfStockCartItemIds(items, products);
    if (unavailableIds.length === 0) {
      return;
    }

    removeOutOfStockItems(unavailableIds);
    notifyRemovedItems(unavailableIds.length);
  }, [products, items, removeOutOfStockItems]);
}

export function useSyncCartStockFromServer(enabled: boolean) {
  const removeOutOfStockItems = useCartStore(
    (state) => state.removeOutOfStockItems,
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let isCancelled = false;

    const syncCartStock = async () => {
      const currentItems = useCartStore.getState().items;
      if (currentItems.length === 0) {
        return;
      }

      try {
        const unavailableIds = await fetchUnavailableCartItemIds(
          currentItems.map((item) => item.id),
        );

        if (isCancelled || unavailableIds.length === 0) {
          return;
        }

        removeOutOfStockItems(unavailableIds);
        notifyRemovedItems(unavailableIds.length);
      } catch (error) {
        if (!isCancelled) {
          console.error("Failed to sync cart stock:", error);
        }
      }
    };

    void syncCartStock();

    return () => {
      isCancelled = true;
    };
  }, [enabled, removeOutOfStockItems]);
}
