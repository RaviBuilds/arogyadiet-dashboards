"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Product } from "@/types/product";
import { useCartStore } from "@/store/useCartStore";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Minus,
  Plus,
  X,
} from "lucide-react";

interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  // Purely cosmetic "just added" flash on the button — no cart state,
  // logic, or persistence involved. Auto-clears itself.
  const [justAdded, setJustAdded] = useState(false);

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

  // Some product descriptions come from a rich text editor that inserts
  // literal &nbsp; entities between every word (instead of real spaces).
  // That turns the whole paragraph into one unbreakable token, forcing
  // the browser to break mid-word. Normalize them to real spaces so text
  // wraps naturally at word boundaries.
  const sanitizedDescription = product.description
    ? product.description.replace(/&nbsp;/gi, " ")
    : product.description;

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

  const handleAddToCart = () => {
    addItem(product);
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 1200);
  };

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-3xl border border-emerald-900/10 bg-white shadow-sm transition-all duration-300 ease-out",
        isOutOfStock
          ? "opacity-75"
          : "hover:-translate-y-1 hover:border-emerald-300/60 hover:shadow-xl hover:shadow-emerald-900/[0.07]",
      )}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-gradient-to-br from-emerald-50/70 via-white to-amber-50/30">
        {primaryImage ? (
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="block h-full w-full cursor-zoom-in overflow-hidden p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 sm:p-7"
            aria-label={`View ${product.name} images`}
          >
            <img
              src={primaryImage}
              alt={product.name}
              className={`h-full w-full object-contain transition-transform duration-500 ease-out ${
                isOutOfStock ? "grayscale" : "group-hover:scale-[1.06]"
              }`}
            />
          </button>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-slate-400">
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
          <span className="absolute left-3 top-3 inline-flex items-center rounded-full bg-slate-900/85 px-3 py-1 text-xs font-semibold text-white shadow-sm ring-1 ring-inset ring-white/10 backdrop-blur-sm">
            Out of stock
          </span>
        ) : isOnSale ? (
          <span className="absolute left-3 top-3 inline-flex items-center rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm ring-1 ring-inset ring-white/15">
            {discountPercent ? `-${discountPercent}%` : "Sale"}
          </span>
        ) : null}

        <button
          type="button"
          onClick={() => setQuickViewOpen(true)}
          aria-label={`Quick view ${product.name}`}
          className={cn(
            "absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-emerald-700 shadow-md ring-1 ring-inset ring-emerald-900/10 backdrop-blur-sm transition-all duration-300 hover:bg-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2",
            isOutOfStock
              ? "opacity-100"
              : "-translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100",
          )}
        >
          <Eye className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-3 border-t border-emerald-900/10 p-4 sm:p-5">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700/80">
            {product.category ?? "Uncategorized"}
          </p>
          <h3
            className="text-[15px] font-semibold leading-snug tracking-tight text-slate-900 sm:text-base"
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

        <div className="flex items-baseline gap-2">
          {isOnSale ? (
            <>
              <span className="text-lg font-bold text-slate-900">
                ₹{(product.sale_price as number).toFixed(2)}
              </span>
              <span className="text-sm text-slate-400 line-through">
                ₹{product.original_price.toFixed(2)}
              </span>
            </>
          ) : (
            <span className="text-lg font-bold text-slate-900">
              ₹{product.original_price.toFixed(2)}
            </span>
          )}
        </div>

        <div>
          {isOutOfStock ? (
            <span className="flex w-full items-center justify-center rounded-full bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-400">
              Out of stock
            </span>
          ) : !cartItem ? (
            <button
              type="button"
              onClick={handleAddToCart}
              className={cn(
                "group/cta flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]",
                justAdded && "bg-emerald-600 hover:bg-emerald-600",
              )}
            >
              {justAdded ? (
                <>
                  <Check className="h-4 w-4" /> Added
                </>
              ) : (
                <>
                  Add to cart
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/cta:translate-x-0.5" />
                </>
              )}
            </button>
          ) : (
            <div className="flex w-full items-center justify-between rounded-full bg-emerald-600 px-4 py-2 text-white shadow-sm transition-all duration-200">
              <button
                type="button"
                onClick={() => removeItem(product.id)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full transition-all duration-200 hover:bg-emerald-700"
                aria-label="Decrease quantity"
              >
                <Minus className="h-4 w-4" />
              </button>

              <span className="text-sm font-medium">{cartItem.quantity}</span>

              <button
                type="button"
                onClick={() => addItem(product)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full transition-all duration-200 hover:bg-emerald-700"
                aria-label="Increase quantity"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={quickViewOpen} onOpenChange={setQuickViewOpen}>
        <DialogContent className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-3xl border-emerald-900/10 p-8 sm:max-w-5xl sm:p-10">
          <DialogTitle className="sr-only">{product.name}</DialogTitle>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            <div>
              <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border border-emerald-900/10 bg-gradient-to-br from-emerald-50/70 via-white to-amber-50/30 p-8">
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

              {galleryImages.length > 1 ? (
                <div className="flex gap-3 overflow-x-auto pt-4">
                  {galleryImages.map((url) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => setActiveImage(url)}
                      className={cn(
                        "h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-emerald-900/10 bg-emerald-50/40 p-1.5 transition-all duration-200 hover:border-emerald-300",
                        activeImage === url &&
                          "border-emerald-600 ring-2 ring-emerald-600/25",
                      )}
                      aria-label="View product image"
                    >
                      <img
                        src={url}
                        alt=""
                        className="h-full w-full object-contain"
                      />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex flex-col">
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  {product.category ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-900/10">
                      {product.category}
                    </span>
                  ) : null}
                  {productSku ? (
                    <span className="inline-flex items-center rounded-full bg-slate-50 px-3 py-1 font-mono text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-900/10">
                      SKU: {productSku}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 text-xs font-medium",
                      product.in_stock
                        ? "text-emerald-700"
                        : "text-muted-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        product.in_stock ? "bg-emerald-500" : "bg-slate-400",
                      )}
                    />
                    {product.in_stock ? "In Stock" : "Out of stock"}
                  </span>
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
                  {product.name}
                </h2>
              </div>

              <div className="mt-5 flex flex-wrap items-baseline gap-2 border-t border-emerald-900/10 pt-5">
                <span className="text-3xl font-bold text-slate-900">
                  ₹{displayPrice.toFixed(2)}
                </span>
                {isOnSale ? (
                  <span className="text-lg text-slate-400 line-through">
                    ₹{product.original_price.toFixed(2)}
                  </span>
                ) : null}
                {discountPercent ? (
                  <span className="inline-flex items-center rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground ring-1 ring-inset ring-white/15">
                    -{discountPercent}% off
                  </span>
                ) : null}
              </div>

              {typeof taxPercent === "number" && taxPercent > 0 ? (
                <p className="mt-1 text-xs text-slate-500">
                  Inclusive of all taxes ({taxPercent}%)
                </p>
              ) : null}

              {sanitizedDescription ? (
                <div
                  className={cn(
                    "prose prose-sm dark:prose-invert mt-6 max-w-none overflow-x-hidden text-sm leading-relaxed text-slate-600",
                    "[&_*]:max-w-full",
                    "[&_p]:mb-3 [&_strong]:font-semibold [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5",
                    "[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1",
                  )}
                  dangerouslySetInnerHTML={{ __html: sanitizedDescription }}
                />
              ) : (
                <p className="mt-6 text-sm text-slate-500">
                  No description available.
                </p>
              )}

              <div className="mt-auto pt-6">
                {isOutOfStock ? (
                  <span className="flex w-full items-center justify-center rounded-full bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-400">
                    Out of stock
                  </span>
                ) : !cartItem ? (
                  <button
                    type="button"
                    onClick={() => addItem(product)}
                    className="group/cta flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
                  >
                    Add to cart
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/cta:translate-x-0.5" />
                  </button>
                ) : (
                  <div className="flex w-full items-center justify-between rounded-full bg-emerald-600 px-4 py-2 text-white shadow-sm transition-all duration-200">
                    <button
                      type="button"
                      onClick={() => removeItem(product.id)}
                      className="inline-flex items-center justify-center rounded-full p-1 transition-all duration-200 hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
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
                      className="inline-flex items-center justify-center rounded-full p-1 transition-all duration-200 hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
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
