"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { useCartStore } from "@/store/useCartStore";
import { createClient } from "@/lib/supabase/client";
import {
  createAddonCheckoutOrder,
  verifyAddonPayment,
} from "@/app/actions/shop-actions";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Separator } from "@/shared/components/ui/separator";

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
  const router = useRouter();
  const items = useCartStore((state) => state.items);
  const clearCart = useCartStore((state) => state.clearCart);

  const [isLoadingAddress, setIsLoadingAddress] = useState(true);
  const [isPaying, setIsPaying] = useState(false);
  const [name, setName] = useState("");
  const [customerProfileId, setCustomerProfileId] = useState<string | null>(
    null,
  );
  const [address, setAddress] = useState<PrimaryAddress | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [appliedCouponCode, setAppliedCouponCode] = useState("");
  const [estimatedDiscount, setEstimatedDiscount] = useState(0);

  const subtotal = useMemo(
    () =>
      items.reduce((acc, item) => {
        const unitPrice = item.sale_price ?? item.original_price;
        return acc + unitPrice * item.quantity;
      }, 0),
    [items],
  );

  const taxableAmount = Math.max(0, subtotal - estimatedDiscount);
  const gst = taxableAmount * 0.05;
  const total = taxableAmount + gst;

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

        setCustomerProfileId(profile.id);

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

    if (!customerProfileId) {
      toast.error("Unable to validate coupon right now.");
      return;
    }

    try {
      const supabase = createClient();
      const { data: coupon, error } = await supabase
        .from("coupons")
        .select(
          "discount_type, discount_value, expires_at, max_uses, times_used",
        )
        .eq("customer_profile_id", customerProfileId)
        .eq("code", code)
        .single();

      if (error || !coupon) {
        throw new Error("Invalid coupon code.");
      }

      if (
        typeof coupon.max_uses === "number" &&
        typeof coupon.times_used === "number" &&
        coupon.times_used >= coupon.max_uses
      ) {
        throw new Error("This coupon usage limit has been reached.");
      }

      if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
        throw new Error("This coupon has expired.");
      }

      let discount = 0;
      if (coupon.discount_type === "PERCENTAGE") {
        discount = (subtotal * Number(coupon.discount_value ?? 0)) / 100;
      } else if (coupon.discount_type === "FLAT") {
        discount = Number(coupon.discount_value ?? 0);
      }

      discount = Math.max(0, Math.min(discount, subtotal));

      setEstimatedDiscount(discount);
      setAppliedCouponCode(code);
      toast.success("Coupon applied.");
    } catch (error) {
      setEstimatedDiscount(0);
      setAppliedCouponCode("");
      toast.error(
        error instanceof Error ? error.message : "Failed to apply coupon.",
      );
    }
  };

  const handlePayment = async () => {
    setIsPaying(true);

    try {
      const orderResponse = await createAddonCheckoutOrder(
        items,
        appliedCouponCode,
      );

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
        },
        modal: {
          ondismiss: function () {
            toast.error("Payment was cancelled.");
          },
        },
      };

      const paymentObject = new (window as any).Razorpay(options);
      paymentObject.on("payment.failed", (response: any) => {
        toast.error(
          response?.error?.description ||
            "Payment failed at gateway. Please try again.",
        );
      });

      paymentObject.open();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to initiate payment at the moment.",
      );
    } finally {
      setIsPaying(false);
    }
  };

  return (
    <main className="p-6 lg:p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
          Checkout Review
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Review your delivery details and billing summary before payment.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Delivery Information</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingAddress ? (
                <div className="flex items-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  <p className="font-semibold text-zinc-900">
                    {name || "Customer"}
                  </p>
                  {address ? (
                    <div className="flex gap-2 text-zinc-700">
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
                    <p className="text-muted-foreground">
                      No primary address found. Please add one in profile.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Order Review</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {items.map((item) => {
                const unitPrice = item.sale_price ?? item.original_price;
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div>
                      <p className="font-medium text-zinc-900">{item.name}</p>
                      <p className="text-sm text-zinc-500">
                        Qty: {item.quantity}
                      </p>
                    </div>
                    <p className="font-semibold">
                      {formatCurrency(unitPrice * item.quantity)}
                    </p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Coupon</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="Enter coupon code"
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value)}
              />
              <Button
                type="button"
                onClick={handleApplyCoupon}
                className="w-full"
              >
                Apply
              </Button>
              {appliedCouponCode ? (
                <p className="text-xs text-green-700">
                  Applied:{" "}
                  <span className="font-semibold">{appliedCouponCode}</span>
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Billing Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Item Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Discount</span>
                <span>-{formatCurrency(estimatedDiscount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">GST (5%)</span>
                <span>{formatCurrency(gst)}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-base font-bold">
                <span>Grand Total</span>
                <span>{formatCurrency(total)}</span>
              </div>
              <Button
                type="button"
                className="mt-2 w-full"
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
    </main>
  );
}
