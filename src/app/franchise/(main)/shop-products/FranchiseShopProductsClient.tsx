"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import { ShoppingBag, Package, Search, Check, Loader2 } from "lucide-react";
import { SectionCard } from "@/shared/components/franchise/ui/GlassCard";
import {
  updateFranchiseProductStock,
  toggleFranchiseProductVisibility,
  type FranchiseShopProduct,
} from "@/actions/admin-actions/franchiseProductActions";

interface OrderRow {
  id: string;
  created_at: string;
  total_amount: number | null;
  status: string | null;
  target_delivery_date: string | null;
  customer_profiles: any;
  addon_order_items: any[];
}

interface Props {
  products: FranchiseShopProduct[];
  recentOrders: OrderRow[];
}

const TH = "text-[11px] font-medium uppercase tracking-wider text-slate-400";

export default function FranchiseShopProductsClient({ products, recentOrders }: Props) {
  const [search, setSearch] = useState("");

  const filteredProducts = useMemo(() => {
    if (!search) return products;
    const term = search.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        p.category?.toLowerCase().includes(term) ||
        p.sku?.toLowerCase().includes(term),
    );
  }, [search, products]);

  const visibleCount = products.filter((p) => p.is_visible).length;

  return (
    <div className="space-y-8">
      <Tabs defaultValue="catalog" className="w-full">
        <TabsList>
          <TabsTrigger value="catalog">
            My Products ({products.length})
          </TabsTrigger>
          <TabsTrigger value="orders">
            Recent Orders ({recentOrders.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="mt-4">
          <SectionCard
            icon={ShoppingBag}
            title="Product Availability"
            subtitle={`${visibleCount} of ${products.length} shown to your customers. Set your stock and toggle visibility.`}
            actions={
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input
                  placeholder="Search products..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 rounded-xl border-slate-200/80 bg-white/60 pl-9 text-sm shadow-sm"
                />
              </div>
            }
          >
            {filteredProducts.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-12">
                No products found.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredProducts.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="orders" className="mt-4">
          <SectionCard
            icon={Package}
            title="Recent Addon Orders"
            subtitle={`${recentOrders.length} orders`}
          >
            {recentOrders.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-12">No orders found.</p>
            ) : (
              <div className="overflow-auto rounded-xl ring-1 ring-slate-100">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/60 hover:bg-slate-50/60">
                      <TableHead className={TH}>Customer</TableHead>
                      <TableHead className={TH}>Items</TableHead>
                      <TableHead className={TH}>Amount</TableHead>
                      <TableHead className={TH}>Date</TableHead>
                      <TableHead className={TH}>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentOrders.map((order: any) => {
                      const profile = Array.isArray(order.customer_profiles)
                        ? order.customer_profiles[0]
                        : order.customer_profiles;
                      const user = Array.isArray(profile?.users) ? profile?.users[0] : profile?.users;
                      const items = order.addon_order_items ?? [];
                      return (
                        <TableRow key={order.id} className="border-slate-100 transition-colors hover:bg-slate-50/40">
                          <TableCell className="text-sm font-medium text-slate-800">
                            {user?.full_name ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs text-slate-600 max-w-[200px] truncate">
                            {items.map((i: any) => `${i.products?.name ?? "Item"} x${i.quantity}`).join(", ")}
                          </TableCell>
                          <TableCell className="text-sm font-mono text-slate-600">
                            {order.total_amount != null ? `₹${Number(order.total_amount).toFixed(0)}` : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-slate-500">
                            {order.created_at ? new Date(order.created_at).toLocaleDateString("en-IN") : "—"}
                          </TableCell>
                          <TableCell>
                            <OrderStatusBadge status={order.status} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProductCard({ product }: { product: FranchiseShopProduct }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [stock, setStock] = useState<string>(String(product.stock_quantity));
  const [isVisible, setIsVisible] = useState(product.is_visible);

  const stockChanged = Number(stock) !== product.stock_quantity;
  const inStock = product.stock_quantity > 0;

  const handleSaveStock = () => {
    const qty = Number(stock);
    if (Number.isNaN(qty) || qty < 0) {
      toast.error("Enter a valid stock quantity.");
      return;
    }
    startTransition(async () => {
      const res = await updateFranchiseProductStock(product.id, qty);
      if (res.success) {
        toast.success("Stock updated.");
        router.refresh();
      } else {
        toast.error(res.error ?? "Failed to update stock.");
      }
    });
  };

  const handleToggleVisibility = (checked: boolean) => {
    setIsVisible(checked);
    startTransition(async () => {
      const res = await toggleFranchiseProductVisibility(product.id, checked);
      if (res.success) {
        toast.success(checked ? "Product visible to customers." : "Product hidden.");
        router.refresh();
      } else {
        setIsVisible(!checked);
        toast.error(res.error ?? "Failed to update visibility.");
      }
    });
  };

  return (
    <div className="rounded-xl bg-white/60 p-4 ring-1 ring-slate-100 transition-all hover:ring-slate-200">
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-800 truncate">{product.name}</h3>
          {product.category && (
            <span className="text-[10px] uppercase tracking-wider text-slate-400">
              {product.category}
            </span>
          )}
        </div>
        <Badge
          variant="outline"
          className={`rounded-lg text-[10px] shrink-0 ${
            !inStock
              ? "bg-rose-50 text-rose-700 border-rose-200"
              : isVisible
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "text-slate-500"
          }`}
        >
          {!inStock ? "Out of stock" : isVisible ? "Shown" : "Hidden"}
        </Badge>
      </div>

      <div className="flex items-baseline gap-2 mt-2">
        {product.sale_price ? (
          <>
            <span className="text-xl font-semibold tracking-tight text-primary">
              ₹{Number(product.sale_price).toFixed(0)}
            </span>
            <span className="text-xs text-slate-400 line-through">
              ₹{Number(product.original_price).toFixed(0)}
            </span>
          </>
        ) : (
          <span className="text-xl font-semibold tracking-tight text-slate-800">
            ₹{Number(product.original_price).toFixed(0)}
          </span>
        )}
      </div>
      {product.sku && (
        <p className="mt-1 text-xs text-slate-400">SKU: {product.sku}</p>
      )}

      {!product.catalog_active && (
        <p className="mt-2 text-[11px] text-amber-600">
          Disabled in the central catalog by admin.
        </p>
      )}

      {/* Stock control */}
      <div className="mt-3 flex items-end gap-2">
        <div className="flex-1">
          <label className="text-[11px] font-medium text-slate-500">My Stock</label>
          <Input
            type="number"
            min={0}
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            disabled={isPending}
            className="h-9 rounded-lg bg-white/70 text-sm"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-9"
          onClick={handleSaveStock}
          disabled={isPending || !stockChanged}
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Save
        </Button>
      </div>

      {/* Visibility toggle */}
      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
        <span className="text-xs text-slate-500">Show to my customers</span>
        <Switch
          checked={isVisible}
          disabled={isPending}
          onCheckedChange={handleToggleVisibility}
        />
      </div>
    </div>
  );
}

function OrderStatusBadge({ status }: { status: string | null }) {
  const colors: Record<string, string> = {
    PAID: "bg-emerald-50 text-emerald-700 border-emerald-200",
    DELIVERED: "bg-blue-50 text-blue-700 border-blue-200",
    CANCELLED: "bg-rose-50 text-rose-700 border-rose-200",
    PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  };

  return (
    <Badge variant="outline" className={`rounded-lg text-[10px] ${colors[status ?? ""] ?? "text-slate-500"}`}>
      {status ?? "—"}
    </Badge>
  );
}
