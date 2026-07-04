"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
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
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { KitProductWithCalculations } from "@/types/kitProduct";
import { deleteKitProductAction } from "@/actions/admin-actions/kitProductActions";
import { EditKitProductDialog } from "./EditKitProductDialog";

interface KitProductCardProps {
  product: KitProductWithCalculations;
}

/**
 * KIT Product Card Component
 * 
 * Displays a single KIT product with edit/delete actions.
 */
export function KitProductCard({ product }: KitProductCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteKitProductAction(product.id);
      if (result.success) {
        toast.success(`"${product.name}" has been deleted.`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
      setShowDeleteDialog(false);
    });
  }

  return (
    <>
      <Card className="flex flex-col overflow-hidden border-border/70 shadow-sm transition-shadow hover:shadow-md relative">
        {/* Actions dropdown — top right */}
        <div className="absolute top-3 right-3 z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0 hover:bg-slate-100">
                <MoreHorizontal className="h-4 w-4 text-slate-500" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[150px]">
              <DropdownMenuItem
                onClick={() => setShowEditDialog(true)}
                className="cursor-pointer"
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setShowDeleteDialog(true)}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <CardHeader className="pb-4">
          <CardTitle className="text-xl font-bold text-foreground pr-8">
            {product.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4">
          {/* Base Price */}
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Base Price:</span>
            <span className="text-lg font-semibold text-foreground">
              ₹{product.exclusive_base.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          {/* Tax Amount */}
          <div className="flex items-baseline justify-between border-t pt-3">
            <span className="text-sm text-muted-foreground">Tax (5%):</span>
            <span className="text-sm font-medium text-muted-foreground">
              ₹{product.tax_amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          {/* Total Price */}
          <div className="flex items-baseline justify-between border-t pt-3">
            <span className="text-sm font-semibold text-foreground">Total Price:</span>
            <span className="text-2xl font-bold text-primary">
              ₹{product.total_price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          {/* Active Badge */}
          <div className="mt-2 pt-3 border-t">
            <Badge className="border-0 bg-green-100 text-green-800 hover:bg-green-100">
              Active
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete KIT Product</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{product.name}</strong>? 
              This will deactivate the product — it won&apos;t be available for new subscriptions.
              Existing subscriptions using this product will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Dialog */}
      <EditKitProductDialog
        product={product}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
      />
    </>
  );
}
