"use client";

import { useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Product } from "@/types/product";
import { useCartStore } from "@/store/useCartStore";
import { cn } from "@/lib/utils";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { ChevronLeft, ChevronRight, Eye, Minus, Plus, X } from "lucide-react";

interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const items = useCartStore((state) => state.items);
  const addItem = useCartStore((state) => state.addItem);
  const removeItem = useCartStore((state) => state.removeItem);
  const cartItem = items.find((item) => item.id === product.id);
  const isOutOfStock = !product.in_stock;

  const isOnSale =
    typeof product.sale_price === "number" &&
    product.sale_price < product.original_price;

  const imageUrls: string[] =
    (product as Product & { image_urls?: string[] | null }).image_urls ??
    product.image_url ??
    [];

  const primaryImage = imageUrls[0];
  const hasMultipleImages = imageUrls.length > 1;

  const handleLightboxOpenChange = (open: boolean) => {
    setLightboxOpen(open);
    if (!open) {
      setCurrentImageIndex(0);
    }
  };

  const showPreviousImage = () => {
    setCurrentImageIndex(
      (index) => (index - 1 + imageUrls.length) % imageUrls.length
    );
  };

  const showNextImage = () => {
    setCurrentImageIndex((index) => (index + 1) % imageUrls.length);
  };

  return (
    <article
      className={`overflow-hidden rounded-xl border border-zinc-200 bg-white transition-shadow duration-200 ${
        isOutOfStock ? "opacity-75" : "hover:shadow-md"
      }`}
    >
      <div className="relative aspect-[4/3] w-full bg-zinc-100">
        {primaryImage ? (
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="block h-full w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            aria-label={`View ${product.name} images`}
          >
            <img
              src={primaryImage}
              alt={product.name}
              className={`h-full w-full object-cover ${
                isOutOfStock ? "grayscale" : ""
              }`}
            />
          </button>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-zinc-500">
            No image
          </div>
        )}

        {primaryImage ? (
          <Dialog open={lightboxOpen} onOpenChange={handleLightboxOpenChange}>
            <DialogPortal>
              <DialogOverlay className="bg-black/80 supports-backdrop-filter:backdrop-blur-none" />
              <DialogPrimitive.Content
                className={cn(
                  "fixed inset-0 z-50 flex items-center justify-center outline-none",
                  "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
                )}
              >
                <DialogTitle className="sr-only">
                  {product.name} image gallery
                </DialogTitle>

                <DialogClose asChild>
                  <button
                    type="button"
                    className="absolute right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    aria-label="Close image gallery"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </DialogClose>

                {hasMultipleImages ? (
                  <>
                    <button
                      type="button"
                      onClick={showPreviousImage}
                      className="absolute left-4 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      aria-label="Previous image"
                    >
                      <ChevronLeft className="h-6 w-6" />
                    </button>
                    <button
                      type="button"
                      onClick={showNextImage}
                      className="absolute right-4 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      aria-label="Next image"
                    >
                      <ChevronRight className="h-6 w-6" />
                    </button>
                  </>
                ) : null}

                <img
                  src={imageUrls[currentImageIndex]}
                  alt={`${product.name}${hasMultipleImages ? ` - image ${currentImageIndex + 1} of ${imageUrls.length}` : ""}`}
                  className="max-h-[90vh] max-w-[90vw] object-contain"
                />
              </DialogPrimitive.Content>
            </DialogPortal>
          </Dialog>
        ) : null}

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

        <div className="flex items-center gap-2">
          {isOutOfStock ? (
            <button
              type="button"
              disabled
              className="flex-1 cursor-not-allowed rounded-md bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-500"
            >
              Out of stock
            </button>
          ) : !cartItem ? (
            <button
              type="button"
              onClick={() => addItem(product)}
              className="flex-1 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
            >
              Add to cart
            </button>
          ) : (
            <div className="flex flex-1 items-center justify-between rounded-md bg-green-600 px-3 py-2 text-white">
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

          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setQuickViewOpen(true)}
            aria-label={`Quick view ${product.name}`}
          >
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog open={quickViewOpen} onOpenChange={setQuickViewOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle className="text-2xl font-bold text-zinc-900">
            {product.name}
          </DialogTitle>

          <div className="flex items-center gap-2">
            {isOnSale ? (
              <>
                <span className="text-sm line-through text-zinc-400">
                  ₹{product.original_price.toFixed(2)}
                </span>
                <span className="text-lg font-bold text-green-600">
                  ₹{(product.sale_price as number).toFixed(2)}
                </span>
              </>
            ) : (
              <span className="text-lg font-semibold text-zinc-900">
                ₹{product.original_price.toFixed(2)}
              </span>
            )}
          </div>

          {product.short_description ? (
            <p className="text-sm text-zinc-600">{product.short_description}</p>
          ) : null}

          <hr className="my-4" />

          {product.description ? (
            <div className="max-h-[60vh] overflow-y-auto">
              <div
                dangerouslySetInnerHTML={{ __html: product.description }}
                className="prose max-w-none text-sm"
              />
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No description available.</p>
          )}
        </DialogContent>
      </Dialog>
    </article>
  );
}
