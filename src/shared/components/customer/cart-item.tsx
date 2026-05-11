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
    <div className="flex w-full items-center gap-3 border rounded-lg p-3 box-border bg-white">
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
        {primaryImage ? (
          <img
            src={primaryImage}
            alt={item.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
            No image
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="w-full">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <p className="text-xs text-muted-foreground">
            ₹{unitPrice.toFixed(2)}
          </p>
        </div>

        <div className="flex flex-row w-full justify-between">
          <div className="flex items-center gap-1 rounded-md border px-1 py-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => removeItem(item.id)}
              aria-label={`Decrease quantity of ${item.name}`}
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <span className="w-6 text-center text-sm font-medium">
              {item.quantity}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => addItem(item)}
              aria-label={`Increase quantity of ${item.name}`}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={handleRemoveCompletely}
            aria-label={`Remove ${item.name} from cart`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
