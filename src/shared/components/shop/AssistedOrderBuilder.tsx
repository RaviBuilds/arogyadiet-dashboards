"use client";

// src/shared/components/shop/AssistedOrderBuilder.tsx
//
// Feature: admin-place-shop-order-for-customer — shared assisted-order UI (task 9.1).
//
// A SHARED, portal-agnostic client leaf used by BOTH the admin and franchise shop
// sections. Module boundaries forbid importing admin-actions or franchise-actions
// here, so the concrete server actions are INJECTED via the `actions` prop; each
// portal binds its own wrapper (which resolves and enforces the operator context
// server-side). This component owns only presentation + local UX state.
//
// Flow: cart builder → customer search/select → pricing review → Mark-Paid →
// Place Order. The Place Order button stays disabled until the operator has
// marked the order PAID (Req 5.2, 5.4) — a UX affordance only; the server
// re-checks the PAID status before creating any record.
//
// It reuses the pure cart helpers from `@/lib/shop/assisted-order/core`
// (`addToCart`, `setCartQuantity`, `removeFromCart`, `validateQuantity`) so the
// cart line model stays identical to the server. It surfaces the required
// messages: empty-cart (Req 1.11), too-short-query (Req 2.3), no-match (Req 2.5),
// and ineligible customer (Req 3.6). Pricing (subtotal/tax/discount/total) is
// displayed exactly as returned by the server (Req 4.4).
//
// Requirements: 1.1, 1.3, 1.11, 2.4, 2.5, 3.6, 4.4, 5.2, 5.4

import { useMemo, useState, useTransition } from "react";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Minus,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Badge } from "@/shared/components/ui/badge";
import { Separator } from "@/shared/components/ui/separator";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { cn } from "@/lib/utils";

import {
  addToCart,
  removeFromCart,
  setCartQuantity,
  validateQuantity,
  validateSearchQuery,
  MAX_QTY,
  type CartLine,
} from "@/lib/shop/assisted-order/core";
import type { AssistedOrderPricing } from "@/lib/shop/assisted-order/pricing";
import type { ShopOrderDiscount } from "@/lib/pricing/inclusive-tax";
// Type-only imports (erased at build time) — no runtime dependency on the
// server-only service module.
import type {
  CustomerSearchKind,
  CustomerSearchResult,
  PlaceOrderOutcome,
} from "@/services/AssistedOrderService";

// ---------------------------------------------------------------------------
// Public props contract (consumed by the admin / franchise page-wiring tasks)
// ---------------------------------------------------------------------------

/**
 * Discriminated result returned by every injected action. Matches the shape both
 * portal wrappers already return (`{ success, data | error }`).
 */
export type AssistedOrderActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * The set of server actions this component depends on. Each portal injects its
 * own wrapper so the shared component never imports portal-specific actions.
 * Signatures mirror `assistedOrderActions.ts` / `franchiseAssistedOrderActions.ts`.
 */
export type AssistedOrderActions = {
  searchCustomersAction: (
    query: string,
    kind: CustomerSearchKind,
  ) => Promise<AssistedOrderActionResult<CustomerSearchResult[]>>;
  checkEligibilityAction: (
    customerProfileId: string,
  ) => Promise<
    AssistedOrderActionResult<{
      eligible: boolean;
      reason?: string;
      /**
       * The resolved next non-paused delivery day (ISO `YYYY-MM-DD`). `null`
       * when the customer is eligible but every upcoming day is paused.
       */
      nextDeliveryDate?: string | null;
    }>
  >;
  priceCartAction: (
    cart: CartLine[],
    discount?: ShopOrderDiscount,
  ) => Promise<AssistedOrderActionResult<AssistedOrderPricing>>;
  markPaidAndPlaceOrderAction: (
    cart: CartLine[],
    customerProfileId: string,
    discount?: ShopOrderDiscount,
    clinicPickup?: boolean,
  ) => Promise<AssistedOrderActionResult<PlaceOrderOutcome>>;
};

/**
 * A shop product as presented in the assisted-order catalog. The page fetches
 * these server-side (the same catalog the customer checkout uses for the given
 * portal context) and passes them down; the component never fetches products.
 */
export type AssistedOrderProduct = {
  id: string;
  name: string;
  sku?: string | null;
  category?: string | null;
  /** List price (₹). */
  originalPrice: number;
  /** Sale price (₹) when on sale; the unit price the customer is charged. */
  salePrice?: number | null;
  taxPercent?: number | null;
  imageUrl?: string | null;
};

export interface AssistedOrderBuilderProps {
  /** The shop catalog to build the cart from (portal-scoped, fetched server-side). */
  products: AssistedOrderProduct[];
  /** Portal-injected server actions (admin or franchise wrapper). */
  actions: AssistedOrderActions;
  /**
   * Short label for the operator's scope, shown in the header (e.g. "Core" or a
   * franchise name). Presentation only.
   */
  scopeLabel?: string;
  /** Optional callback fired after a successful placement. */
  onPlaced?: (outcome: PlaceOrderOutcome) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAID_STATUS = "PAID";
const PENDING_STATUS = "PENDING";

function formatMoney(value: number): string {
  return `₹${value.toFixed(2)}`;
}

/**
 * Format an ISO `YYYY-MM-DD` delivery day for display (e.g. "Fri, 25 Jul 2026").
 * Parsed as a UTC calendar date so the label never shifts across timezones.
 */
function formatDeliveryDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Resolve the display unit price for a product (`sale_price ?? original_price`). */
function displayUnitPrice(product: AssistedOrderProduct): number {
  if (
    typeof product.salePrice === "number" &&
    Number.isFinite(product.salePrice) &&
    product.salePrice >= 0
  ) {
    return product.salePrice;
  }
  return product.originalPrice;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AssistedOrderBuilder({
  products,
  actions,
  scopeLabel,
  onPlaced,
}: AssistedOrderBuilderProps) {
  // --- Cart state ---------------------------------------------------------
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartError, setCartError] = useState<string | null>(null);

  // --- Customer search state ---------------------------------------------
  const [searchKind, setSearchKind] = useState<CustomerSearchKind>("MOBILE");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CustomerSearchResult[]>([]);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, startSearch] = useTransition();

  // --- Selection + eligibility state -------------------------------------
  const [selectedCustomer, setSelectedCustomer] =
    useState<CustomerSearchResult | null>(null);
  const [eligibilityError, setEligibilityError] = useState<string | null>(null);
  const [isChecking, startChecking] = useTransition();
  // The resolved next non-paused delivery day for the selected customer.
  //   undefined → not yet resolved (no customer selected)
  //   null      → eligible but every upcoming day is paused (no day to ride along)
  //   string    → the ISO delivery day the order will ride along with
  const [nextDeliveryDate, setNextDeliveryDate] = useState<
    string | null | undefined
  >(undefined);

  // --- Pricing state ------------------------------------------------------
  const [pricing, setPricing] = useState<AssistedOrderPricing | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [isPricing, startPricing] = useTransition();

  // --- Fulfillment mode ---------------------------------------------------
  // When true, the customer collects the product at the clinic: the order is
  // placed already delivered (clinic pickup) and never enters routing, so the
  // "no upcoming delivery day" rule does not apply.
  const [clinicPickup, setClinicPickup] = useState(false);

  // --- Payment / placement state -----------------------------------------
  const [paymentStatus, setPaymentStatus] = useState<string>(PENDING_STATUS);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placedOutcome, setPlacedOutcome] = useState<PlaceOrderOutcome | null>(
    null,
  );
  const [isPlacing, startPlacing] = useTransition();

  const productById = useMemo(() => {
    const map = new Map<string, AssistedOrderProduct>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const isPaid = paymentStatus === PAID_STATUS;
  // Eligible but no upcoming open day: for a routed order the server would
  // reject placement, so surface it and disable the action up front. A clinic
  // pickup does not ride a delivery, so this rule does not apply.
  const hasNoDeliveryDay =
    !clinicPickup && !!selectedCustomer && nextDeliveryDate === null;
  const canPlace =
    isPaid &&
    cart.length > 0 &&
    !!selectedCustomer &&
    (clinicPickup || !!nextDeliveryDate) &&
    !placedOutcome;

  // Any change to the cart or the selected customer invalidates a prior
  // pricing/paid step so the operator can never place a stale order.
  function invalidateDownstream() {
    setPricing(null);
    setPricingError(null);
    setPaymentStatus(PENDING_STATUS);
    setPlaceError(null);
  }

  // --- Cart handlers ------------------------------------------------------

  function handleAddProduct(productId: string) {
    setCartError(null);
    const result = addToCart(cart, productId, 1);
    if (!result.ok) {
      setCartError(result.error);
      return;
    }
    setCart(result.cart);
    invalidateDownstream();
  }

  function handleSetQuantity(productId: string, rawQty: number) {
    setCartError(null);
    // 0 removes the line; everything else must pass the [1, MAX_QTY] guard.
    if (rawQty !== 0) {
      const validated = validateQuantity(rawQty);
      if (!validated.ok) {
        setCartError(validated.error);
        return;
      }
    }
    const result = setCartQuantity(cart, productId, rawQty);
    if (!result.ok) {
      setCartError(result.error);
      return;
    }
    setCart(result.cart);
    invalidateDownstream();
  }

  function handleRemove(productId: string) {
    setCartError(null);
    setCart(removeFromCart(cart, productId));
    invalidateDownstream();
  }

  // --- Search handlers ----------------------------------------------------

  function handleSearch() {
    setSearchMessage(null);

    // Client-side length guard mirrors the server (Req 2.3): show the
    // minimum-length message without performing a lookup.
    const validation = validateSearchQuery(searchQuery, searchKind);
    if (!validation.ok) {
      setSearchResults([]);
      setHasSearched(false);
      setSearchMessage(validation.error);
      return;
    }

    startSearch(async () => {
      const res = await actions.searchCustomersAction(searchQuery, searchKind);
      setHasSearched(true);
      if (!res.success) {
        setSearchResults([]);
        setSearchMessage(res.error);
        return;
      }
      setSearchResults(res.data);
      // No-match message (Req 2.5). The built cart is retained regardless.
      setSearchMessage(
        res.data.length === 0 ? "No matching customers were found." : null,
      );
    });
  }

  function handleSelectCustomer(customer: CustomerSearchResult) {
    // Ineligible customers are not selectable (Req 3.6).
    if (!customer.eligible) {
      return;
    }
    setEligibilityError(null);
    setPlacedOutcome(null);
    setNextDeliveryDate(undefined);
    invalidateDownstream();

    // Re-verify eligibility at selection time via the server (Req 3.5, 3.6) and
    // capture the resolved next delivery day for the preview (Req 6.2).
    startChecking(async () => {
      const res = await actions.checkEligibilityAction(customer.customerProfileId);
      if (!res.success) {
        setSelectedCustomer(null);
        setEligibilityError(res.error);
        return;
      }
      if (!res.data.eligible) {
        setSelectedCustomer(null);
        setEligibilityError(
          res.data.reason ?? "This customer is not eligible to receive an order.",
        );
        return;
      }
      setSelectedCustomer(customer);
      setNextDeliveryDate(res.data.nextDeliveryDate ?? null);
    });
  }

  function handleClearCustomer() {
    setSelectedCustomer(null);
    setEligibilityError(null);
    setNextDeliveryDate(undefined);
    invalidateDownstream();
    setPlacedOutcome(null);
  }

  // --- Pricing handler ----------------------------------------------------

  function handleReviewPricing() {
    setPricingError(null);
    // Empty-cart guard (Req 1.11).
    if (cart.length === 0) {
      setPricingError("Add at least one product before reviewing pricing.");
      return;
    }
    startPricing(async () => {
      const res = await actions.priceCartAction(cart);
      if (!res.success) {
        setPricing(null);
        setPricingError(res.error);
        return;
      }
      setPricing(res.data);
      // A fresh price resets any prior mark-paid so placement re-confirms.
      setPaymentStatus(PENDING_STATUS);
      setPlaceError(null);
    });
  }

  // --- Mark paid (local UX affordance only) ------------------------------

  function handleMarkPaid() {
    // No online charge and no server call here — this only flips the local
    // status that gates the Place Order button (Req 5.2, 5.4). The MANUAL/PAID
    // payment record is created atomically server-side during placement.
    setPaymentStatus(PAID_STATUS);
    setPlaceError(null);
  }

  // --- Place order --------------------------------------------------------

  function handlePlaceOrder() {
    setPlaceError(null);

    // Client-side guards mirror the server checks (which remain authoritative).
    if (cart.length === 0) {
      setPlaceError("At least one product is required to place the order.");
      return;
    }
    if (!selectedCustomer) {
      setPlaceError("Select an eligible customer before placing the order.");
      return;
    }
    if (!clinicPickup && !nextDeliveryDate) {
      setPlaceError(
        "This customer has no upcoming delivery day (all upcoming days are paused).",
      );
      return;
    }
    if (!isPaid) {
      setPlaceError("Mark the order as paid before placing it.");
      return;
    }

    startPlacing(async () => {
      const res = await actions.markPaidAndPlaceOrderAction(
        cart,
        selectedCustomer.customerProfileId,
        undefined,
        clinicPickup,
      );
      if (!res.success) {
        setPlaceError(res.error);
        return;
      }
      setPlacedOutcome(res.data);
      onPlaced?.(res.data);
    });
  }

  function handleStartNewOrder() {
    setCart([]);
    setCartError(null);
    setSearchQuery("");
    setSearchResults([]);
    setSearchMessage(null);
    setHasSearched(false);
    setSelectedCustomer(null);
    setEligibilityError(null);
    setNextDeliveryDate(undefined);
    setPricing(null);
    setPricingError(null);
    setPaymentStatus(PENDING_STATUS);
    setPlaceError(null);
    setPlacedOutcome(null);
    setClinicPickup(false);
  }

  // ------------------------------------------------------------------------
  // Success screen
  // ------------------------------------------------------------------------

  if (placedOutcome) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="size-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Order placed</h2>
            <p className="text-sm text-muted-foreground">
              Order <span className="font-mono">{placedOutcome.addonOrderId}</span>{" "}
              was created and paid.
            </p>
            {placedOutcome.clinicPickup ? (
              <>
                <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-teal-700">
                  <ShoppingCart className="size-4" />
                  Marked delivered — clinic pickup
                </p>
                <p className="text-xs text-muted-foreground">
                  The customer collected this at the clinic, so it won&apos;t be
                  sent for delivery.
                </p>
              </>
            ) : (
              <>
                <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-blue-700">
                  <CalendarClock className="size-4" />
                  Will be dispatched with the delivery on{" "}
                  {formatDeliveryDate(placedOutcome.targetDeliveryDate)}
                </p>
                <p className="text-xs text-muted-foreground">
                  If the customer pauses that day, the order automatically moves
                  to their next available delivery day.
                </p>
              </>
            )}
          </div>
          {placedOutcome.unfulfillable ? (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-left text-sm text-amber-800">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>
                The order is paid, but franchise stock could not be reserved for
                one or more items. An admin has been notified to resolve the
                payment-versus-stock mismatch manually.
              </span>
            </div>
          ) : null}
          <Button onClick={handleStartNewOrder}>Place another order</Button>
        </CardContent>
      </Card>
    );
  }

  // ------------------------------------------------------------------------
  // Builder
  // ------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* ---- Left column: catalog + customer ---- */}
      <div className="flex flex-1 flex-col gap-4">
        {/* Catalog / cart builder */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="size-4" /> Build the cart
            </CardTitle>
            <CardDescription>
              {scopeLabel
                ? `Add shop products for a ${scopeLabel} customer.`
                : "Add shop products to the order."}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {cartError ? (
              <p className="mb-3 flex items-center gap-1.5 text-sm text-destructive">
                <AlertCircle className="size-4" /> {cartError}
              </p>
            ) : null}

            {products.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No products are available for this shop.
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {products.map((product) => {
                  const line = cart.find((l) => l.productId === product.id);
                  const unit = displayUnitPrice(product);
                  return (
                    <li
                      key={product.id}
                      className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {product.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatMoney(unit)}
                          {product.category ? ` · ${product.category}` : ""}
                        </p>
                      </div>
                      {line ? (
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="outline"
                            aria-label={`Decrease ${product.name}`}
                            onClick={() =>
                              handleSetQuantity(product.id, line.quantity - 1)
                            }
                          >
                            <Minus />
                          </Button>
                          <span className="w-8 text-center text-sm font-medium tabular-nums">
                            {line.quantity}
                          </span>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="outline"
                            aria-label={`Increase ${product.name}`}
                            disabled={line.quantity >= MAX_QTY}
                            onClick={() =>
                              handleSetQuantity(product.id, line.quantity + 1)
                            }
                          >
                            <Plus />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleAddProduct(product.id)}
                        >
                          <Plus /> Add
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Customer search + select */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <Search className="size-4" /> Find the customer
            </CardTitle>
            <CardDescription>
              Search by mobile number (min 3 digits) or name (min 2 characters).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex gap-1 rounded-lg border p-0.5">
                {(["MOBILE", "NAME"] as const).map((kind) => (
                  <Button
                    key={kind}
                    type="button"
                    size="sm"
                    variant={searchKind === kind ? "default" : "ghost"}
                    onClick={() => {
                      setSearchKind(kind);
                      setSearchMessage(null);
                    }}
                  >
                    {kind === "MOBILE" ? "Mobile" : "Name"}
                  </Button>
                ))}
              </div>
              <div className="flex flex-1 items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="assisted-customer-search" className="sr-only">
                    Search customers
                  </Label>
                  <Input
                    id="assisted-customer-search"
                    value={searchQuery}
                    inputMode={searchKind === "MOBILE" ? "numeric" : "text"}
                    placeholder={
                      searchKind === "MOBILE"
                        ? "Enter mobile digits"
                        : "Enter customer name"
                    }
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSearch();
                    }}
                  />
                </div>
                <Button
                  type="button"
                  onClick={handleSearch}
                  disabled={isSearching}
                >
                  {isSearching ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Search />
                  )}
                  Search
                </Button>
              </div>
            </div>

            {searchMessage ? (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <AlertCircle className="size-4" /> {searchMessage}
              </p>
            ) : null}

            {eligibilityError ? (
              <p className="flex items-center gap-1.5 text-sm text-destructive">
                <UserX className="size-4" /> {eligibilityError}
              </p>
            ) : null}

            {/* Selected customer */}
            {selectedCustomer ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <div className="flex items-center gap-2">
                    <UserCheck className="size-4 text-emerald-700" />
                    <div>
                      <p className="text-sm font-medium">
                        {selectedCustomer.fullName || "Unnamed customer"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {selectedCustomer.mobile}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleClearCustomer}
                  >
                    Change
                  </Button>
                </div>

                {/* Next non-paused delivery day preview (Req 6.2). Suppressed
                    for a clinic pickup, which does not ride a delivery. */}
                {clinicPickup ? (
                  <div className="flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800">
                    <ShoppingCart className="size-4 shrink-0" />
                    <span>
                      Clinic pickup — the order will be marked delivered
                      immediately and won&apos;t be sent for delivery.
                    </span>
                  </div>
                ) : nextDeliveryDate ? (
                  <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                    <CalendarClock className="size-4 shrink-0" />
                    <span>
                      Next delivery:{" "}
                      <span className="font-semibold">
                        {formatDeliveryDate(nextDeliveryDate)}
                      </span>
                      . The order will ride along with this delivery.
                    </span>
                  </div>
                ) : hasNoDeliveryDay ? (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span>
                      This customer has no upcoming delivery day — every upcoming
                      day is paused. You can&apos;t place an order until they have
                      an active (non-paused) day.
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Results */}
            {!selectedCustomer && searchResults.length > 0 ? (
              <ul className="divide-y rounded-lg border">
                {searchResults.map((customer) => (
                  <li
                    key={customer.customerProfileId}
                    className="flex items-center justify-between gap-3 p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {customer.fullName || "Unnamed customer"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {customer.mobile}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {customer.eligible ? (
                        <Button
                          type="button"
                          size="sm"
                          disabled={isChecking}
                          onClick={() => handleSelectCustomer(customer)}
                        >
                          {isChecking ? (
                            <Loader2 className="animate-spin" />
                          ) : null}
                          Select
                        </Button>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="cursor-not-allowed"
                          title={customer.ineligibleReason}
                        >
                          {customer.ineligibleReason ?? "Not eligible"}
                        </Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {!selectedCustomer &&
            hasSearched &&
            !isSearching &&
            searchResults.length === 0 &&
            !searchMessage ? (
              <p className="text-sm text-muted-foreground">
                No matching customers were found.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* ---- Right column: summary + pricing + place ---- */}
      <Card className="w-full lg:sticky lg:top-4 lg:w-96">
        <CardHeader className="border-b">
          <CardTitle>Order summary</CardTitle>
          <CardDescription>
            {cartCount > 0
              ? `${cartCount} item${cartCount === 1 ? "" : "s"} in cart`
              : "No items yet"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {/* Cart lines */}
          {cart.length === 0 ? (
            <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
              Add at least one product to place an order.
            </p>
          ) : (
            <ul className="space-y-2">
              {cart.map((line) => {
                const product = productById.get(line.productId);
                const unit = product ? displayUnitPrice(product) : 0;
                return (
                  <li
                    key={line.productId}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {product?.name ?? line.productId}
                      <span className="text-muted-foreground">
                        {" "}
                        × {line.quantity}
                      </span>
                    </span>
                    <span className="tabular-nums">
                      {formatMoney(unit * line.quantity)}
                    </span>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Remove ${product?.name ?? "product"}`}
                      onClick={() => handleRemove(line.productId)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          <Separator />

          {/* Fulfillment mode: clinic pickup vs ride-along delivery. */}
          <label
            htmlFor="assisted-clinic-pickup"
            className="flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer"
          >
            <Checkbox
              id="assisted-clinic-pickup"
              checked={clinicPickup}
              onCheckedChange={(v) => {
                setClinicPickup(v === true);
                setPlaceError(null);
              }}
              className="mt-0.5"
            />
            <div className="space-y-0.5">
              <p className="text-sm font-medium leading-none">Clinic pickup</p>
              <p className="text-xs text-muted-foreground">
                Customer collects at the clinic. The order is marked delivered
                right away and is not sent for delivery.
              </p>
            </div>
          </label>

          {/* Pricing review (Req 4.4) */}
          {pricing ? (
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular-nums">{formatMoney(pricing.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tax</dt>
                <dd className="tabular-nums">{formatMoney(pricing.tax)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Discount</dt>
                <dd className="tabular-nums">
                  {pricing.discount > 0
                    ? `- ${formatMoney(pricing.discount)}`
                    : formatMoney(0)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Delivery fee</dt>
                <dd className="tabular-nums">{formatMoney(pricing.deliveryFee)}</dd>
              </div>
              <Separator className="my-1" />
              <div className="flex justify-between text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatMoney(pricing.total)}</dd>
              </div>
            </dl>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleReviewPricing}
              disabled={cart.length === 0 || !selectedCustomer || isPricing}
            >
              {isPricing ? <Loader2 className="animate-spin" /> : null}
              Review pricing
            </Button>
          )}

          {pricingError ? (
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertCircle className="size-4" /> {pricingError}
            </p>
          ) : null}

          {!selectedCustomer && cart.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Select an eligible customer to review pricing.
            </p>
          ) : null}

          {/* Mark paid + place (Req 5.2, 5.4) */}
          {pricing ? (
            <div className="space-y-2">
              {isPaid ? (
                <p className="flex items-center gap-1.5 text-sm text-emerald-700">
                  <CheckCircle2 className="size-4" /> Marked as paid (offline)
                </p>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={handleMarkPaid}
                >
                  Mark as paid
                </Button>
              )}

              <Button
                type="button"
                className="w-full"
                // Disabled until the order is marked PAID (Req 5.2). The server
                // re-checks the PAID status before creating any record (Req 5.7).
                disabled={!canPlace || isPlacing}
                onClick={handlePlaceOrder}
              >
                {isPlacing ? <Loader2 className="animate-spin" /> : null}
                Place order
              </Button>

              {!isPaid ? (
                <p className="text-center text-xs text-muted-foreground">
                  Mark the order as paid to enable placement.
                </p>
              ) : null}
            </div>
          ) : null}

          {placeError ? (
            <p
              className={cn(
                "flex items-center gap-1.5 text-sm text-destructive",
              )}
            >
              <AlertCircle className="size-4" /> {placeError}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
