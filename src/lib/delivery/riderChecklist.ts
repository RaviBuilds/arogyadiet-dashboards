export type ChecklistItem = { id: string; label: string };

export type AddonLine = { name: string; quantity: number };

export function buildAddonLinesFromOrder(order: {
  addon_orders?: unknown;
}): AddonLine[] {
  const addonOrders = order?.addon_orders;
  const list = Array.isArray(addonOrders)
    ? addonOrders
    : addonOrders
      ? [addonOrders]
      : [];

  const lines: AddonLine[] = [];

  for (const addonOrder of list) {
    const rawItems = (addonOrder as { addon_order_items?: unknown })
      ?.addon_order_items;
    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

    for (const item of items) {
      const row = item as {
        quantity?: number;
        products?: { name?: string } | { name?: string }[];
      };
      const product = Array.isArray(row.products)
        ? row.products[0]
        : row.products;
      const name = product?.name;
      const quantity = Number(row.quantity ?? 0);
      if (typeof name !== "string" || !name || quantity <= 0) continue;
      lines.push({ name, quantity });
    }
  }

  return lines;
}

export function buildDeliveryChecklistItems(
  mealName: string,
  addonLines: AddonLine[],
): ChecklistItem[] {
  const items: ChecklistItem[] = [
    { id: "meal", label: mealName || "Meal" },
  ];

  addonLines.forEach((line, index) => {
    const qtyLabel = line.quantity > 1 ? ` (x${line.quantity})` : "";
    items.push({
      id: `addon-${index}`,
      label: `${line.name}${qtyLabel}`,
    });
  });

  return items;
}
