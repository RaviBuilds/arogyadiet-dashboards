"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  Edit,
  Layers,
  Loader2,
  Minus,
  MoreVertical,
  Package,
  Plus,
  Trash,
} from "lucide-react";
import { toast } from "sonner";

import { deleteProductAction } from "@/actions/inventory-actions";
import {
  type BaseUom,
  type InventoryCatalogProduct,
  type ProductType,
} from "@/lib/inventory/product-schema";
import type { FranchiseDestination } from "@/lib/franchise-inventory/active-destination-filter";
import { cn } from "@/lib/utils";
import DispatchStockModal from "@/shared/components/admin/inventory/modals/DispatchStockModal";
import EditProductModal from "@/shared/components/admin/inventory/modals/EditProductModal";
import ReceiveStockModal from "@/shared/components/admin/inventory/modals/ReceiveStockModal";
import FranchiseDispatchModal from "@/app/franchise/(main)/inventory/_components/FranchiseDispatchModal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";

const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  RAW_MATERIAL: "Raw Material",
  FINISHED_GOOD: "Finished Good",
};

const BASE_UOM_SHORT_LABELS: Record<BaseUom, string> = {
  KG: "KG",
  LITRE: "Litre",
  UNIT: "Unit",
};

interface ProductCardProps {
  product: InventoryCatalogProduct;
  productManagement?: boolean;
  /** Show the central-kitchen Receive + Dispatch stock buttons. Default true. */
  stockOperations?: boolean;
  /** Franchise portal mode: show only a single franchise Dispatch button. */
  franchiseMode?: boolean;
  /** Active franchise destinations for the dispatch selector. */
  franchiseDestinations?: FranchiseDestination[];
}

export default function ProductCard({
  product,
  productManagement = false,
  stockOperations = true,
  franchiseMode = false,
  franchiseDestinations,
}: ProductCardProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();

  const typeLabel = PRODUCT_TYPE_LABELS[product.type];
  const uomLabel = BASE_UOM_SHORT_LABELS[product.baseUom];
  const totalStock = product.totalStock;

  function handleDelete() {
    startDeleteTransition(async () => {
      const result = await deleteProductAction(product.id);

      if (result.success) {
        toast.success("Product deleted successfully.");
        setDeleteOpen(false);
        router.refresh();
        return;
      }

      toast.error(result.error);
    });
  }

  return (
    <>
      <Card className="group flex flex-col gap-0 overflow-hidden border-border/70 pt-0 shadow-sm transition-shadow hover:shadow-md">
        <div className="relative aspect-square w-full overflow-hidden bg-slate-100">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Package className="size-10 text-muted-foreground/50" />
            </div>
          )}

          {productManagement && (
            <div className="absolute top-2 right-2 z-10">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="h-8 w-8 rounded-full bg-white/80 backdrop-blur"
                  aria-label={`Actions for ${product.name}`}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    setEditOpen(true);
                  }}
                >
                  <Edit className="mr-2 h-4 w-4" />
                  Edit Profile
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={(event) => {
                    event.preventDefault();
                    setDeleteOpen(true);
                  }}
                >
                  <Trash className="mr-2 h-4 w-4" />
                  Delete Product
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          )}
        </div>

        <CardContent className="flex flex-1 flex-col p-4">
          <h3 className="truncate font-bold text-foreground">{product.name}</h3>

          <div className="mt-1 flex items-center gap-1">
            <div
              className={cn(
                "text-lg font-bold",
                totalStock <= 0 ? "text-red-600" : "text-slate-800",
              )}
            >
              {totalStock}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                {uomLabel}
              </span>
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  aria-label={`View batch breakdown for ${product.name}`}
                >
                  <Layers className="size-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-3" align="start">
                <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Batch Breakdown
                </p>
                {product.activeLots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No active batches
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {product.activeLots.map((lot, idx) => (
                      <li key={`${lot.batchNumber}-${idx}`} className="text-sm">
                        <span className="font-medium">Batch:</span>{" "}
                        {lot.batchNumber}
                        <br />
                        <span className="font-medium">Qty:</span>{" "}
                        {lot.quantityRemaining}
                        <br />
                        <span className="font-medium">Exp:</span>{" "}
                        {lot.expiryDate
                          ? format(lot.expiryDate, "dd MMM yyyy")
                          : "—"}
                      </li>
                    ))}
                  </ul>
                )}
              </PopoverContent>
            </Popover>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge className="border-0 bg-green-100 text-green-800 hover:bg-green-100">
              {product.category}
            </Badge>
            <span className="text-xs text-muted-foreground">{typeLabel}</span>
          </div>

          {franchiseMode ? (
          <div className="mt-4 border-t pt-4">
            <FranchiseDispatchModal
              productId={product.id}
              productName={product.name}
              availableQuantity={product.totalStock}
            />
          </div>
          ) : stockOperations ? (
          <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-4">
            <ReceiveStockModal
              productId={product.id}
              productName={product.name}
              baseUom={product.baseUom}
              trigger={
                <Button
                  type="button"
                  size="sm"
                  className="w-full bg-green-600 text-white hover:bg-green-700"
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Receive
                </Button>
              }
            />
            <DispatchStockModal
              productId={product.id}
              productName={product.name}
              baseUom={product.baseUom}
              franchiseDestinations={franchiseDestinations}
              trigger={
                <Button type="button" size="sm" variant="outline" className="w-full">
                  <Minus className="mr-1 h-4 w-4" />
                  Dispatch
                </Button>
              }
            />
          </div>
          ) : null}
        </CardContent>
      </Card>

      {productManagement && (
        <EditProductModal
          product={product}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}

      {productManagement && (
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {product.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete {product.name}? This action cannot
                be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={isDeleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(event) => {
                  event.preventDefault();
                  handleDelete();
                }}
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Deleting...
                  </>
                ) : (
                  "Delete Product"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
