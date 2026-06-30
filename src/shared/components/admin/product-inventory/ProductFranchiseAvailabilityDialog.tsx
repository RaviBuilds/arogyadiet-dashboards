"use client";

import { useState } from "react";
import { Building2, Eye, EyeOff, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import {
  getProductFranchiseAvailability,
  type ProductFranchiseAvailability,
} from "@/actions/admin-actions/franchiseProductActions";

interface Props {
  productId: string;
  productName: string;
}

/**
 * Admin oversight: shows how each franchise has configured a catalog product
 * (visibility + their own stock). Read-only — franchises control these values.
 */
export function ProductFranchiseAvailabilityDialog({ productId, productName }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ProductFranchiseAvailability[]>([]);

  const handleOpenChange = async (next: boolean) => {
    setOpen(next);
    if (next) {
      setLoading(true);
      const data = await getProductFranchiseAvailability(productId);
      setRows(data);
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Building2 className="h-3.5 w-3.5" />
          Franchises
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Franchise availability — {productName}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading franchise settings...
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No franchises configured yet.
          </p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Franchise</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.franchise_id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{row.franchise_name}</span>
                        {row.status !== "active" && (
                          <Badge variant="secondary" className="text-[10px]">
                            {row.status}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.is_visible ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-600">
                          <Eye className="h-3.5 w-3.5" /> Shown
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <EyeOff className="h-3.5 w-3.5" /> Hidden
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={
                          row.stock_quantity === 0
                            ? "font-medium text-rose-600"
                            : "font-medium"
                        }
                      >
                        {row.stock_quantity}
                      </span>
                      {!row.configured && (
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          (not set)
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
