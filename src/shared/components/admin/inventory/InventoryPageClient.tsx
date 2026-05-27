"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ColumnDef } from "@tanstack/react-table";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  adminUpsertProduct,
  AdminInventoryProduct,
} from "@/actions/admin-actions/inventoryActions";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { StatusBadge } from "@/shared/components/admin/core/StatusBadge";
import { DataTable } from "@/shared/components/ui/data-table";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";

const productFormSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().min(1, "Name is required"),
    sku: z.string().min(1, "SKU is required"),
    category: z.string().optional(),
    originalPrice: z.string().min(1, "Original price is required"),
    salePrice: z.string().optional(),
    stockQuantity: z.string().min(1, "Stock quantity is required"),
    taxPercent: z.string().optional(),
    shortDescription: z.string().optional(),
    description: z.string().optional(),
    imageUrls: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const originalPrice = Number(data.originalPrice);
    if (Number.isNaN(originalPrice) || originalPrice < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Original price must be 0 or greater",
        path: ["originalPrice"],
      });
    }

    const stockQuantity = Number(data.stockQuantity);
    if (
      Number.isNaN(stockQuantity) ||
      stockQuantity < 0 ||
      !Number.isInteger(stockQuantity)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Stock quantity must be a whole number of 0 or greater",
        path: ["stockQuantity"],
      });
    }

    if (data.salePrice?.trim()) {
      const salePrice = Number(data.salePrice);
      if (Number.isNaN(salePrice) || salePrice < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Sale price must be 0 or greater",
          path: ["salePrice"],
        });
      }
    }

    if (data.taxPercent?.trim()) {
      const taxPercent = Number(data.taxPercent);
      if (Number.isNaN(taxPercent) || taxPercent < 0 || taxPercent > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Tax percent must be between 0 and 100",
          path: ["taxPercent"],
        });
      }
    }
  });

type ProductFormValues = z.infer<typeof productFormSchema>;

const emptyFormValues: ProductFormValues = {
  name: "",
  sku: "",
  category: "",
  originalPrice: "0",
  salePrice: "",
  stockQuantity: "0",
  taxPercent: "",
  shortDescription: "",
  description: "",
  imageUrls: "",
};

function productToFormValues(product: AdminInventoryProduct): ProductFormValues {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku ?? "",
    category: product.category ?? "",
    originalPrice: String(product.original_price),
    salePrice:
      typeof product.sale_price === "number" ? String(product.sale_price) : "",
    stockQuantity: String(product.stock_quantity ?? 0),
    taxPercent:
      typeof product.tax_percent === "number" ? String(product.tax_percent) : "",
    shortDescription: product.short_description ?? "",
    description: product.description ?? "",
    imageUrls: (product.image_urls ?? []).join(", "),
  };
}

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

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: emptyFormValues,
  });

  const openCreateForm = () => {
    setEditingProduct(null);
    form.reset(emptyFormValues);
    setSheetOpen(true);
  };

  const openEditForm = (product: AdminInventoryProduct) => {
    setEditingProduct(product);
    form.reset(productToFormValues(product));
    setSheetOpen(true);
  };

  const handleSheetOpenChange = (open: boolean) => {
    setSheetOpen(open);
    if (!open) {
      setEditingProduct(null);
      form.reset(emptyFormValues);
    }
  };

  const onSubmit = (values: ProductFormValues) => {
    startTransition(async () => {
      const result = await adminUpsertProduct({
        id: values.id,
        name: values.name,
        sku: values.sku,
        category: values.category,
        originalPrice: Number(values.originalPrice),
        salePrice: values.salePrice?.trim()
          ? Number(values.salePrice)
          : null,
        stockQuantity: Number(values.stockQuantity),
        taxPercent: values.taxPercent?.trim()
          ? Number(values.taxPercent)
          : null,
        shortDescription: values.shortDescription,
        description: values.description,
        imageUrls: values.imageUrls,
      });

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
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.is_active ? "Active" : "Inactive"}
          />
        ),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => openEditForm(row.original)}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Inventory"
        description="Manage shop product catalog, stock levels, and availability."
        action={
          <Button type="button" onClick={openCreateForm}>
            <Plus className="h-4 w-4" />
            Add New Product
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={products}
        filterColumn="name"
        filterPlaceholder="Filter products..."
      />

      <Sheet open={sheetOpen} onOpenChange={handleSheetOpenChange}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>
              {editingProduct ? "Edit Product" : "Add New Product"}
            </SheetTitle>
            <SheetDescription>
              {editingProduct
                ? "Update product details and save changes."
                : "Fill in the details below to add a new product."}
            </SheetDescription>
          </SheetHeader>

          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" {...form.register("name")} />
                {form.formState.errors.name ? (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.name.message}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="sku">SKU</Label>
                <Input id="sku" {...form.register("sku")} />
                {form.formState.errors.sku ? (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.sku.message}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Input id="category" {...form.register("category")} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="originalPrice">Original Price</Label>
                <Input
                  id="originalPrice"
                  type="number"
                  min="0"
                  step="0.01"
                  {...form.register("originalPrice")}
                />
                {form.formState.errors.originalPrice ? (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.originalPrice.message}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="salePrice">Sale Price</Label>
                <Input
                  id="salePrice"
                  type="number"
                  min="0"
                  step="0.01"
                  {...form.register("salePrice")}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="stockQuantity">Stock Quantity</Label>
                <Input
                  id="stockQuantity"
                  type="number"
                  min="0"
                  step="1"
                  {...form.register("stockQuantity")}
                />
                {form.formState.errors.stockQuantity ? (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.stockQuantity.message}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="taxPercent">Tax Percent</Label>
                <Input
                  id="taxPercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  {...form.register("taxPercent")}
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="shortDescription">Short Description</Label>
                <Textarea
                  id="shortDescription"
                  rows={3}
                  {...form.register("shortDescription")}
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  rows={5}
                  {...form.register("description")}
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="imageUrls">Image URLs</Label>
                <Input
                  id="imageUrls"
                  placeholder="https://example.com/image-1.jpg, https://example.com/image-2.jpg"
                  {...form.register("imageUrls")}
                />
                <p className="text-xs text-muted-foreground">
                  Enter comma-separated image URLs for the product gallery.
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
    </div>
  );
}
