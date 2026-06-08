"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import {
  Apple,
  Bean,
  Droplets,
  LayoutGrid,
  Package,
  PackageOpen,
  Search,
  Sprout,
  Wheat,
  type LucideIcon,
} from "lucide-react";

import type {
  InventoryCatalogProduct,
  ProductType,
} from "@/lib/inventory/product-schema";
import { cn } from "@/lib/utils";
import ProductCard from "@/shared/components/admin/inventory/ProductCard";
import RegisterProductSheet from "@/shared/components/admin/inventory/RegisterProductSheet";
import { Input } from "@/shared/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";

type ActiveProductType = "ALL" | ProductType;

interface InventoryDashboardProps {
  initialProducts: InventoryCatalogProduct[];
}

function getEmptyStateMessage(
  activeType: ActiveProductType,
  searchQuery: string,
  activeCategory: string,
): string {
  if (activeType === "FINISHED_GOOD") {
    return "No finished goods found. Register a new product to get started.";
  }
  if (activeType === "RAW_MATERIAL") {
    return "No raw materials found. Register a new product to get started.";
  }
  if (searchQuery.trim()) {
    return "Try a different search term or category.";
  }
  if (activeCategory !== "All") {
    return `No products in "${activeCategory}".`;
  }
  return "No products found.";
}

function getCategoryIcon(category: string): LucideIcon {
  const normalized = category.toLowerCase();
  if (normalized.includes("grain") || normalized.includes("flour")) return Wheat;
  if (normalized.includes("oil")) return Droplets;
  if (normalized.includes("seed")) return Sprout;
  if (normalized.includes("fruit") || normalized.includes("vegetable")) {
    return Apple;
  }
  if (normalized.includes("pulse") || normalized.includes("bean")) return Bean;
  return Package;
}

export default function InventoryDashboard({
  initialProducts,
}: InventoryDashboardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [activeType, setActiveType] = useState<ActiveProductType>("ALL");

  const categories = useMemo(() => {
    const typeScoped =
      activeType === "ALL"
        ? initialProducts
        : initialProducts.filter((product) => product.type === activeType);
    const unique = [...new Set(typeScoped.map((product) => product.category))].sort();
    return ["All", ...unique];
  }, [initialProducts, activeType]);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return initialProducts.filter((product) => {
      const matchesType =
        activeType === "ALL" || product.type === activeType;
      const matchesSearch =
        !query ||
        product.name.toLowerCase().includes(query) ||
        product.category.toLowerCase().includes(query);
      const matchesCategory =
        activeCategory === "All" || product.category === activeCategory;
      return matchesType && matchesSearch && matchesCategory;
    });
  }, [initialProducts, searchQuery, activeCategory, activeType]);

  const productsByCategory = useMemo(() => {
    const groups = new Map<string, InventoryCatalogProduct[]>();
    for (const product of filteredProducts) {
      const list = groups.get(product.category) ?? [];
      list.push(product);
      groups.set(product.category, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredProducts]);

  if (initialProducts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 px-6 py-16 text-center">
        <PackageOpen className="mb-3 size-10 text-muted-foreground/60" />
        <p className="font-medium text-foreground">No products registered yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Use &quot;Register New Product&quot; to add your first item to the
          master catalog.
        </p>
        <div className="mt-4">
          <RegisterProductSheet />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="relative mb-6 flex min-h-32 items-start overflow-hidden rounded-xl bg-gradient-to-r from-orange-50 to-orange-100/50 p-4 sm:items-center sm:p-6">
        <div className="relative z-10 min-w-0 max-w-full flex-1 pr-2 sm:max-w-[65%] md:max-w-[50%]">
          <h1 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl md:text-2xl">
            Warehouse Inventory Master
          </h1>
          <p className="mt-1 text-xs leading-snug text-slate-600 sm:text-sm">
            Browse the master catalog and register new raw materials or finished
            goods.
          </p>
          <div className="mt-2 sm:mt-3 [&_button]:h-8 [&_button]:px-2.5 [&_button]:text-xs sm:[&_button]:h-9 sm:[&_button]:px-3 sm:[&_button]:text-sm">
            <RegisterProductSheet />
          </div>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-2/5 sm:block md:w-1/2">
          <div className="absolute inset-0 z-10 bg-gradient-to-r from-orange-50 via-orange-50/90 to-transparent sm:via-orange-50/80" />
          <Image
            src="/inventory.jpg"
            alt="Warehouse Inventory"
            fill
            className="object-cover object-center opacity-80"
            priority
          />
        </div>
      </div>

      <div className="relative mb-6">
        <Search className="absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-14 rounded-full pl-12 text-lg shadow-sm"
          placeholder='Search for "coconut oil" or "seeds"...'
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </div>

      <Tabs
        value={activeType}
        onValueChange={(value) => {
          setActiveType(value as ActiveProductType);
          setActiveCategory("All");
        }}
        className="mb-4 mt-6 w-full"
      >
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="ALL">All Items</TabsTrigger>
          <TabsTrigger value="RAW_MATERIAL">Raw Materials</TabsTrigger>
          <TabsTrigger value="FINISHED_GOOD">Finished Goods</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="relative -mx-6 min-h-[500px] border-t bg-slate-50/50 px-6 py-8">
        <div
          className="pointer-events-none absolute inset-0 z-0 opacity-[0.12]"
          style={{
            backgroundImage: "url('/inventory-bg-pattern.png')",
            backgroundRepeat: "repeat",
            backgroundSize: "400px",
          }}
        />
        <div className="relative z-10">
          <div className="mb-6 flex gap-4 overflow-x-auto pb-2">
        {categories.map((category) => {
          const Icon =
            category === "All" ? LayoutGrid : getCategoryIcon(category);
          const isActive = activeCategory === category;

          return (
            <button
              key={category}
              type="button"
              onClick={() => setActiveCategory(category)}
              className="flex shrink-0 flex-col items-center gap-2"
            >
              <div
                className={cn(
                  "flex size-14 items-center justify-center rounded-full border bg-white shadow-sm transition-colors",
                  isActive
                    ? "border-orange-300 bg-orange-50"
                    : "border-slate-200 hover:border-slate-300",
                )}
              >
                <Icon
                  className={cn(
                    "size-6",
                    isActive ? "text-orange-600" : "text-slate-500",
                  )}
                />
              </div>
              <span
                className={cn(
                  "max-w-[72px] truncate text-xs font-medium",
                  isActive ? "text-orange-700" : "text-slate-600",
                )}
              >
                {category}
              </span>
            </button>
          );
        })}
      </div>

      {filteredProducts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 px-6 py-12 text-center">
          <p className="font-medium text-foreground">No products found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {getEmptyStateMessage(activeType, searchQuery, activeCategory)}
          </p>
          {(activeType === "RAW_MATERIAL" || activeType === "FINISHED_GOOD") && (
            <div className="mt-4">
              <RegisterProductSheet />
            </div>
          )}
        </div>
      ) : (
        productsByCategory.map(([category, products]) => (
          <section key={category}>
            <div className="mb-4 mt-8 flex items-baseline gap-2">
              <h2 className="text-2xl font-bold capitalize text-slate-900">
                {category}
              </h2>
              <span className="text-lg font-medium text-slate-400">
                ({products.length})
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </section>
        ))
      )}
        </div>
      </div>
    </div>
  );
}
