"use client";

import { useState, useMemo } from "react";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { Input } from "@/shared/components/ui/input";
import { ShoppingBag, Package, Search } from "lucide-react";
import { SectionCard } from "@/shared/components/franchise/ui/GlassCard";

interface Product {
  id: string;
  sku: string | null;
  name: string;
  category: string | null;
  original_price: number;
  sale_price: number | null;
  stock_quantity: number | null;
  is_active: boolean;
  image_urls: string[] | null;
  banner_image_url: string | null;
}

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
  products: Product[];
  recentOrders: OrderRow[];
}

const TH = "text-[11px] font-medium uppercase tracking-wider text-slate-400";

export default function FranchiseShopProductsClient({ products, recentOrders }: Props) {
  const [search, setSearch] = useState("");

  const activeProducts = useMemo(() => products.filter((p) => p.is_active), [products]);

  const filteredProducts = useMemo(() => {
    if (!search) return activeProducts;
    const term = search.toLowerCase();
    return activeProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        p.category?.toLowerCase().includes(term) ||
        p.sku?.toLowerCase().includes(term)
    );
  }, [search, activeProducts]);

  return (
    <div className="space-y-8">
      <Tabs defaultValue="catalog" className="w-full">
        <TabsList>
          <TabsTrigger value="catalog">Product Catalog ({activeProducts.length})</TabsTrigger>
          <TabsTrigger value="orders">Recent Orders ({recentOrders.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="mt-4">
          <SectionCard
            icon={ShoppingBag}
            title="Active Products"
            subtitle="Available for your franchise customers"
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
              <p className="text-sm text-slate-400 text-center py-12">No products found.</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredProducts.map((product) => (
                  <div
                    key={product.id}
                    className="rounded-xl bg-white/60 p-4 ring-1 ring-slate-100 transition-all hover:ring-slate-200"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-slate-800 truncate">{product.name}</h3>
                        {product.category && (
                          <span className="text-[10px] uppercase tracking-wider text-slate-400">{product.category}</span>
                        )}
                      </div>
                      <Badge variant="outline" className={`rounded-lg text-[10px] shrink-0 ${product.is_active ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "text-slate-500"}`}>
                        {product.is_active ? "Active" : "Inactive"}
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
                    <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                      {product.sku && <span>SKU: {product.sku}</span>}
                      {product.stock_quantity != null && (
                        <span className={product.stock_quantity < 10 ? "text-rose-500 font-medium" : ""}>
                          Stock: {product.stock_quantity}
                        </span>
                      )}
                    </div>
                  </div>
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
