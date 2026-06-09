"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Product } from "@/types/product";
import { useCartStore } from "@/store/useCartStore";
import { cn } from "@/lib/utils";
import { Badge } from "@/shared/components/ui/badge";
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

  const bannerImageUrl =
    (product as Product & { banner_image_url?: string | null }).banner_image_url ??
    null;

  const primaryImage = bannerImageUrl ?? imageUrls[0];
  const hasMultipleImages = imageUrls.length > 1;

  const galleryImages = useMemo(
    () =>
      imageUrls.length > 0 ? imageUrls : primaryImage ? [primaryImage] : [],
    [imageUrls, primaryImage],
  );

  const [activeImage, setActiveImage] = useState(galleryImages[0] ?? "");

  const productSku = (product as Product & { sku?: string | null }).sku;
  const taxPercent = (product as Product & { tax_percent?: number | null })
    .tax_percent;

  const displayPrice = isOnSale
    ? (product.sale_price as number)
    : product.original_price;

  const discountPercent =
    isOnSale && product.original_price > 0
      ? Math.round((1 - (product.sale_price as number) / product.original_price) * 100)
      : null;

  useEffect(() => {
    if (quickViewOpen) {
      setActiveImage(galleryImages[0] ?? "");
    }
  }, [quickViewOpen, galleryImages]);

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
      className={cn(
        "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all duration-200",
        isOutOfStock
          ? "opacity-75"
          : "hover:-translate-y-0.5 hover:shadow-md",
      )}
    >
      <div className="relative aspect-[4/3] w-full bg-slate-100">
        {primaryImage ? (
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="block h-full w-full cursor-zoom-in transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
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
          <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
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
                    className="absolute right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-all duration-200 hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
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
                      className="absolute left-4 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-all duration-200 hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      aria-label="Previous image"
                    >
                      <ChevronLeft className="h-6 w-6" />
                    </button>
                    <button
                      type="button"
                      onClick={showNextImage}
                      className="absolute right-4 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-all duration-200 hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
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
          <Badge className="absolute right-3 top-3 border-0 bg-slate-900 text-white hover:bg-slate-900">
            Out of stock
          </Badge>
        ) : isOnSale ? (
          <Badge
            variant="outline"
            className="absolute right-3 top-3 border-red-200 bg-red-50 text-red-700 hover:bg-red-50"
          >
            Sale!
          </Badge>
        ) : null}
      </div>

      <div className="space-y-4 p-6">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            {product.category ?? "Uncategorized"}
          </p>
          <h3
            className="text-lg font-semibold tracking-tight text-slate-900"
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
              <span className="text-sm line-through text-slate-400">
                ₹{product.original_price.toFixed(2)}
              </span>
              <span className="text-base font-semibold text-emerald-700">
                ₹{(product.sale_price as number).toFixed(2)}
              </span>
            </>
          ) : (
            <span className="text-base font-semibold text-slate-900">
              ₹{product.original_price.toFixed(2)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isOutOfStock ? (
            <Button
              type="button"
              disabled
              variant="secondary"
              className="flex-1"
            >
              Out of stock
            </Button>
          ) : !cartItem ? (
            <Button
              type="button"
              onClick={() => addItem(product)}
              className="flex-1 transition-all duration-200"
            >
              Add to cart
            </Button>
          ) : (
            <div className="flex flex-1 items-center justify-between rounded-lg bg-emerald-600 px-3 py-2 text-white transition-all duration-200">
              <button
                type="button"
                onClick={() => removeItem(product.id)}
                className="inline-flex items-center justify-center transition-all duration-200"
                aria-label="Decrease quantity"
              >
                <Minus className="h-4 w-4" />
              </button>

              <span className="text-sm font-medium">{cartItem.quantity}</span>

              <button
                type="button"
                onClick={() => addItem(product)}
                className="inline-flex items-center justify-center transition-all duration-200"
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
            className="transition-all duration-200"
          >
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog open={quickViewOpen} onOpenChange={setQuickViewOpen}>
        <DialogContent className="max-h-[90vh] w-full max-w-5xl overflow-y-auto p-10 sm:max-w-5xl">
          <DialogTitle className="sr-only">{product.name}</DialogTitle>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            <div>
              <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-secondary/10 p-4">
                {activeImage ? (
                  <img
                    src={activeImage}
                    alt={product.name}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No image available
                  </p>
                )}
              </div>

              {galleryImages.length > 0 ? (
                <div className="flex gap-3 overflow-x-auto p-4">
                  {galleryImages.map((url) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => setActiveImage(url)}
                      className={cn(
                        "h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-background p-1 transition-all duration-200",
                        activeImage === url &&
                          "ring-2 ring-primary ring-offset-2",
                      )}
                      aria-label="View product image"
                    >
                      <img
                        src={url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex flex-col">
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
                  {product.name}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {product.category ? (
                    <Badge variant="secondary">{product.category}</Badge>
                  ) : null}
                  {productSku ? (
                    <Badge variant="outline">SKU: {productSku}</Badge>
                  ) : null}
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-baseline gap-2">
                <span className="text-3xl font-bold text-primary">
                  ₹{displayPrice.toFixed(2)}
                </span>
                {isOnSale ? (
                  <span className="ml-3 text-lg text-slate-400 line-through">
                    ₹{product.original_price.toFixed(2)}
                  </span>
                ) : null}
                {discountPercent ? (
                  <Badge
                    variant="outline"
                    className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50"
                  >
                    -{discountPercent}%
                  </Badge>
                ) : null}
              </div>

              <p
                className={cn(
                  "mt-2 text-sm font-medium",
                  product.in_stock
                    ? "text-emerald-700"
                    : "text-muted-foreground",
                )}
              >
                {product.in_stock ? "In Stock" : "Out of stock"}
              </p>

              {typeof taxPercent === "number" && taxPercent > 0 ? (
                <p className="mt-1 text-sm text-slate-500">
                  Inclusive of all taxes ({taxPercent}%)
                </p>
              ) : null}

              {product.description ? (
                <div
                  className={cn(
                    "prose prose-sm dark:prose-invert mt-6 max-w-none break-words overflow-x-hidden text-sm leading-relaxed",
                    "[&_*]:max-w-full",
                    "[&_p]:mb-3 [&_strong]:font-semibold [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5",
                    "[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1",
                  )}
                  dangerouslySetInnerHTML={{ __html: product.description }}
                />
              ) : (
                <p className="mt-6 text-sm text-slate-500">
                  No description available.
                </p>
              )}

              <div className="mt-auto pt-6">
                {isOutOfStock ? (
                  <Button type="button" disabled className="w-full">
                    Out of stock
                  </Button>
                ) : !cartItem ? (
                  <Button
                    type="button"
                    className="w-full transition-all duration-200"
                    onClick={() => addItem(product)}
                  >
                    Add to cart
                  </Button>
                ) : (
                  <div className="flex w-full items-center justify-between rounded-lg bg-emerald-600 px-3 py-2 text-white transition-all duration-200">
                    <button
                      type="button"
                      onClick={() => removeItem(product.id)}
                      className="inline-flex items-center justify-center rounded-md p-1 transition-all duration-200 hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      aria-label="Decrease quantity"
                    >
                      <Minus className="h-4 w-4" />
                    </button>

                    <span className="text-sm font-medium">
                      {cartItem.quantity} in cart
                    </span>

                    <button
                      type="button"
                      onClick={() => addItem(product)}
                      className="inline-flex items-center justify-center rounded-md p-1 transition-all duration-200 hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      aria-label="Increase quantity"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </article>
  );
}
