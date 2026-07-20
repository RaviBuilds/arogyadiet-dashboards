"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Leaf,
  Loader2,
  MapPin,
  PackageCheck,
  ReceiptText,
  ShoppingBag,
} from "lucide-react";
import { toast } from "sonner";
import { useCartStore } from "@/store/useCartStore";
import { useSyncCartStockFromServer } from "@/shared/hooks/use-sync-cart-stock";
import { createClient } from "@/lib/supabase/client";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import {
  createAddonCheckoutOrder,
  validateCouponCode,
  verifyAddonPayment,
  checkAndReconcileAddonPaymentAction,
} from "@/actions/shop-actions";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Separator } from "@/shared/components/ui/separator";
import { calculateShopOrderBreakdown } from "@/lib/pricing/inclusive-tax";

type PrimaryAddress = {
  street_1?: string | null;
  street_2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  tag?: string | null;
};

type RazorpayPaymentResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayFailureResponse = {
  error: {
    description?: string;
  };
};

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  theme: { color: string };
  prefill: { name: string };
  handler: (response: RazorpayPaymentResponse) => Promise<void>;
  modal: { ondismiss: () => void };
};

type RazorpayInstance = {
  on: (
    event: "payment.failed",
    callback: (response: RazorpayFailureResponse) => void,
  ) => void;
  open: () => void;
};

type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

const subscribeToNothing = () => () => {};

const formatCurrency = (value: number) => `₹${value.toFixed(2)}`;

export default function ShopCheckoutPage() {
  const isMounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  //for routing
  const router = useRouter();

  //functons / values from store
  const items = useCartStore((state) => state.items);
  const clearCart = useCartStore((state) => state.clearCart);

  useSyncCartStockFromServer(isMounted);

  //
  const [isLoadingAddress, setIsLoadingAddress] = useState(true);
  const [isPaying, setIsPaying] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState<PrimaryAddress | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [discount, setDiscount] = useState<{
    type: "PERCENTAGE" | "FLAT" | null;
    value: number;
  }>({ type: null, value: 0 });

  // Tracks the in-flight Razorpay order while a payment is open, so that if
  // the WebView is backgrounded/killed during a UPI app-switch and the
  // Checkout.js `handler` callback never fires, resuming the app can
  // reconcile the payment status directly against Razorpay instead of
  // leaving the order stuck as unpaid.
  const pendingPaymentRef = useRef<null | { paymentId: string; razorpayOrderId: string }>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const listenerPromise = App.addListener("appStateChange", async ({ isActive }) => {
      if (!isActive || !pendingPaymentRef.current) return;

      const { paymentId, razorpayOrderId } = pendingPaymentRef.current;
      const result = await checkAndReconcileAddonPaymentAction(paymentId, razorpayOrderId);

      if (result.success) {
        pendingPaymentRef.current = null;
        setIsPaying(false);
        toast.success(
          "Payment successful! Add-ons will be delivered with your next meal.",
        );
        clearCart();
        router.push("/dashboard");
      }
      // If not yet captured (`result.pending`), leave pendingPaymentRef set —
      // the Checkout.js handler or a later resume may still resolve it.
    });

    return () => {
      listenerPromise.then((handle) => handle.remove());
    };
  }, [clearCart, router]);

  useEffect(() => {
    if (items.length === 0) {
      router.push("/shop");
    }
  }, [items.length, router]);

  useEffect(() => {
    const fetchCheckoutMeta = async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.push("/login");
          return;
        }

        const { data: dbUser, error: dbUserError } = await supabase
          .from("users")
          .select("id, full_name")
          .eq("auth_user_id", user.id)
          .single();

        if (dbUserError || !dbUser) {
          throw new Error("Failed to fetch user details.");
        }

        setName(dbUser.full_name ?? user.email ?? "Customer");

        const { data: profile, error: profileError } = await supabase
          .from("customer_profiles")
          .select("id")
          .eq("user_id", dbUser.id)
          .single();

        if (profileError || !profile) {
          throw new Error("Failed to fetch customer profile.");
        }

        const { data: primaryAddress, error: addressError } = await supabase
          .from("addresses")
          .select("street_1, street_2, city, state, pincode, tag")
          .eq("customer_profile_id", profile.id)
          .eq("is_primary", true)
          .limit(1)
          .maybeSingle();

        if (addressError) {
          throw new Error("Failed to fetch delivery address.");
        }

        setAddress(primaryAddress ?? null);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to prepare checkout information.",
        );
      } finally {
        setIsLoadingAddress(false);
      }
    };

    fetchCheckoutMeta();
  }, [router]);

  if (!isMounted) {
    return null; // Prevent hydration mismatch with persisted cart state
  }

  const orderLines = items.map((item) => {
    const unitPrice = item.sale_price ?? item.original_price;
    return {
      gross: unitPrice * item.quantity,
      taxPercent: item.tax_percent ?? 0,
    };
  });

  const billing = calculateShopOrderBreakdown(orderLines, {
    type: discount.type,
    value: discount.value,
  });

  const gstLabel =
    billing.displayTaxPercent != null && billing.displayTaxPercent > 0
      ? `GST (${billing.displayTaxPercent}%)`
      : "GST";

  const loadRazorpayScript = () => {
    return new Promise<boolean>((resolve) => {
      if (window.Razorpay) {
        resolve(true);
        return;
      }

      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const handleApplyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) {
      toast.error("Please enter a coupon code.");
      return;
    }

    setIsApplying(true);
    try {
      const res = await validateCouponCode(code);
   
      if (!res.success) {
        setDiscount({ type: null, value: 0 });
        toast.error(res.error);
        return;
      }

      setDiscount({
        type: (res.discountType as "PERCENTAGE" | "FLAT" | null) ?? null,
        value: Number(res.discountValue ?? 0),
      });
      toast.success("Coupon applied.");
    } catch (error) {
      setDiscount({ type: null, value: 0 });
      toast.error(
        error instanceof Error ? error.message : "Failed to apply coupon",
      );
    } finally {
      setIsApplying(false);
    }
  };

  const handlePayment = async () => {
    const setIsProcessing = setIsPaying;
    setIsProcessing(true);
    try {
      const orderResponse = await createAddonCheckoutOrder(items, couponInput);

      if (!orderResponse.success) {
        throw new Error(
          orderResponse.error ?? "Failed to create checkout order.",
        );
      }

      if (
        !orderResponse.breakdown ||
        !orderResponse.razorpayOrderId ||
        !orderResponse.paymentId ||
        !orderResponse.razorpayKey
      ) {
        throw new Error("Incomplete payment initialization data.");
      }

      const razorpayLoaded = await loadRazorpayScript();
      if (!razorpayLoaded || !window.Razorpay) {
        throw new Error("Failed to load Razorpay checkout.");
      }

      const options = {
        key: orderResponse.razorpayKey,
        amount: Math.round(orderResponse.breakdown.total * 100),
        currency: "INR",
        name: "Arogyadiet",
        description: "Add-on Purchase",
        order_id: orderResponse.razorpayOrderId,
        theme: { color: "#e74c3c" },
        prefill: {
          name: name || "Customer",
        },
        handler: async function (response: RazorpayPaymentResponse) {
          pendingPaymentRef.current = null;
          const verifyRes = await verifyAddonPayment(
            orderResponse.paymentId,
            response,
          );
          if (verifyRes.success) {
            toast.success(
              "Payment successful! Add-ons will be delivered with your next meal.",
            );
            clearCart();
            router.push("/dashboard");
          } else {
            toast.error(verifyRes.error || "Payment verification failed.");
          }
          setIsProcessing(false);
        },
        modal: {
          ondismiss: function () {
            // On Android, `ondismiss` also fires when the WebView regains
            // focus after a UPI app-switch without the `handler` callback
            // having run — don't clear pendingPaymentRef or show a
            // cancellation toast if we're still waiting on a reconciliation
            // check for this order.
            if (!pendingPaymentRef.current) {
              toast.error("Payment was cancelled.");
              setIsProcessing(false);
            }
          },
        },
      };

      // Track this order so the appStateChange listener can reconcile it
      // if the app is backgrounded/killed mid-payment (e.g. a UPI app-switch)
      // and the `handler` callback above never runs.
      pendingPaymentRef.current = {
        paymentId: orderResponse.paymentId,
        razorpayOrderId: orderResponse.razorpayOrderId,
      };

      const rzp = new window.Razorpay(options);

      // Catch payment failures
      rzp.on("payment.failed", function (response: RazorpayFailureResponse) {
        pendingPaymentRef.current = null;
        console.error("Razorpay Payment Failed:", response.error);
        toast.error(`Payment Failed: ${response.error.description}`);
        setIsProcessing(false); // Stop the loading spinner
      });

      rzp.open();
      return;
    } catch (error) {
      console.error("Payment Flow Error:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Payment initialization failed.",
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 sm:space-y-8">
      <header
        className="reveal-rise relative isolate overflow-hidden rounded-3xl border border-emerald-900/10 bg-gradient-to-br from-[#0f5230] via-[#1f7d49] to-[#37a862] shadow-md"
        style={{ ["--reveal-delay" as string]: "150ms" }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(125%_120%_at_12%_-10%,rgba(255,255,255,0.18),rgba(255,255,255,0)_52%)]" />
        <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-white/12 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-12 h-60 w-60 rounded-full bg-lime-300/15 blur-3xl" />
        <div className="hero-sheen pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent" />

        <div className="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <div className="flex items-center gap-2 text-emerald-100/90">
              <Leaf className="h-4 w-4 text-lime-200" />
              <span className="text-xs font-semibold uppercase tracking-[0.18em]">
                Wellness essentials
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-[2rem]">
              Checkout with confidence
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-emerald-50/90">
              Your selected essentials will be delivered with your next nourishing meal.
            </p>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/12 px-4 py-2 text-sm font-semibold text-emerald-50 ring-1 ring-inset ring-white/15">
            <ShoppingBag className="h-4 w-4" />
            {items.length} {items.length === 1 ? "item" : "items"} selected
          </span>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-3 lg:gap-6">
        <div className="space-y-5 lg:col-span-2">
          <Card className="reveal-rise overflow-hidden rounded-3xl border border-emerald-900/10 bg-white shadow-sm" style={{ ["--reveal-delay" as string]: "300ms" }}>
            <CardHeader className="border-b border-emerald-900/10 bg-emerald-50/50 px-5 py-4 sm:px-6">
              <CardTitle className="flex items-center gap-2.5 text-base font-semibold tracking-tight text-slate-900">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-emerald-600 ring-1 ring-inset ring-emerald-900/10">
                  <MapPin className="h-4 w-4" />
                </span>
                Delivery details
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 sm:p-6">
              {isLoadingAddress ? (
                <div className="flex items-center text-sm text-slate-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin text-emerald-600" /> Loading delivery details...
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-900/10 bg-gradient-to-br from-emerald-50/70 via-white to-amber-50/30 p-4 sm:p-5">
                  <p className="text-sm font-semibold text-slate-900">{name || "Customer"}</p>
                  {address ? (
                    <div className="mt-3 flex gap-3 text-sm leading-relaxed text-slate-600">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      <div>
                        {address.tag ? <p className="font-semibold text-emerald-800">{address.tag}</p> : null}
                        <p>{address.street_1}</p>
                        {address.street_2 ? <p>{address.street_2}</p> : null}
                        <p>{address.city}, {address.state} - {address.pincode}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm leading-relaxed text-slate-500">No primary address found. Please add one in your profile before payment.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="reveal-rise overflow-hidden rounded-3xl border border-emerald-900/10 bg-white shadow-sm" style={{ ["--reveal-delay" as string]: "400ms" }}>
            <CardHeader className="border-b border-emerald-900/10 bg-emerald-50/50 px-5 py-4 sm:px-6">
              <CardTitle className="flex items-center gap-2.5 text-base font-semibold tracking-tight text-slate-900">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-emerald-600 ring-1 ring-inset ring-emerald-900/10">
                  <PackageCheck className="h-4 w-4" />
                </span>
                Your order
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5 sm:p-6">
              {items.map((item) => {
                const unitPrice = item.sale_price ?? item.original_price;
                return (
                  <div key={item.id} className="flex items-center justify-between gap-4 rounded-2xl border border-emerald-900/10 bg-white p-4 transition-colors hover:bg-emerald-50/30">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-snug text-slate-900">{item.name}</p>
                      <p className="mt-1 text-xs font-medium text-slate-500">Quantity: {item.quantity} · Delivered with your next meal</p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{formatCurrency(unitPrice * item.quantity)}</p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5 lg:col-span-1">
          <Card className="reveal-rise overflow-hidden rounded-3xl border border-emerald-900/10 bg-white shadow-sm" style={{ ["--reveal-delay" as string]: "450ms" }}>
            <CardHeader className="border-b border-emerald-900/10 bg-emerald-50/50 px-5 py-4">
              <CardTitle className="flex items-center gap-2.5 text-base font-semibold tracking-tight text-slate-900">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-emerald-600 ring-1 ring-inset ring-emerald-900/10">
                  <ReceiptText className="h-4 w-4" />
                </span>
                Coupon
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5">
              <Input className="h-11 rounded-xl border-emerald-900/10 bg-white px-3.5 text-sm shadow-sm placeholder:text-slate-400 focus-visible:ring-emerald-600" placeholder="Enter coupon code" value={couponInput} onChange={(e) => setCouponInput(e.target.value)} />
              <Button type="button" onClick={handleApplyCoupon} disabled={isApplying} className="h-10 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-sm shadow-primary/20 transition-all hover:brightness-105 hover:shadow-md">
                {isApplying ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Applying...</> : "Apply coupon"}
              </Button>
              {discount.type ? <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Applied: <span className="font-semibold">{couponInput.trim().toUpperCase()}</span></p> : null}
            </CardContent>
          </Card>

          <Card className="reveal-rise overflow-hidden rounded-3xl border border-emerald-900/10 bg-white shadow-sm lg:sticky lg:top-24" style={{ ["--reveal-delay" as string]: "550ms" }}>
            <CardHeader className="border-b border-emerald-900/10 bg-emerald-50/50 px-5 py-4">
              <CardTitle className="flex items-center gap-2.5 text-base font-semibold tracking-tight text-slate-900">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-emerald-600 ring-1 ring-inset ring-emerald-900/10">
                  <ShoppingBag className="h-4 w-4" />
                </span>
                Payment summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5 text-sm">
              <div className="flex justify-between gap-4"><span className="text-slate-500">Item subtotal</span><span className="font-medium tabular-nums text-slate-700">{formatCurrency(billing.baseSubtotal)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-slate-500">Discount</span><span className="font-medium tabular-nums text-emerald-700">-{formatCurrency(billing.discount)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-slate-500">{gstLabel}</span><span className="font-medium tabular-nums text-slate-700">{formatCurrency(billing.tax)}</span></div>
              <Separator className="my-4 bg-emerald-900/10" />
              <div className="flex items-end justify-between gap-4"><span className="font-semibold text-slate-900">Grand total</span><span className="text-xl font-semibold tabular-nums tracking-tight text-slate-900">{formatCurrency(billing.total)}</span></div>
              <Button type="button" className="mt-3 h-11 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition-all hover:brightness-105 hover:shadow-lg hover:shadow-primary/25" onClick={handlePayment} disabled={isPaying || items.length === 0}>
                {isPaying ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing payment...</> : "Complete secure payment"}
              </Button>
              <p className="text-center text-xs leading-relaxed text-slate-500">Secure payment powered by Razorpay.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
