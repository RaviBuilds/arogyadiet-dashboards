"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import {
  Eye,
  EyeOff,
  ImageIcon,
  Loader2,
  Package,
  Pencil,
  Plus,
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
import { ProductDescriptionEditor } from "@/shared/components/admin/inventory/ProductDescriptionEditor";
import {
  ProductMediaGallery,
  type ProductMediaGalleryHandle,
} from "@/shared/components/admin/inventory/ProductMediaGallery";
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
import { Button } from "@/shared/components/ui/button";
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

interface InventoryPageClientProps {
  products: AdminInventoryProduct[];
}

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
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-sm font-semibold leading-none tracking-tight">
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
}: InventoryPageClientProps) {
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

  const columns = useMemo<ColumnDef<AdminInventoryProduct>[]>(
    () => [
      {
        id: "image",
        header: "Image",
        cell: ({ row }) => {
          const imageUrl =
            row.original.banner_image_url ?? row.original.image_urls?.[0];

          return imageUrl ? (
            <img
              src={imageUrl}
              alt={row.original.name}
              className="h-10 w-10 rounded-md border object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
              N/A
            </div>
          );
        },
      },
      {
        accessorKey: "name",
        header: "Name",
      },
      {
        accessorKey: "sku",
        header: "SKU",
        cell: ({ row }) => row.original.sku ?? "—",
      },
      {
        accessorKey: "category",
        header: "Category",
        cell: ({ row }) => row.original.category ?? "Uncategorized",
      },
      {
        accessorKey: "stock_quantity",
        header: "Stock Quantity",
        cell: ({ row }) =>
          typeof row.original.stock_quantity === "number"
            ? row.original.stock_quantity
            : "—",
      },
      {
        accessorKey: "sale_price",
        header: "Sale Price",
        cell: ({ row }) =>
          typeof row.original.sale_price === "number"
            ? `₹${row.original.sale_price.toFixed(2)}`
            : "—",
      },
      {
        accessorKey: "is_active",
        header: "Status",
        cell: ({ row }) => {
          const product = row.original;
          const isToggling = togglingId === product.id;

          return (
            <div className="flex items-center gap-3">
              <Switch
                checked={product.is_active}
                disabled={isToggling || isPending}
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
                  <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span
                  className={
                    product.is_active
                      ? "font-medium text-emerald-600"
                      : "text-muted-foreground"
                  }
                >
                  {product.is_active ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
          );
        },
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const product = row.original;
          const isDeleting = deletingId === product.id;

          return (
            <div className="flex items-center gap-2">
              <DialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onPointerDown={() => openEditModal(product)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              </DialogTrigger>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
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
      },
    ],
    [isPending, togglingId, deletingId],
  );

  return (
    <>
      <Dialog
        open={productModalOpen}
        onOpenChange={handleProductModalOpenChange}
      >
        <div className="space-y-6">
          <AdminPageHeader
            title="Inventory"
            description="Manage shop product catalog, stock levels, and availability."
            action={
              <DialogTrigger asChild>
                <Button type="button" onPointerDown={openCreateModal}>
                  <Plus className="h-4 w-4" />
                  Add New Product
                </Button>
              </DialogTrigger>
            }
          />

          <DataTable
            columns={columns}
            data={products}
            filterColumn="name"
            filterPlaceholder="Filter products..."
          />
        </div>

        <DialogContent className="flex h-[90vh] max-h-[90vh] w-[80vw] max-w-[80vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[80vw]">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>
              {editingProduct ? "Edit Product" : "Add New Product"}
            </DialogTitle>
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
                      <Label htmlFor="name">Name</Label>
                      <Input
                        id="name"
                        name="name"
                        defaultValue={editingProduct?.name ?? ""}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="sku">SKU</Label>
                      <Input
                        id="sku"
                        name="sku"
                        defaultValue={editingProduct?.sku ?? ""}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="category">Category</Label>
                      <Input
                        id="category"
                        name="category"
                        defaultValue={editingProduct?.category ?? ""}
                      />
                    </div>

                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="description">Description</Label>
                      <ProductDescriptionEditor
                        id="description"
                        name="description"
                        defaultValue={editingProduct?.description ?? ""}
                      />
                    </div>
                  </div>
                </FormSection>

                <Separator />

                <FormSection
                  title="Pricing & Inventory"
                  description="Set prices, stock levels, and tax for checkout."
                  icon={Wallet}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="originalPrice">Original Price</Label>
                      <Input
                        id="originalPrice"
                        name="originalPrice"
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue={editingProduct?.original_price ?? 0}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="salePrice">Sale Price</Label>
                      <Input
                        id="salePrice"
                        name="salePrice"
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue={editingProduct?.sale_price ?? ""}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="stockQuantity">Stock Quantity</Label>
                      <Input
                        id="stockQuantity"
                        name="stockQuantity"
                        type="number"
                        min="0"
                        step="1"
                        defaultValue={editingProduct?.stock_quantity ?? 0}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="taxPercent">Tax Percent</Label>
                      <Input
                        id="taxPercent"
                        name="taxPercent"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        defaultValue={editingProduct?.tax_percent ?? ""}
                      />
                    </div>
                  </div>
                </FormSection>

                <Separator />

                <FormSection
                  title="Media"
                  description="Upload product gallery images."
                  icon={ImageIcon}
                >
                  <div className="space-y-2">
                    <Label>Upload Images</Label>
                    <ProductMediaGallery
                      ref={mediaGalleryRef}
                      existingImages={editingProduct?.image_urls ?? []}
                      defaultBannerUrl={
                        editingProduct?.banner_image_url ??
                        editingProduct?.image_urls?.[0] ??
                        null
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Upload one or more images. The first image is the banner by
                      default; use &quot;Set banner&quot; to change it.
                    </p>
                  </div>
                </FormSection>
              </div>
            </div>

            <DialogFooter className="sticky bottom-0 z-10 shrink-0 gap-2 border-t bg-background/95 px-6 py-4 backdrop-blur supports-backdrop-filter:bg-background/80 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isPending}>
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
