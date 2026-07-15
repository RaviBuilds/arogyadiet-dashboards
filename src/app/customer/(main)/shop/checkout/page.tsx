"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin } from "lucide-react";
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

const formatCurrency = (value: number) => `₹${value.toFixed(2)}`;

export default function ShopCheckoutPage() {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

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
      if ((window as any).Razorpay) {
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
      if (!razorpayLoaded || !(window as any).Razorpay) {
        throw new Error("Failed to load Razorpay checkout.");
      }

      const options = {
        key: orderResponse.razorpayKey,
        amount: Math.round(orderResponse.breakdown.total * 100),
        currency: "INR",
        name: "Arogyadiet",
        description: "Add-on Purchase",
        order_id: orderResponse.razorpayOrderId,
        theme: { color: "#ea580c" },
        prefill: {
          name: name || "Customer",
        },
        handler: async function (response: any) {
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

      const rzp = new (window as any).Razorpay(options);

      // Catch payment failures
      rzp.on("payment.failed", function (response: any) {
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
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Checkout Review
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Review your delivery details and billing summary before payment.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
        <div className="space-y-6 lg:col-span-2">
          <Card className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="font-semibold tracking-tight text-slate-900">
                Delivery Information
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-0">
              {isLoadingAddress ? (
                <div className="flex items-center text-sm text-slate-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  <p className="font-semibold text-slate-900">
                    {name || "Customer"}
                  </p>
                  {address ? (
                    <div className="flex gap-3 text-slate-600">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        {address.tag ? (
                          <p className="font-medium">{address.tag}</p>
                        ) : null}
                        <p>{address.street_1}</p>
                        {address.street_2 ? <p>{address.street_2}</p> : null}
                        <p>
                          {address.city}, {address.state} - {address.pincode}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-slate-500">
                      No primary address found. Please add one in profile.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="font-semibold tracking-tight text-slate-900">
                Order Review
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-6 pt-0">
              {items.map((item) => {
                const unitPrice = item.sale_price ?? item.original_price;
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/30 p-4 transition-colors hover:bg-slate-50"
                  >
                    <div>
                      <p className="font-medium text-slate-900">{item.name}</p>
                      <p className="text-sm text-slate-500">
                        Qty: {item.quantity}
                      </p>
                    </div>
                    <p className="font-semibold text-slate-900">
                      {formatCurrency(unitPrice * item.quantity)}
                    </p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-1">
          <Card className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="font-semibold tracking-tight text-slate-900">
                Coupon
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-6 pt-0">
              <Input
                placeholder="Enter coupon code"
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value)}
              />
              <Button
                type="button"
                onClick={handleApplyCoupon}
                disabled={isApplying}
                className="w-full transition-all duration-200"
              >
                {isApplying ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Applying...
                  </>
                ) : (
                  "Apply"
                )}
              </Button>
              {discount.type ? (
                <p className="text-xs text-emerald-700">
                  Applied:{" "}
                  <span className="font-semibold">
                    {couponInput.trim().toUpperCase()}
                  </span>
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="font-semibold tracking-tight text-slate-900">
                Billing Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-6 pt-0 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Item Subtotal</span>
                <span>{formatCurrency(billing.baseSubtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Discount</span>
                <span>-{formatCurrency(billing.discount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{gstLabel}</span>
                <span>{formatCurrency(billing.tax)}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-base font-semibold text-slate-900">
                <span>Grand Total</span>
                <span>{formatCurrency(billing.total)}</span>
              </div>
              <Button
                type="button"
                className="mt-2 w-full transition-all duration-200"
                onClick={handlePayment}
                disabled={isPaying || items.length === 0}
              >
                {isPaying ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  "Complete Payment"
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
