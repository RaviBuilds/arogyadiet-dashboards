"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { Eye, EyeOff, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  adminDeleteProduct,
  adminToggleProductVisibility,
  adminUpsertProduct,
  AdminInventoryProduct,
} from "@/actions/admin-actions/inventoryActions";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
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
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/components/ui/sheet";

interface InventoryPageClientProps {
  products: AdminInventoryProduct[];
}

export default function InventoryPageClient({
  products,
}: InventoryPageClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingProduct, setEditingProduct] =
    useState<AdminInventoryProduct | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleSheetOpenChange = (open: boolean) => {
    setSheetOpen(open);
    if (!open) {
      setEditingProduct(null);
    }
  };

  const openCreateSheet = () => {
    setEditingProduct(null);
  };

  const openEditSheet = (product: AdminInventoryProduct) => {
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
    const toastId = toast.loading("Deleting product...");

    startTransition(async () => {
      const result = await adminDeleteProduct(productId);

      if (result.success) {
        toast.success("Product deleted successfully.", { id: toastId });
        router.refresh();
      } else {
        toast.error(result.error ?? "Failed to delete product.", {
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
      const result = await adminUpsertProduct(formData);

      if (result.success) {
        toast.success(
          editingProduct
            ? "Product updated successfully."
            : "Product created successfully.",
        );
        handleSheetOpenChange(false);
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
          const imageUrl = row.original.image_urls?.[0];

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
              <SheetTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onPointerDown={() => openEditSheet(product)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              </SheetTrigger>

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
                    <AlertDialogTitle>Delete Product</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete this product?
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
                          Deleting...
                        </>
                      ) : (
                        "Delete"
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
      <Sheet open={sheetOpen} onOpenChange={handleSheetOpenChange}>
        <div className="space-y-6">
          <AdminPageHeader
            title="Inventory"
            description="Manage shop product catalog, stock levels, and availability."
            action={
              <SheetTrigger asChild>
                <Button type="button" onPointerDown={openCreateSheet}>
                  <Plus className="h-4 w-4" />
                  Add New Product
                </Button>
              </SheetTrigger>
            }
          />

          <DataTable
            columns={columns}
            data={products}
            filterColumn="name"
            filterPlaceholder="Filter products..."
          />
        </div>

        <SheetContent
          side="right"
          className="w-[400px] sm:max-w-[600px] overflow-y-auto"
        >
          <SheetHeader>
            <SheetTitle>
              {editingProduct ? "Edit Product" : "Add New Product"}
            </SheetTitle>
          </SheetHeader>

          <form
            key={editingProduct?.id ?? "new-product"}
            onSubmit={handleFormSubmit}
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
          >
            {editingProduct ? (
              <input type="hidden" name="id" value={editingProduct.id} />
            ) : null}

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

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="shortDescription">Short Description</Label>
                <Textarea
                  id="shortDescription"
                  name="shortDescription"
                  rows={3}
                  defaultValue={editingProduct?.short_description ?? ""}
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  rows={5}
                  defaultValue={editingProduct?.description ?? ""}
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="imageUrls">Image URLs</Label>
                <Input
                  id="imageUrls"
                  name="imageUrls"
                  placeholder="https://example.com/image-1.jpg, https://example.com/image-2.jpg"
                  defaultValue={(editingProduct?.image_urls ?? []).join(", ")}
                />
                <p className="text-xs text-muted-foreground">
                  Enter comma-separated image URLs for the product gallery.
                </p>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="image">Upload Image</Label>
                {editingProduct?.image_urls?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {editingProduct.image_urls.map((url) => (
                      <img
                        key={url}
                        src={url}
                        alt={editingProduct.name}
                        className="h-16 w-16 rounded-md border object-cover"
                      />
                    ))}
                  </div>
                ) : null}
                <Input
                  id="image"
                  name="image"
                  type="file"
                  accept="image/*"
                />
                <p className="text-xs text-muted-foreground">
                  Upload a local image to append to the product gallery.
                </p>
              </div>
            </div>

            <SheetFooter className="px-0">
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
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
