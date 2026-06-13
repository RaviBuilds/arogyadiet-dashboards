"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  format,
  parseISO,
  startOfMonth,
  subMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  eachMonthOfInterval,
  startOfDay,
  endOfDay,
} from "date-fns";
import type {
  InventoryAnalyticsSnapshot,
  InventoryCategoryValue,
  InventoryExpiringDetail,
  InventoryKPISummary,
  InventoryLowStockDetail,
  InventoryMovementPoint,
  InventoryProductRow,
  InventoryProductType,
  InventorySourceValue,
  InventoryStockStatus,
  InventoryTypeValue,
  ExpiryRiskBucket,
  TopInventoryProduct,
  ShopProductsAnalytics,
  ShopProductRow,
  ShopCategoryValue,
  ShopProductStatus,
  ShopStockStatusSlice,
} from "@/types/bi-dashboard";

const EXPIRY_SOON_WINDOW_DAYS = 14;

const SOURCE_LABELS: Record<string, string> = {
  FARMER: "Farmer",
  VENDOR: "Vendor",
  OTHER: "Other",
  UNKNOWN: "Unspecified",
};

type ProductRecord = {
  id: string;
  name: string;
  category: string | null;
  type: InventoryProductType;
  base_uom: string;
  min_stock_threshold: string | number | null;
};

type LotRecord = {
  id: string;
  product_id: string;
  batch_number: string;
  quantity_remaining: string | number;
  unit_cost: string | number;
  expiry_date: string;
  source_type: string | null;
};

/**
 * Master Inventory Intelligence — full warehouse analytics snapshot.
 * Computed from the live `inventory_products` + active `inventory_lots`.
 */
export async function getInventoryAnalyticsSnapshot(): Promise<InventoryAnalyticsSnapshot> {
  const supabase = createAdminClient();
  const now = new Date();

  const [productsResult, lotsResult, mfgResult] = await Promise.all([
    supabase
      .from("inventory_products")
      .select("id, name, category, type, base_uom, min_stock_threshold"),
    supabase
      .from("inventory_lots")
      .select(
        "id, product_id, batch_number, quantity_remaining, unit_cost, expiry_date, source_type",
      )
      .eq("status", "ACTIVE")
      .gt("quantity_remaining", 0),
    supabase
      .from("manufacturing_orders")
      .select("quantity_sent, manufacturing_outputs(package_size, package_count)")
      .eq("status", "COMPLETED"),
  ]);

  const products = (productsResult.data ?? []) as ProductRecord[];
  const lots = (lotsResult.data ?? []) as LotRecord[];

  const productById = new Map<string, ProductRecord>(
    products.map((p) => [p.id, p]),
  );

  // ── Per-product aggregation ──────────────────────────
  type Agg = {
    quantity: number;
    value: number;
    lots: number;
    nearestExpiry: Date | null;
    hasExpiringSoon: boolean;
    hasExpired: boolean;
  };
  const aggByProduct = new Map<string, Agg>();

  // Category / type / source / expiry accumulators
  const categoryMap = new Map<string, InventoryCategoryValue>();
  const typeAcc: Record<InventoryProductType, { value: number; quantity: number }> = {
    RAW_MATERIAL: { value: 0, quantity: 0 },
    FINISHED_GOOD: { value: 0, quantity: 0 },
  };
  const sourceMap = new Map<string, InventorySourceValue>();

  const bucketDefs: { key: string; order: number; min: number; max: number }[] = [
    { key: "Expired", order: 0, min: -Infinity, max: -1 },
    { key: "0–7 days", order: 1, min: 0, max: 7 },
    { key: "8–14 days", order: 2, min: 8, max: 14 },
    { key: "15–30 days", order: 3, min: 15, max: 30 },
    { key: "30+ days", order: 4, min: 31, max: Infinity },
  ];
  const bucketAcc = new Map<string, ExpiryRiskBucket>(
    bucketDefs.map((b) => [
      b.key,
      { bucket: b.key, order: b.order, lots: 0, value: 0, quantity: 0 },
    ]),
  );

  let totalWarehouseValue = 0;
  let totalQuantity = 0;
  let expiredValue = 0;
  const expiring: InventoryExpiringDetail[] = [];

  for (const lot of lots) {
    const product = productById.get(lot.product_id);
    if (!product) continue;

    const qty = Number(lot.quantity_remaining) || 0;
    const unitCost = Number(lot.unit_cost) || 0;
    const value = qty * unitCost;
    const expiryDate = lot.expiry_date ? new Date(lot.expiry_date) : null;
    const daysToExpiry = expiryDate
      ? differenceInCalendarDays(expiryDate, now)
      : Infinity;

    totalWarehouseValue += value;
    totalQuantity += qty;

    // Per product
    const agg = aggByProduct.get(lot.product_id) ?? {
      quantity: 0,
      value: 0,
      lots: 0,
      nearestExpiry: null,
      hasExpiringSoon: false,
      hasExpired: false,
    };
    agg.quantity += qty;
    agg.value += value;
    agg.lots += 1;
    if (expiryDate && (!agg.nearestExpiry || expiryDate < agg.nearestExpiry)) {
      agg.nearestExpiry = expiryDate;
    }
    if (daysToExpiry < 0) agg.hasExpired = true;
    else if (daysToExpiry <= EXPIRY_SOON_WINDOW_DAYS) agg.hasExpiringSoon = true;
    aggByProduct.set(lot.product_id, agg);

    // Category
    const catName = product.category?.trim() || "Uncategorized";
    const cat = categoryMap.get(catName) ?? {
      category: catName,
      value: 0,
      quantity: 0,
      itemCount: 0,
    };
    cat.value += value;
    cat.quantity += qty;
    categoryMap.set(catName, cat);

    // Type
    typeAcc[product.type].value += value;
    typeAcc[product.type].quantity += qty;

    // Source
    const srcKey = lot.source_type || "UNKNOWN";
    const src = sourceMap.get(srcKey) ?? {
      source: srcKey,
      label: SOURCE_LABELS[srcKey] ?? srcKey,
      value: 0,
      lots: 0,
    };
    src.value += value;
    src.lots += 1;
    sourceMap.set(srcKey, src);

    // Expiry bucket
    const def = bucketDefs.find(
      (b) => daysToExpiry >= b.min && daysToExpiry <= b.max,
    );
    if (def && expiryDate) {
      const bucket = bucketAcc.get(def.key)!;
      bucket.lots += 1;
      bucket.value += value;
      bucket.quantity += qty;
    }

    // Expired value + expiring detail list
    if (daysToExpiry < 0) {
      expiredValue += value;
    }
    if (expiryDate && daysToExpiry >= 0 && daysToExpiry <= EXPIRY_SOON_WINDOW_DAYS) {
      expiring.push({
        lotId: lot.id,
        productName: product.name,
        category: catName,
        batchNumber: lot.batch_number,
        quantityRemaining: qty,
        value,
        expiryDate: lot.expiry_date,
        daysToExpiry,
      });
    }
  }

  // Count unique items in catalog by category
  for (const product of products) {
    const catName = product.category?.trim() || "Uncategorized";
    const cat = categoryMap.get(catName);
    if (cat) cat.itemCount += 1;
  }

  // ── Per-product rows + low stock ─────────────────────
  const productRows: InventoryProductRow[] = [];
  const lowStock: InventoryLowStockDetail[] = [];

  for (const product of products) {
    const agg = aggByProduct.get(product.id);
    const quantity = agg?.quantity ?? 0;
    const value = agg?.value ?? 0;
    const minThreshold = Number(product.min_stock_threshold) || 0;
    const catName = product.category?.trim() || "Uncategorized";

    let status: InventoryStockStatus = "HEALTHY";
    if (quantity <= 0) status = "OUT_OF_STOCK";
    else if (quantity <= minThreshold) status = "LOW_STOCK";
    else if (agg?.hasExpired) status = "EXPIRED";
    else if (agg?.hasExpiringSoon) status = "EXPIRING";

    productRows.push({
      productId: product.id,
      name: product.name,
      category: catName,
      type: product.type,
      baseUom: product.base_uom,
      totalQuantity: quantity,
      totalValue: value,
      avgUnitCost: quantity > 0 ? value / quantity : 0,
      activeLots: agg?.lots ?? 0,
      minStockThreshold: minThreshold,
      nearestExpiry: agg?.nearestExpiry
        ? agg.nearestExpiry.toISOString()
        : null,
      status,
    });

    if (minThreshold > 0 && quantity <= minThreshold) {
      lowStock.push({
        productId: product.id,
        productName: product.name,
        category: catName,
        totalQuantity: quantity,
        minStockThreshold: minThreshold,
        baseUom: product.base_uom,
        shortfall: Math.max(0, minThreshold - quantity),
      });
    }
  }

  productRows.sort((a, b) => b.totalValue - a.totalValue);
  lowStock.sort((a, b) => b.shortfall - a.shortfall);
  expiring.sort((a, b) => a.daysToExpiry - b.daysToExpiry);

  const topProducts: TopInventoryProduct[] = productRows
    .filter((p) => p.totalValue > 0)
    .slice(0, 8)
    .map((p) => ({
      productId: p.productId,
      name: p.name,
      category: p.category,
      type: p.type,
      value: p.totalValue,
      quantity: p.totalQuantity,
      baseUom: p.baseUom,
    }));

  // ── Manufacturing yield (correct calc) ───────────────
  let rawConsumed = 0;
  let finishedProduced = 0;
  for (const order of mfgResult.data ?? []) {
    rawConsumed += Number(order.quantity_sent) || 0;
    const outputs = (order.manufacturing_outputs ?? []) as {
      package_size: number | string;
      package_count: number | string;
    }[];
    for (const out of outputs) {
      finishedProduced +=
        (Number(out.package_size) || 0) * (Number(out.package_count) || 0);
    }
  }
  const manufacturingYieldPercent =
    rawConsumed > 0 ? Math.round((finishedProduced / rawConsumed) * 100) : 0;

  const categoryValues: InventoryCategoryValue[] = Array.from(
    categoryMap.values(),
  ).sort((a, b) => b.value - a.value);

  const typeValues: InventoryTypeValue[] = [
    {
      type: "RAW_MATERIAL",
      label: "Raw Materials",
      value: typeAcc.RAW_MATERIAL.value,
      quantity: typeAcc.RAW_MATERIAL.quantity,
    },
    {
      type: "FINISHED_GOOD",
      label: "Finished Goods",
      value: typeAcc.FINISHED_GOOD.value,
      quantity: typeAcc.FINISHED_GOOD.quantity,
    },
  ];

  const expiryBuckets: ExpiryRiskBucket[] = Array.from(bucketAcc.values()).sort(
    (a, b) => a.order - b.order,
  );

  const sourceValues: InventorySourceValue[] = Array.from(
    sourceMap.values(),
  ).sort((a, b) => b.value - a.value);

  const kpis: InventoryKPISummary = {
    totalWarehouseValue,
    rawMaterialValue: typeAcc.RAW_MATERIAL.value,
    finishedGoodValue: typeAcc.FINISHED_GOOD.value,
    totalUniqueItems: products.length,
    activeLots: lots.length,
    totalQuantity,
    lowStockCount: lowStock.length,
    expiringSoonCount: expiring.length,
    expiredValue,
    manufacturingYieldPercent,
  };

  const categories = Array.from(
    new Set(productRows.map((p) => p.category)),
  ).sort();

  return {
    kpis,
    categoryValues,
    typeValues,
    expiryBuckets,
    sourceValues,
    topProducts,
    products: productRows,
    lowStock,
    expiring,
    categories,
    generatedAt: now.toISOString(),
  };
}

/**
 * Inventory value movement over time, derived from inventory_transactions.
 * Groups by day for short ranges and by month for longer ones.
 */
export async function getInventoryMovementSeries(
  startDate?: string,
  endDate?: string,
): Promise<InventoryMovementPoint[]> {
  const supabase = createAdminClient();
  const now = new Date();
  const rangeStart = startDate
    ? startOfDay(parseISO(startDate))
    : startOfMonth(subMonths(now, 5));
  const rangeEnd = endDate ? endOfDay(parseISO(endDate)) : now;

  const { data } = await supabase
    .from("inventory_transactions")
    .select("transaction_type, financial_value_changed, quantity_changed, timestamp")
    .gte("timestamp", rangeStart.toISOString())
    .lte("timestamp", rangeEnd.toISOString())
    .order("timestamp", { ascending: true });

  const transactions = data ?? [];

  const spanDays = differenceInCalendarDays(rangeEnd, rangeStart);
  const groupByMonth = spanDays > 70;

  type Bucket = {
    inboundValue: number;
    outboundValue: number;
    manufacturingValue: number;
    netValue: number;
  };
  const buckets = new Map<string, Bucket>();

  const keyFor = (d: Date) =>
    groupByMonth ? format(d, "yyyy-MM") : format(d, "yyyy-MM-dd");

  // Seed buckets so the chart has continuous points
  const periods = groupByMonth
    ? eachMonthOfInterval({ start: startOfMonth(rangeStart), end: rangeEnd })
    : eachDayOfInterval({ start: rangeStart, end: rangeEnd });
  for (const p of periods) {
    buckets.set(keyFor(p), {
      inboundValue: 0,
      outboundValue: 0,
      manufacturingValue: 0,
      netValue: 0,
    });
  }

  for (const txn of transactions) {
    if (!txn.timestamp) continue;
    const key = keyFor(new Date(txn.timestamp));
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const fin = Number(txn.financial_value_changed) || 0;

    switch (txn.transaction_type) {
      case "IN":
      case "RECEIVED_FROM_MFG":
        bucket.inboundValue += Math.abs(fin);
        break;
      case "OUT":
      case "EXPIRED":
        bucket.outboundValue += Math.abs(fin);
        break;
      case "SENT_TO_MFG":
        bucket.manufacturingValue += Math.abs(fin);
        break;
    }
    bucket.netValue += fin;
  }

  let cumulative = 0;
  const sortedKeys = Array.from(buckets.keys()).sort();
  return sortedKeys.map((key) => {
    const b = buckets.get(key)!;
    cumulative += b.netValue;
    const date = groupByMonth ? parseISO(`${key}-01`) : parseISO(key);
    return {
      period: groupByMonth ? format(date, "MMM yyyy") : format(date, "dd MMM"),
      inboundValue: Math.round(b.inboundValue),
      outboundValue: Math.round(b.outboundValue),
      manufacturingValue: Math.round(b.manufacturingValue),
      netValue: Math.round(b.netValue),
      cumulativeNetValue: Math.round(cumulative),
    };
  });
}


type ShopProductRecord = {
  id: string;
  sku: string | null;
  name: string;
  category: string | null;
  original_price: string | number | null;
  sale_price: string | number | null;
  stock_quantity: number | null;
  is_active: boolean | null;
  in_stock: boolean | null;
  is_featured: boolean | null;
  image_urls: string[] | null;
  banner_image_url: string | null;
};

const SHOP_STATUS_LABELS: Record<ShopProductStatus, string> = {
  ACTIVE: "Active",
  OUT_OF_STOCK: "Out of Stock",
  INACTIVE: "Inactive",
};

/**
 * Shop Products Analytics — the customer-facing "Browse Shop" catalog
 * (the `products` table managed by Admin → Shop Products).
 */
export async function getShopProductsAnalytics(): Promise<ShopProductsAnalytics> {
  const supabase = createAdminClient();
  const now = new Date();

  const { data } = await supabase
    .from("products")
    .select(
      "id, sku, name, category, original_price, sale_price, stock_quantity, is_active, in_stock, is_featured, image_urls, banner_image_url",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const records = (data ?? []) as ShopProductRecord[];

  const categoryMap = new Map<string, ShopCategoryValue>();
  const statusCount: Record<ShopProductStatus, number> = {
    ACTIVE: 0,
    OUT_OF_STOCK: 0,
    INACTIVE: 0,
  };

  let inventoryValue = 0;
  let inventoryValueAtMrp = 0;
  let onSaleCount = 0;
  let featuredCount = 0;
  let totalStockUnits = 0;
  let activeProducts = 0;

  const products: ShopProductRow[] = records.map((r) => {
    const stockQuantity = Number(r.stock_quantity) || 0;
    const originalPrice = Number(r.original_price) || 0;
    const salePrice =
      r.sale_price === null || r.sale_price === undefined
        ? null
        : Number(r.sale_price);
    const effectivePrice =
      salePrice !== null && salePrice > 0 ? salePrice : originalPrice;
    const discountPercent =
      salePrice !== null && salePrice > 0 && originalPrice > 0
        ? Math.round((1 - salePrice / originalPrice) * 100)
        : 0;

    const isActive = r.is_active !== false;
    const inStock = stockQuantity > 0 && r.in_stock !== false;

    let status: ShopProductStatus = "ACTIVE";
    if (!isActive) status = "INACTIVE";
    else if (!inStock) status = "OUT_OF_STOCK";

    const lineValue = stockQuantity * effectivePrice;
    const lineMrp = stockQuantity * originalPrice;

    inventoryValue += lineValue;
    inventoryValueAtMrp += lineMrp;
    totalStockUnits += stockQuantity;
    if (discountPercent > 0) onSaleCount += 1;
    if (r.is_featured) featuredCount += 1;
    if (status === "ACTIVE") activeProducts += 1;
    statusCount[status] += 1;

    const categoryName = r.category?.trim() || "Uncategorized";
    const cat = categoryMap.get(categoryName) ?? {
      category: categoryName,
      productCount: 0,
      inventoryValue: 0,
      stockUnits: 0,
    };
    cat.productCount += 1;
    cat.inventoryValue += lineValue;
    cat.stockUnits += stockQuantity;
    categoryMap.set(categoryName, cat);

    const imageUrl =
      r.banner_image_url ||
      (Array.isArray(r.image_urls) && r.image_urls.length > 0
        ? r.image_urls[0]
        : null);

    return {
      id: r.id,
      sku: r.sku,
      name: r.name,
      category: categoryName,
      imageUrl,
      stockQuantity,
      originalPrice,
      salePrice,
      effectivePrice,
      discountPercent,
      inventoryValue: lineValue,
      potentialRevenue: lineValue,
      isActive,
      inStock,
      isFeatured: Boolean(r.is_featured),
      status,
    };
  });

  products.sort((a, b) => b.inventoryValue - a.inventoryValue);

  const categoryValues: ShopCategoryValue[] = Array.from(
    categoryMap.values(),
  ).sort((a, b) => b.inventoryValue - a.inventoryValue);

  const stockStatus: ShopStockStatusSlice[] = (
    ["ACTIVE", "OUT_OF_STOCK", "INACTIVE"] as ShopProductStatus[]
  ).map((s) => ({
    status: s,
    label: SHOP_STATUS_LABELS[s],
    count: statusCount[s],
  }));

  const categories = Array.from(
    new Set(products.map((p) => p.category)),
  ).sort();

  return {
    kpis: {
      totalProducts: products.length,
      activeProducts,
      outOfStockCount: statusCount.OUT_OF_STOCK,
      inactiveCount: statusCount.INACTIVE,
      inventoryValue,
      inventoryValueAtMrp,
      onSaleCount,
      featuredCount,
      totalStockUnits,
    },
    products,
    categoryValues,
    stockStatus,
    categories,
    generatedAt: now.toISOString(),
  };
}

/**
 * Re-export of shop/add-on revenue MoM so the Inventory BI page can own all
 * shop-related analytics in one place.
 */
export async function getShopRevenueMoMSeries(
  startDate?: string,
  endDate?: string,
): Promise<{ month: string; revenue: number }[]> {
  const supabase = createAdminClient();
  const now = new Date();
  const rangeStart = startDate
    ? startOfMonth(parseISO(startDate))
    : startOfMonth(subMonths(now, 5));
  const rangeEnd = endDate ? parseISO(endDate) : now;

  const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });

  const { data: addonOrders } = await supabase
    .from("addon_orders")
    .select("total_amount, created_at")
    .in("status", ["PAID", "DELIVERED", "COMPLETED"])
    .gte("created_at", `${format(rangeStart, "yyyy-MM-dd")}T00:00:00`)
    .lte("created_at", `${format(rangeEnd, "yyyy-MM-dd")}T23:59:59`);

  return months.map((month) => {
    const monthStartStr = format(startOfMonth(month), "yyyy-MM-dd");
    const monthEndStr = format(endOfDay(endOfMonthLocal(month)), "yyyy-MM-dd");

    const monthRevenue = (addonOrders || [])
      .filter((o) => {
        const created = o.created_at?.split("T")[0];
        return created && created >= monthStartStr && created <= monthEndStr;
      })
      .reduce((sum, o) => sum + Number(o.total_amount || 0), 0);

    return { month: format(month, "MMM yyyy"), revenue: monthRevenue };
  });
}

function endOfMonthLocal(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
}
