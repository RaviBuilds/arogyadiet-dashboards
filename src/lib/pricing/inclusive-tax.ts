export type ShopOrderLine = {
  gross: number;
  taxPercent: number;
};

export type ShopOrderDiscount = {
  type: "PERCENTAGE" | "FLAT" | null;
  value: number;
};

export type ShopOrderBreakdown = {
  grossSubtotal: number;
  baseSubtotal: number;
  discount: number;
  tax: number;
  total: number;
  effectiveTaxPercent: number | null;
  displayTaxPercent: number | null;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function splitInclusiveLine(
  gross: number,
  taxPercent: number | null | undefined,
): { base: number; tax: number } {
  const rate = taxPercent ?? 0;

  if (rate <= 0 || gross <= 0) {
    return { base: round2(gross), tax: 0 };
  }

  const base = round2(gross / (1 + rate / 100));
  const tax = round2(gross - base);

  return { base, tax };
}

function resolveDiscountAmount(
  grossSubtotal: number,
  discount?: ShopOrderDiscount,
): number {
  if (!discount?.type || grossSubtotal <= 0) {
    return 0;
  }

  let amount = 0;

  if (discount.type === "PERCENTAGE") {
    amount = round2((grossSubtotal * discount.value) / 100);
  } else if (discount.type === "FLAT") {
    amount = round2(discount.value);
  }

  return Math.min(Math.max(amount, 0), grossSubtotal);
}

export function calculateShopOrderBreakdown(
  lines: ShopOrderLine[],
  discount?: ShopOrderDiscount,
): ShopOrderBreakdown {
  const grossSubtotal = round2(
    lines.reduce((sum, line) => sum + line.gross, 0),
  );
  const discountAmount = resolveDiscountAmount(grossSubtotal, discount);

  if (grossSubtotal <= 0) {
    return {
      grossSubtotal: 0,
      baseSubtotal: 0,
      discount: 0,
      tax: 0,
      total: 0,
      effectiveTaxPercent: null,
      displayTaxPercent: null,
    };
  }

  let baseSubtotal = 0;
  let tax = 0;

  for (const line of lines) {
    const lineShare = line.gross / grossSubtotal;
    const lineDiscountedGross = round2(
      line.gross - discountAmount * lineShare,
    );
    const split = splitInclusiveLine(lineDiscountedGross, line.taxPercent);
    baseSubtotal += split.base;
    tax += split.tax;
  }

  baseSubtotal = round2(baseSubtotal);
  tax = round2(tax);
  const total = round2(grossSubtotal - discountAmount);

  const uniqueRates = [...new Set(lines.map((line) => line.taxPercent ?? 0))];
  const displayTaxPercent =
    uniqueRates.length === 1 ? uniqueRates[0] : null;

  const effectiveTaxPercent =
    baseSubtotal > 0 ? round2((tax / baseSubtotal) * 100) : null;

  return {
    grossSubtotal,
    baseSubtotal,
    discount: discountAmount,
    tax,
    total,
    effectiveTaxPercent,
    displayTaxPercent,
  };
}
