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
import { setClinicProductVisibilityAction } from "@/actions/admin-actions/clinicShopInventoryActions";
import { toggleFranchiseProductVisibility } from "@/actions/admin-actions/franchiseProductActions";
import type { FranchiseShopProduct } from "@/actions/admin-actions/franchiseProductActions";
import type { ClinicShopProductRow } from "@/types/clinicShop";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { ProductDescriptionEditor } from "@/shared/components/admin/product-inventory/ProductDescriptionEditor";
import { ProductFranchiseAvailabilityDialog } from "@/shared/components/admin/product-inventory/ProductFranchiseAvailabilityDialog";
import { ShopStockInDialog } from "@/shared/components/admin/product-inventory/ShopStockInDialog";
import { ShopStockInCart } from "@/shared/components/admin/product-inventory/ShopStockInCart";
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

/**
 * The discriminated destination mode for the Warehouse Shop Products page
 * (clinic-scoped-shop-inventory spec — Task 7.5, design.md "UI components").
 *
 * - `all-clinics`: Aggregate_Stock, Global_Visibility, full CRUD, no stock
 *   entry (Req 5.3, 5.4).
 * - `clinic`: Effective_Clinic_Stock, exactly two row actions — a
 *   Clinic_Visibility toggle and a Stock_In action — no create/edit/delete
 *   (Req 5.5, 5.6, 5.7, 5.8).
 * - `franchise`: the selected Franchise's `franchise_product_settings`
 *   stock, exactly one row action — a visibility toggle — no stock-in, no
 *   catalogue actions (Req 19.1, 19.2, 19.3).
 * - `operations-view`: Effective_Clinic_Stock + Effective_Clinic_Visibility
 *   for the selected clinic, read-only — no create/edit/delete, no
 *   Franchises action, no Clinic_Visibility toggle, no Stock_In action (Req
 *   9.4, 9.5, 9.11). Rendered by the Operations Shop Products page (task
 *   10.1) via `ClinicModeTable` with `isReadOnly`; `clinicId: null` (no
 *   selection made yet) renders nothing here — the "select a clinic" / "no
 *   clinics configured" prompts are the page's responsibility, not this
 *   component's (Req 9.2, 9.3).
 */
export type ShopProductsMode =
  | { kind: "all-clinics" }
  | { kind: "clinic"; clinicId: string }
  | { kind: "franchise"; franchiseId: string }
  | { kind: "operations-view"; clinicId: string | null };

interface InventoryPageClientProps {
  /** Aggregate-catalogue rows — used by `all-clinics` and the legacy/`operations-view` path. */
  products: AdminInventoryProduct[];
  /** Clinic_Mode rows (Effective_Clinic_Stock + Effective_Clinic_Visibility). */
  clinicProducts?: ClinicShopProductRow[];
  /** Franchise_Mode rows (`franchise_product_settings` stock + visibility). */
  franchiseProducts?: FranchiseShopProduct[];
  /**
   * The discriminated destination mode (Req 5.3–5.8, 19.1–19.3). Optional for
   * backward compatibility with the one existing caller
   * (`/admin/kitchen-shop/inventory`) that still passes the legacy
   * `accessMode` prop; when omitted, `mode` is derived from `accessMode`.
   */
  mode?: ShopProductsMode;
  /** @deprecated Prefer `mode`. Retained only for the kitchen-shop caller. */
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

/**
 * Dispatcher: picks the mode-specific table component. Kept hook-free so the
 * mode branch can vary the rendered subtree without violating the Rules of
 * Hooks — each branch below is its own component with its own, unconditional
 * hook calls (`ClinicModeTable`, `FranchiseModeTable`,
 * `AggregateModeTable`).
 */
export default function InventoryPageClient({
  products,
  clinicProducts = [],
  franchiseProducts = [],
  mode: modeProp,
  accessMode: accessModeProp,
  pageTitle = "Inventory",
  pageDescription = "Manage shop product catalog, stock levels, and availability.",
}: InventoryPageClientProps) {
  // Fall back to "full-access" if an invalid accessMode value is provided
  const accessMode: AccessMode =
    accessModeProp && VALID_ACCESS_MODES.includes(accessModeProp)
      ? accessModeProp
      : "full-access";

  // Backward compatibility: the kitchen-shop caller does not pass `mode` yet,
  // only the legacy `accessMode`. Derive an equivalent mode from it so that
  // caller keeps working unchanged (view-only -> operations-view, no clinic
  // scope; full-access -> all-clinics).
  const mode: ShopProductsMode =
    modeProp ??
    (accessMode === "view-only"
      ? { kind: "operations-view", clinicId: null }
      : { kind: "all-clinics" });

  if (mode.kind === "clinic") {
    return (
      <ClinicModeTable
        clinicId={mode.clinicId}
        products={clinicProducts}
        pageTitle={pageTitle}
        pageDescription={pageDescription}
      />
    );
  }

  if (mode.kind === "franchise") {
    return (
      <FranchiseModeTable
        franchiseId={mode.franchiseId}
        products={franchiseProducts}
        pageTitle={pageTitle}
        pageDescription={pageDescription}
      />
    );
  }

  if (mode.kind === "operations-view") {
    // Req 9.2: no Core_Clinic selected yet — the page itself renders the
    // "select a clinic" prompt; this component renders nothing so no
    // stock/ledger data is implied.
    if (!mode.clinicId) return null;

    // Req 9.4, 9.5, 9.11: clinic-scoped Effective_Clinic_Stock +
    // Effective_Clinic_Visibility, read-only — reuses `ClinicModeTable`'s
    // rendering with the visibility toggle and Stock_In action stripped out.
    return (
      <ClinicModeTable
        clinicId={mode.clinicId}
        products={clinicProducts}
        pageTitle={pageTitle}
        pageDescription={pageDescription}
        isReadOnly
      />
    );
  }

  // `all-clinics`: Aggregate_Stock, Global_Visibility, full CRUD, no stock
  // entry (Req 5.3, 5.4). The legacy `accessMode="view-only"` path (no
  // `mode` prop supplied) also lands here via the fallback above, unchanged.
  return (
    <AggregateModeTable
      products={products}
      isViewOnly={accessMode === "view-only"}
      pageTitle={pageTitle}
      pageDescription={pageDescription}
    />
  );
}

interface AggregateModeTableProps {
  products: AdminInventoryProduct[];
  isViewOnly: boolean;
  pageTitle: string;
  pageDescription: string;
}

function AggregateModeTable({
  products,
  isViewOnly,
  pageTitle,
  pageDescription,
}: AggregateModeTableProps) {
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
        accessorFn: (row) => row.name,
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
            filterColumn="product"
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

                    {/*
                      No stock entry input in `all-clinics` mode (Req 5.4):
                      Aggregate_Stock is derived only from per-clinic Stock_In
                      (Requirement 7), not typed in here, and
                      `adminUpsertProduct` no longer reads a `stockQuantity`
                      field. The "Stock" table column above still shows the
                      legacy/aggregate figure — that is a display concern, not
                      a stock-entry input, and stays out of scope here.
                      Master Catalog Product linking (Requirement 3) is task
                      7.8's territory and is intentionally not wired into this
                      form yet.
                    */}

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

/* ─────────────────────────────────────────────────────────────────────────────
 * Clinic_Mode — clinic stock, exactly two row actions: a Clinic_Visibility
 * toggle and a Stock_In action (Req 5.5, 5.6, 5.7, 5.8). No create/edit/delete,
 * no Franchises action, no global stock entry.
 * ───────────────────────────────────────────────────────────────────────────
 */

interface ClinicModeTableProps {
  clinicId: string;
  products: ClinicShopProductRow[];
  pageTitle: string;
  pageDescription: string;
  /**
   * Read-only rendering for the Operations Shop Products page's
   * `operations-view` mode (Req 9.11): the Clinic_Visibility `Switch` is
   * replaced by a plain Eye/EyeOff indicator and the Stock_In action column
   * is omitted entirely, rather than duplicating this table's row-rendering
   * logic in a second component.
   */
  isReadOnly?: boolean;
}

function ClinicModeTable({
  clinicId,
  products,
  pageTitle,
  pageDescription,
  isReadOnly = false,
}: ClinicModeTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const handleToggleVisibility = (product: ClinicShopProductRow) => {
    setTogglingId(product.id);
    const toastId = toast.loading("Updating clinic visibility...");

    startTransition(async () => {
      const result = await setClinicProductVisibilityAction(
        clinicId,
        product.id,
        !product.is_visible,
      );

      if (result.success) {
        toast.success(
          product.is_visible
            ? "Product hidden for this clinic."
            : "Product is now visible for this clinic.",
          { id: toastId },
        );
        router.refresh();
      } else {
        toast.error(result.error ?? "Failed to update clinic visibility.", {
          id: toastId,
        });
      }

      setTogglingId(null);
    });
  };

  const columns = useMemo<ColumnDef<ClinicShopProductRow>[]>(
    () => [
      {
        id: "product",
        accessorFn: (row) => row.name,
        header: "Product",
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900">
              {row.original.name}
            </p>
            <p className="text-xs text-slate-500">
              {row.original.sku ?? "No SKU"}
            </p>
          </div>
        ),
      },
      {
        accessorKey: "stock_quantity",
        header: "Clinic Stock",
        cell: ({ row }) => {
          const qty = row.original.stock_quantity;
          const isOut = qty === 0;
          return (
            <span
              className={cn(
                "text-sm font-semibold tabular-nums",
                isOut ? "text-red-600" : "text-slate-900",
              )}
            >
              {qty}
            </span>
          );
        },
      },
      {
        accessorKey: "is_visible",
        header: "Clinic Visibility",
        cell: ({ row }) => {
          const product = row.original;
          const isToggling = togglingId === product.id;

          // Req 9.11, 16.6: no Clinic_Visibility toggle on the read-only
          // Operations view — a plain indicator only.
          if (isReadOnly) {
            return (
              <div className="flex items-center gap-1.5 text-sm">
                {product.is_visible ? (
                  <Eye className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5 text-slate-400" />
                )}
                <span
                  className={cn(
                    "text-xs font-medium",
                    product.is_visible ? "text-emerald-600" : "text-slate-400",
                  )}
                >
                  {product.is_visible ? "Visible" : "Hidden"}
                </span>
              </div>
            );
          }

          return (
            <div className="flex items-center gap-3">
              <Switch
                checked={product.is_visible}
                disabled={isToggling || isPending}
                onCheckedChange={() => handleToggleVisibility(product)}
                aria-label={
                  product.is_visible
                    ? "Hide product for this clinic"
                    : "Show product for this clinic"
                }
              />
              <div className="flex items-center gap-1.5 text-sm">
                {isToggling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : product.is_visible ? (
                  <Eye className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5 text-slate-400" />
                )}
                <span
                  className={cn(
                    "text-xs font-medium",
                    product.is_visible ? "text-emerald-600" : "text-slate-400",
                  )}
                >
                  {product.is_visible ? "Visible" : "Hidden"}
                </span>
              </div>
            </div>
          );
        },
      },
      // Req 9.11, 16.6: no Stock_In action on the read-only Operations view.
      ...(isReadOnly
        ? []
        : [
            {
              id: "actions",
              header: "",
              cell: ({ row }: { row: { original: ClinicShopProductRow } }) => (
                <div className="flex items-center justify-end gap-1.5">
                  <ShopStockInDialog
                    product={row.original}
                    clinicId={clinicId}
                  />
                </div>
              ),
            } satisfies ColumnDef<ClinicShopProductRow>,
          ]),
    ],
    [isPending, togglingId, clinicId, isReadOnly],
  );

  const totalProducts = products.length;

  return (
    <div className="space-y-6 p-6">
      <AdminPageHeader title={pageTitle} description={pageDescription} />

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">
            Clinic Shop Stock
          </h2>
          <p className="text-xs text-slate-500">
            {totalProducts} product{totalProducts !== 1 ? "s" : ""} shown
          </p>
        </div>
        <div className="px-6 pb-6">
          <DataTable
            columns={columns}
            data={products}
            filterColumn="product"
            filterPlaceholder="Search products by name..."
          />
        </div>
      </div>

      {isReadOnly ? null : <ShopStockInCart />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Franchise_Mode — franchise stock, exactly one row action: a visibility
 * toggle (Req 19.1, 19.2, 19.3). No stock-in, no catalogue actions.
 * ───────────────────────────────────────────────────────────────────────── */

interface FranchiseModeTableProps {
  franchiseId: string;
  products: FranchiseShopProduct[];
  pageTitle: string;
  pageDescription: string;
}

function FranchiseModeTable({
  franchiseId,
  products,
  pageTitle,
  pageDescription,
}: FranchiseModeTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  // Optimistic visibility overrides, keyed by product id. Applied
  // immediately on toggle and reverted on failure, since the `Switch` is
  // otherwise driven directly by the server-fetched `products` prop.
  const [visibilityOverrides, setVisibilityOverrides] = useState<
    Map<string, boolean>
  >(new Map());

  const getIsVisible = (product: FranchiseShopProduct) =>
    visibilityOverrides.get(product.id) ?? product.is_visible;

  const handleToggleVisibility = (product: FranchiseShopProduct) => {
    const previousVisible = getIsVisible(product);
    const nextVisible = !previousVisible;

    setTogglingId(product.id);
    setVisibilityOverrides((prev) => new Map(prev).set(product.id, nextVisible));
    const toastId = toast.loading("Updating franchise visibility...");

    startTransition(async () => {
      // `toggleFranchiseProductVisibility(productId, isVisible, franchiseId?)`
      // — the optional explicit franchise id is honoured only for an
      // authorized Inventory_Admin (Req 19.10, design.md "Server actions").
      const result = await toggleFranchiseProductVisibility(
        product.id,
        nextVisible,
        franchiseId,
      );

      if (result.success) {
        toast.success(
          previousVisible
            ? "Product hidden for this franchise."
            : "Product is now visible for this franchise.",
          { id: toastId },
        );
        router.refresh();
      } else {
        // Revert the optimistic update on failure.
        setVisibilityOverrides((prev) =>
          new Map(prev).set(product.id, previousVisible),
        );
        toast.error(result.error ?? "Failed to update franchise visibility.", {
          id: toastId,
        });
      }

      setTogglingId(null);
    });
  };

  const columns = useMemo<ColumnDef<FranchiseShopProduct>[]>(
    () => [
      {
        id: "product",
        accessorFn: (row) => row.name,
        header: "Product",
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900">
              {row.original.name}
            </p>
            <p className="text-xs text-slate-500">
              {row.original.sku ?? "No SKU"}
            </p>
          </div>
        ),
      },
      {
        accessorKey: "stock_quantity",
        header: "Franchise Stock",
        cell: ({ row }) => {
          const qty = row.original.stock_quantity;
          const isOut = qty === 0;
          return (
            <span
              className={cn(
                "text-sm font-semibold tabular-nums",
                isOut ? "text-red-600" : "text-slate-900",
              )}
            >
              {qty}
            </span>
          );
        },
      },
      {
        accessorKey: "is_visible",
        header: "Franchise Visibility",
        cell: ({ row }) => {
          const product = row.original;
          const isToggling = togglingId === product.id;
          const isVisible = getIsVisible(product);
          return (
            <div className="flex items-center gap-3">
              <Switch
                checked={isVisible}
                disabled={isToggling || isPending}
                onCheckedChange={() => handleToggleVisibility(product)}
                aria-label={
                  isVisible
                    ? "Hide product for this franchise"
                    : "Show product for this franchise"
                }
              />
              <div className="flex items-center gap-1.5 text-sm">
                {isToggling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : isVisible ? (
                  <Eye className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5 text-slate-400" />
                )}
                <span
                  className={cn(
                    "text-xs font-medium",
                    isVisible ? "text-emerald-600" : "text-slate-400",
                  )}
                >
                  {isVisible ? "Visible" : "Hidden"}
                </span>
              </div>
            </div>
          );
        },
      },
    ],
    [isPending, togglingId, visibilityOverrides],
  );

  const totalProducts = products.length;

  return (
    <div className="space-y-6 p-6">
      <AdminPageHeader title={pageTitle} description={pageDescription} />

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">
            Franchise Shop Stock
          </h2>
          <p className="text-xs text-slate-500">
            {totalProducts} product{totalProducts !== 1 ? "s" : ""} shown
          </p>
        </div>
        <div className="px-6 pb-6">
          <DataTable
            columns={columns}
            data={products}
            filterColumn="product"
            filterPlaceholder="Search products by name..."
          />
        </div>
      </div>
    </div>
  );
}
