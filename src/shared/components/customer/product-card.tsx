"use client";

import { Product } from "@/types/product";
import { useCartStore } from "@/store/useCartStore";
import { Minus, Plus } from "lucide-react";

interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  const items = useCartStore((state) => state.items);
  const addItem = useCartStore((state) => state.addItem);
  const removeItem = useCartStore((state) => state.removeItem);
  const cartItem = items.find((item) => item.id === product.id);
  const isOutOfStock = !product.in_stock;

  const isOnSale =
    typeof product.sale_price === "number" &&
    product.sale_price < product.original_price;

  const imageUrls =
    (product as Product & { image_urls?: string[] | null }).image_urls ??
    product.image_url ??
    [];

  const primaryImage = imageUrls[0];

  return (
    <article
      className={`overflow-hidden rounded-xl border border-zinc-200 bg-white transition-shadow duration-200 ${
        isOutOfStock ? "opacity-75" : "hover:shadow-md"
      }`}
    >
      <div className="relative aspect-[4/3] w-full bg-zinc-100">
        {primaryImage ? (
          <img
            src={primaryImage}
            alt={product.name}
            className={`h-full w-full object-cover ${
              isOutOfStock ? "grayscale" : ""
            }`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-zinc-500">
            No image
          </div>
        )}

        {isOutOfStock ? (
          <span className="absolute right-3 top-3 rounded-md bg-zinc-900 px-2 py-1 text-xs font-semibold text-white">
            Out of stock
          </span>
        ) : isOnSale ? (
          <span className="absolute right-3 top-3 rounded-md bg-red-500 px-2 py-1 text-xs font-semibold text-white">
            Sale!
          </span>
        ) : null}
      </div>

      <div className="space-y-3 p-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            {product.category ?? "Uncategorized"}
          </p>
          <h3
            className="text-lg font-semibold text-zinc-900"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {product.name}
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {isOnSale ? (
            <>
              <span className="text-sm line-through text-zinc-400">
                ₹{product.original_price.toFixed(2)}
              </span>
              <span className="text-base font-bold text-green-600">
                ₹{(product.sale_price as number).toFixed(2)}
              </span>
            </>
          ) : (
            <span className="text-base font-semibold text-zinc-900">
              ₹{product.original_price.toFixed(2)}
            </span>
          )}
        </div>

        {isOutOfStock ? (
          <button
            type="button"
            disabled
            className="w-full cursor-not-allowed rounded-md bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-500"
          >
            Out of stock
          </button>
        ) : !cartItem ? (
          <button
            type="button"
            onClick={() => addItem(product)}
            className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
          >
            Add to cart
          </button>
        ) : (
          <div className="w-full bg-green-600 text-white rounded-md flex items-center justify-between px-3 py-2">
            <button
              type="button"
              onClick={() => removeItem(product.id)}
              className="inline-flex items-center justify-center"
              aria-label="Decrease quantity"
            >
              <Minus className="h-4 w-4" />
            </button>

            <span className="text-sm font-medium">{cartItem.quantity}</span>

            <button
              type="button"
              onClick={() => addItem(product)}
              className="inline-flex items-center justify-center"
              aria-label="Increase quantity"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
