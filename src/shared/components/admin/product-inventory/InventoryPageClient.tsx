"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  ImageIcon,
  Layers,
  Loader2,
  Package,
  Pencil,
  Plus,
  ShoppingBag,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import {
  adminDeleteProduct,
  adminToggleProductVisibility,
  adminUpsertProduct,
  AdminInventoryProduct,
} from "@/actions/admin-actions/inventoryActions";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { ProductDescriptionEditor } from "@/shared/components/admin/product-inventory/ProductDescriptionEditor";
import { ProductFranchiseAvailabilityDialog } from "@/shared/components/admin/product-inventory/ProductFranchiseAvailabilityDialog";
import {
  ProductMediaGallery,
  type ProductMediaGalleryHandle,
} from "@/shared/components/admin/product-inventory/ProductMediaGallery";
import { DataTable } from "@/shared/components/ui/data-table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Separator } from "@/shared/components/ui/separator";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/lib/utils";

type AccessMode = "view-only" | "full-access";

const VALID_ACCESS_MODES: AccessMode[] = ["view-only", "full-access"];

interface InventoryPageClientProps {
  products: AdminInventoryProduct[];
  accessMode?: AccessMode;
  pageTitle?: string;
  pageDescription?: string;
}

/* ----- Stat cards matching the Master Catalog metric cards ----- */
function StatCard({
  icon: Icon,
  label,
  value,
  subtext,
  iconBg,
  iconColor,
  valueClassName,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  subtext?: string;
  iconBg: string;
  iconColor: string;
  valueClassName?: string;
}) {
  return (
    <Card className="border shadow-sm transition-all hover:border-slate-300 hover:shadow-md">
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
              iconBg,
            )}
          >
            <Icon className={cn("h-5 w-5", iconColor)} />
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {label}
            </p>
            <p
              className={cn(
                "text-2xl font-bold tracking-tight text-foreground",
                valueClassName,
              )}
            >
              {value}
            </p>
            {subtext ? (
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {subtext}
              </p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ----- Form section inside dialog ----- */
function FormSection({
  title,
  description,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-4", className)}>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100">
          <Icon className="h-4 w-4 text-slate-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold leading-none tracking-tight text-slate-900">
            {title}
          </h3>
          {description ? (
            <p className="mt-1.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function InventoryPageClient({
  products,
  accessMode: accessModeProp,
  pageTitle = "Inventory",
  pageDescription = "Manage shop product catalog, stock levels, and availability.",
}: InventoryPageClientProps) {
  // Fall back to "full-access" if an invalid accessMode value is provided
  const accessMode: AccessMode =
    accessModeProp && VALID_ACCESS_MODES.includes(accessModeProp)
      ? accessModeProp
      : "full-access";
  const isViewOnly = accessMode === "view-only";
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] =
    useState<AdminInventoryProduct | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const mediaGalleryRef = useRef<ProductMediaGalleryHandle>(null);

  const handleProductModalOpenChange = (open: boolean) => {
    setProductModalOpen(open);
    if (!open) {
      setEditingProduct(null);
    }
  };

  const openCreateModal = () => {
    setEditingProduct(null);
  };

  const openEditModal = (product: AdminInventoryProduct) => {
    setEditingProduct(product);
  };

  const handleToggleVisibility = (product: AdminInventoryProduct) => {
    setTogglingId(product.id);
    const toastId = toast.loading("Updating product visibility...");

    startTransition(async () => {
      const result = await adminToggleProductVisibility(
        product.id,
        product.is_active,
      );

      if (result.success) {
        toast.success(
          product.is_active
            ? "Product hidden from shop."
            : "Product is now visible in shop.",
          { id: toastId },
        );
        router.refresh();
      } else {
        toast.error(result.error ?? "Failed to update product visibility.", {
          id: toastId,
        });
      }

      setTogglingId(null);
    });
  };

  const handleDeleteProduct = (productId: string) => {
    setDeletingId(productId);
    const toastId = toast.loading("Archiving product...");

    startTransition(async () => {
      const result = await adminDeleteProduct(productId);

      if (result.success) {
        toast.success("Product archived successfully.", { id: toastId });
        router.refresh();
      } else {
        toast.error(result.error ?? "Failed to archive product.", {
          id: toastId,
        });
      }

      setDeletingId(null);
    });
  };

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    startTransition(async () => {
      const formData = new FormData(event.currentTarget);
      mediaGalleryRef.current?.applyToFormData(formData);
      const result = await adminUpsertProduct(formData);

      if (result.success) {
        toast.success(
          editingProduct
            ? "Product updated successfully."
            : "Product created successfully.",
        );
        handleProductModalOpenChange(false);
        router.refresh();
        return;
      }

      toast.error(result.error ?? "Failed to save product.");
    });
  };

  const columns = useMemo<ColumnDef<AdminInventoryProduct>[]>(() => {
    const baseColumns: ColumnDef<AdminInventoryProduct>[] = [
      {
        id: "product",
        header: "Product",
        cell: ({ row }) => {
          const imageUrl =
            row.original.banner_image_url ?? row.original.image_urls?.[0];

          return (
            <div className="flex items-center gap-3">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={row.original.name}
                  className="h-11 w-11 rounded-lg border border-slate-200 object-cover shadow-sm"
                />
              ) : (
                <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50">
                  <Package className="h-4 w-4 text-slate-400" />
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">
                  {row.original.name}
                </p>
                <p className="text-xs text-slate-500">
                  {row.original.sku ?? "No SKU"}
                </p>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "category",
        header: "Category",
        cell: ({ row }) => (
          <Badge variant="secondary" className="font-normal">
            {row.original.category ?? "Uncategorized"}
          </Badge>
        ),
      },
      {
        accessorKey: "stock_quantity",
        header: "Stock",
        cell: ({ row }) => {
          const qty = row.original.stock_quantity;
          const isLow = typeof qty === "number" && qty <= 5 && qty > 0;
          const isOut = typeof qty === "number" && qty === 0;

          return (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  isOut && "text-red-600",
                  isLow && "text-amber-600",
                  !isOut && !isLow && "text-slate-900",
                )}
              >
                {typeof qty === "number" ? qty : "—"}
              </span>
              {isOut ? (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                  Out
                </Badge>
              ) : isLow ? (
                <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 text-[10px] px-1.5 py-0">
                  Low
                </Badge>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "sale_price",
        header: "Sale Price",
        cell: ({ row }) => (
          <span className="text-sm font-semibold tabular-nums text-slate-900">
            {typeof row.original.sale_price === "number"
              ? `₹${row.original.sale_price.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
              : "—"}
          </span>
        ),
      },
      {
        accessorKey: "is_active",
        header: "Visibility",
        cell: ({ row }) => {
          const product = row.original;
          const isToggling = togglingId === product.id;

          return (
            <div className="flex items-center gap-3">
              <Switch
                checked={product.is_active}
                disabled={isToggling || isPending || isViewOnly}
                onCheckedChange={() => handleToggleVisibility(product)}
                aria-label={
                  product.is_active
                    ? "Hide product from shop"
                    : "Show product in shop"
                }
              />
              <div className="flex items-center gap-1.5 text-sm">
                {isToggling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : product.is_active ? (
                  <Eye className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5 text-slate-400" />
                )}
                <span
                  className={cn(
                    "text-xs font-medium",
                    product.is_active
                      ? "text-emerald-600"
                      : "text-slate-400",
                  )}
                >
                  {product.is_active ? "Active" : "Hidden"}
                </span>
              </div>
            </div>
          );
        },
      },
    ];

    if (!isViewOnly) {
      baseColumns.push({
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const product = row.original;
          const isDeleting = deletingId === product.id;

          return (
            <div className="flex items-center justify-end gap-1.5">
              <DialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-slate-600 hover:text-slate-900"
                  onPointerDown={() => openEditModal(product)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              </DialogTrigger>

              <ProductFranchiseAvailabilityDialog
                productId={product.id}
                productName={product.name}
              />

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 text-slate-600 hover:text-red-600"
                    disabled={isDeleting || isPending}
                  >
                    {isDeleting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Archive Product</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will hide the product from the shop and inventory
                      list. Order history will be preserved.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeleting}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      disabled={isDeleting}
                      onClick={() => handleDeleteProduct(product.id)}
                    >
                      {isDeleting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Archiving...
                        </>
                      ) : (
                        "Archive"
                      )}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          );
        },
      });
    }

    return baseColumns;
  }, [isPending, togglingId, deletingId, isViewOnly]);

  /* ----- Compute summary stats ----- */
  const totalProducts = products.length;
  const activeProducts = products.filter((p) => p.is_active).length;
  const outOfStock = products.filter(
    (p) => typeof p.stock_quantity === "number" && p.stock_quantity === 0,
  ).length;
  const categories = new Set(
    products.map((p) => p.category).filter(Boolean),
  ).size;

  const tableContent = (
    <div className="space-y-6 p-6">
      <AdminPageHeader
        title={pageTitle}
        description={pageDescription}
        action={
          !isViewOnly ? (
            <DialogTrigger asChild>
              <Button type="button" onPointerDown={openCreateModal}>
                <Plus className="h-4 w-4" />
                Add New Product
              </Button>
            </DialogTrigger>
          ) : undefined
        }
      />

      {/* Summary stat cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard
          icon={ShoppingBag}
          label="Total Products"
          value={String(totalProducts)}
          subtext="In catalog"
          iconBg="bg-blue-50"
          iconColor="text-blue-600"
        />
        <StatCard
          icon={Eye}
          label="Active & Visible"
          value={String(activeProducts)}
          subtext="Shown in shop"
          iconBg="bg-emerald-50"
          iconColor="text-emerald-600"
        />
        <StatCard
          icon={AlertTriangle}
          label="Out of Stock"
          value={String(outOfStock)}
          subtext={outOfStock === 0 ? "All stocked" : "Needs restock"}
          iconBg="bg-red-50"
          iconColor="text-red-600"
          valueClassName={outOfStock > 0 ? "text-red-600" : undefined}
        />
        <StatCard
          icon={Layers}
          label="Categories"
          value={String(categories)}
          subtext="Product groups"
          iconBg="bg-violet-50"
          iconColor="text-violet-600"
        />
      </div>

      {/* Product table card */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Product Catalog
              </h2>
              <p className="text-xs text-slate-500">
                {totalProducts} product{totalProducts !== 1 ? "s" : ""} shown
              </p>
            </div>
          </div>
        </div>
        <div className="px-6 pb-6">
          <DataTable
            columns={columns}
            data={products}
            filterColumn="name"
            filterPlaceholder="Search products by name..."
          />
        </div>
      </div>
    </div>
  );

  if (isViewOnly) {
    return tableContent;
  }

  return (
    <>
      <Dialog
        open={productModalOpen}
        onOpenChange={handleProductModalOpenChange}
      >
        {tableContent}

        <DialogContent className="flex h-[90vh] max-h-[90vh] w-[90vw] max-w-3xl flex-col gap-0 overflow-hidden rounded-2xl border-slate-200 p-0 shadow-xl">
          <DialogHeader className="shrink-0 border-b border-slate-100 bg-slate-50/50 px-6 py-5">
            <DialogTitle className="text-lg font-semibold text-slate-900">
              {editingProduct ? "Edit Product" : "Add New Product"}
            </DialogTitle>
            <p className="text-sm text-slate-500">
              {editingProduct
                ? "Update product details, pricing, and media."
                : "Fill in the product details to add it to your shop catalog."}
            </p>
          </DialogHeader>

          <form
            key={editingProduct?.id ?? "new-product"}
            onSubmit={handleFormSubmit}
            className="flex min-h-0 flex-1 flex-col"
          >
            {editingProduct ? (
              <input type="hidden" name="id" value={editingProduct.id} />
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
              <div className="space-y-8">
                <FormSection
                  title="Basic Info"
                  description="Product name, identifiers, and descriptions shown in the shop."
                  icon={Package}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="name" className="text-xs font-medium text-slate-700">Name</Label>
                      <Input
                        id="name"
                        name="name"
                        placeholder="e.g. Ayur Punarjeeva Forte"
                        defaultValue={editingProduct?.name ?? ""}
                        required
                        className="border-slate-200 focus-visible:ring-primary/30"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="sku" className="text-xs font-medium text-slate-700">SKU</Label>
                      <Input
                        id="sku"
                        name="sku"
                        placeholder="ADT202400001"
                        defaultValue={editingProduct?.sku ?? ""}
                        required
                        className="border-slate-200 focus-visible:ring-primary/30"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="category" className="text-xs font-medium text-slate-700">Category</Label>
                      <Input
                        id="category"
                        name="category"
                        placeholder="Supplements"
                        defaultValue={editingProduct?.category ?? ""}
                        className="border-slate-200 focus-visible:ring-primary/30"
                      />
                    </div>

                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="description" className="text-xs font-medium text-slate-700">Description</Label>
                      <ProductDescriptionEditor
                        id="description"
                        name="description"
                        defaultValue={editingProduct?.description ?? ""}
                      />
                    </div>
                  </div>
                </FormSection>

                <Separator className="bg-slate-100" />

                <FormSection
                  title="Pricing & Inventory"
                  description="Set prices, stock levels, and tax for checkout."
                  icon={Wallet}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="originalPrice" className="text-xs font-medium text-slate-700">Original Price (₹)</Label>
                      <Input
                        id="originalPrice"
                        name="originalPrice"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        defaultValue={editingProduct?.original_price ?? 0}
                        required
                        className="border-slate-200 focus-visible:ring-primary/30"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="salePrice" className="text-xs font-medium text-slate-700">Sale Price (₹)</Label>
                      <Input
                        id="salePrice"
                        name="salePrice"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        defaultValue={editingProduct?.sale_price ?? ""}
                        className="border-slate-200 focus-visible:ring-primary/30"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="stockQuantity" className="text-xs font-medium text-slate-700">Stock Quantity</Label>
                      <Input
                        id="stockQuantity"
                        name="stockQuantity"
                        type="number"
                        min="0"
                        step="1"
                        placeholder="0"
                        defaultValue={editingProduct?.stock_quantity ?? 0}
                        required
                        className="border-slate-200 focus-visible:ring-primary/30"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="taxPercent" className="text-xs font-medium text-slate-700">Tax Percent (%)</Label>
                      <Input
                        id="taxPercent"
                        name="taxPercent"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        placeholder="18"
                        defaultValue={editingProduct?.tax_percent ?? ""}
                        className="border-slate-200 focus-visible:ring-primary/30"
                      />
                    </div>
                  </div>
                </FormSection>

                <Separator className="bg-slate-100" />

                <FormSection
                  title="Media"
                  description="Upload product gallery images."
                  icon={ImageIcon}
                >
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-slate-700">Upload Images</Label>
                    <ProductMediaGallery
                      ref={mediaGalleryRef}
                      existingImages={editingProduct?.image_urls ?? []}
                      defaultBannerUrl={
                        editingProduct?.banner_image_url ??
                        editingProduct?.image_urls?.[0] ??
                        null
                      }
                    />
                    <p className="text-xs text-slate-500">
                      Upload one or more images. The first image is the banner by
                      default; use &quot;Set banner&quot; to change it.
                    </p>
                  </div>
                </FormSection>
              </div>
            </div>

            <DialogFooter className="sticky bottom-0 z-10 shrink-0 gap-2 border-t border-slate-100 bg-slate-50/80 px-6 py-4 backdrop-blur supports-backdrop-filter:bg-slate-50/60 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isPending} className="border-slate-200">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : editingProduct ? (
                  "Save Changes"
                ) : (
                  "Create Product"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
