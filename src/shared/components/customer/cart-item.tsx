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
  const removeItemCompletely = useCartStore(
    (state) => state.removeItemCompletely,
  );

  const imageUrls =
    (item as CartItemType & { image_urls?: string[] | null }).image_urls ??
    item.image_url ??
    [];

  const bannerImageUrl =
    (item as CartItemType & { banner_image_url?: string | null }).banner_image_url ??
    null;

  const primaryImage = bannerImageUrl ?? imageUrls[0];
  const unitPrice = item.sale_price ?? item.original_price;

  const handleRemoveCompletely = () => {
    removeItemCompletely(item.id);
  };

  return (
    <article className="grid w-full grid-cols-[4rem_minmax(0,1fr)] gap-3 rounded-2xl border border-emerald-900/10 bg-white/90 p-3 shadow-sm ring-1 ring-inset ring-white/70 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-4 sm:p-4">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-emerald-900/10 bg-gradient-to-br from-emerald-50 via-white to-amber-50/50 p-1 sm:h-[4.5rem] sm:w-[4.5rem]">
        {primaryImage ? (
          <img
            src={primaryImage}
            alt={item.name}
            className="h-full w-full rounded-lg object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-center text-[10px] text-slate-400">
            No image
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-semibold leading-snug tracking-tight text-slate-900">
              {item.name}
            </p>
            <p className="mt-1 text-xs font-medium text-emerald-700">
              ₹{unitPrice.toFixed(2)} each
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-mr-1 -mt-1 h-8 w-8 shrink-0 rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600"
            onClick={handleRemoveCompletely}
            aria-label={`Remove ${item.name} from cart`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="inline-flex items-center rounded-full border border-emerald-900/10 bg-emerald-50/70 p-0.5 text-emerald-800">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 rounded-full hover:bg-white hover:text-emerald-900"
              onClick={() => removeItem(item.id)}
              aria-label={`Decrease ${item.name} quantity`}
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <span className="w-7 text-center text-sm font-semibold tabular-nums">
              {item.quantity}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 rounded-full hover:bg-white hover:text-emerald-900"
              onClick={() => addItem(item)}
              disabled={!item.in_stock}
              aria-label={`Increase ${item.name} quantity`}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
            ₹{(unitPrice * item.quantity).toFixed(2)}
          </p>
        </div>
      </div>
    </article>
  );
}
