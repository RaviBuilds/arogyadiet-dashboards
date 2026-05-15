"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { CartItem as CartItemType } from "@/types/product";
import { Button } from "@/shared/components/ui/button";

interface CartItemProps {
  item: CartItemType;
}

export function CartItem({ item }: CartItemProps) {
  const addItem = useCartStore((state) => state.addItem);
  const removeItem = useCartStore((state) => state.removeItem);

  const imageUrls =
    (item as CartItemType & { image_urls?: string[] | null }).image_urls ??
    item.image_url ??
    [];

  const primaryImage = imageUrls[0];
  const unitPrice = item.sale_price ?? item.original_price;

  const handleRemoveCompletely = () => {
    for (let i = 0; i < item.quantity; i += 1) {
      removeItem(item.id);
    }
  };

  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 sm:gap-3 border rounded-lg p-2 sm:p-3 w-full max-w-full box-border bg-white">
      {/* Column 1: Image (auto width) */}
      <div className="h-12 w-12 sm:h-14 sm:w-14 shrink-0 overflow-hidden rounded-md bg-muted">
        {primaryImage ? (
          <img
            src={primaryImage}
            alt={item.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground text-center">
            No image
          </div>
        )}
      </div>

      {/* Column 2: Text (1fr - strictly absorbs remaining space) */}
      <div className="min-w-0 overflow-hidden pr-1">
        <p className="truncate text-sm font-medium">{item.name}</p>
        <p className="text-xs text-muted-foreground">₹{unitPrice.toFixed(2)}</p>
      </div>

      {/* Column 3: Actions (auto width) */}
      <div className="flex items-center gap-1 sm:gap-2 justify-end">
        {/* Quantity Controls */}
        <div className="flex items-center gap-1 rounded-md border px-1 py-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => removeItem(item.id)}
          >
            <Minus className="h-3 sm:h-3.5 w-3 sm:w-3.5" />
          </Button>
          <span className="w-4 sm:w-6 text-center text-xs sm:text-sm font-medium">
            {item.quantity}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => addItem(item)}
          >
            <Plus className="h-3 sm:h-3.5 w-3 sm:w-3.5" />
          </Button>
        </div>

        {/* Trash Button */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 sm:h-8 sm:w-8 p-0 text-muted-foreground hover:text-destructive shrink-0"
          onClick={handleRemoveCompletely}
        >
          <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </Button>
      </div>
    </div>
  );
}
