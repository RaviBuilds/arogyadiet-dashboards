"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { format, addDays } from "date-fns";
import {
  ChevronLeft,
  MapPin,
  Calendar,
  Utensils,
  ShieldCheck,
  Loader2,
  Receipt,
  Tag,
  X,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { createClient } from "@/lib/supabase/client";

import {
  createRazorpayOrderAction,
  verifyAndActivateSubscriptionAction,
  validateCouponAction,
} from "@/actions/checkoutActions";

export function OrderPreview({ data, plans, onBack }: any) {
  const router = useRouter();
  const [isProcessing, setIsProcessing] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState<any>(null);
  const [isLoadingAddress, setIsLoadingAddress] = useState(true);

  // NEW: Real-time Profile State
  const [customerProfileId, setCustomerProfileId] = useState<string | null>(
    null,
  );
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  // Coupon States
  const [couponInput, setCouponInput] = useState("");
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [couponError, setCouponError] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<any>(null);

  // 1. Initial Pricing from Plan
  const selectedPlan = plans?.find((p: any) => p.id === data.planId);
  const planName = selectedPlan?.name || "Standard Plan";
  const baseDuration = selectedPlan?.duration_days || 30;
  
  // SECURE DB SOURCED PRICING
  const originalBasePrice = selectedPlan?.base_price || 25000;
  const originalTaxAmount = selectedPlan?.tax_amount || 1250;

  // DYNAMIC GST RATE CALCULATOR (e.g., 1250 / 25000 = 0.05 or 5%)
  const gstRate = originalBasePrice > 0 ? (originalTaxAmount / originalBasePrice) : 0.05;

  // 2. Dynamic Math Engine (Calculates discount in real-time)
  let currentBasePrice = originalBasePrice;
  let discountAmount = 0;

  if (appliedCoupon) {
    if (appliedCoupon.discount_type === 'FLAT') {
      discountAmount = appliedCoupon.discount_value;
    } else if (appliedCoupon.discount_type === 'PERCENTAGE') {
      discountAmount = (originalBasePrice * appliedCoupon.discount_value) / 100;
    }
    // Ensure base price doesn't drop below ₹1
    currentBasePrice = Math.max(1, originalBasePrice - discountAmount);
  }

  // 3. Final GST and Total Math
  // If coupon applied: calculate new tax dynamically. If no coupon: strictly use DB tax amount.
  const gst = appliedCoupon ? (currentBasePrice * gstRate) : originalTaxAmount;
  const totalAmount = currentBasePrice + gst;

  // 4. Pause Credits & End Date Math
  const maxPauses = selectedPlan?.pause_credits || 7;
  const pausedDatesArray = data.pausedDates || [];
  const pausesUsed = pausedDatesArray.length;
  const endDate = data.startDate
    ? addDays(new Date(data.startDate), baseDuration + pausesUsed - 1)
    : null;

  // FETCH CUSTOMER PROFILE
  useEffect(() => {
    async function fetchProfile() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setIsLoadingProfile(false);
        return;
      }

      // Chain through users -> customer_profiles just like in Step 2
      const { data: appUser } = await supabase
        .from("users")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle();

      if (appUser) {
        const { data: profile } = await supabase
          .from("customer_profiles")
          .select("id")
          .eq("user_id", appUser.id)
          .maybeSingle();

        if (profile) setCustomerProfileId(profile.id);
        console.log("PROFIL =>", profile);
      }
      setIsLoadingProfile(false);
    }
    fetchProfile();
  }, []);

  // FETCH ADDRESS
  useEffect(() => {
    async function fetchAddress() {
      if (!data.addressId) {
        setIsLoadingAddress(false);
        return;
      }
      const supabase = createClient();
      const { data: addr } = await supabase
        .from("addresses")
        .select("*")
        .eq("id", data.addressId)
        .single();
      if (addr) setDeliveryAddress(addr);
      setIsLoadingAddress(false);
    }
    fetchAddress();
  }, [data.addressId]);

  // Handle Coupon Apply
  const handleApplyCoupon = async () => {
    if (!couponInput.trim() || !customerProfileId) return;
    setIsApplyingCoupon(true);
    setCouponError("");

    // Now uses the REAL customerProfileId fetched from Supabase!
    const res = await validateCouponAction(
      couponInput.trim(),
      customerProfileId,
      baseDuration,
    );

    if (res.success && res.coupon) {
      setAppliedCoupon(res.coupon);
      setCouponInput("");
    } else {
      setCouponError(res.error || "Invalid coupon");
    }
    setIsApplyingCoupon(false);
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponError("");
  };

  const loadRazorpayScript = () => {
    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const handlePayment = async () => {
    if (!customerProfileId) {
      alert("Customer profile not loaded. Please refresh the page.");
      return;
    }

    setIsProcessing(true);

    try {
      const res = await loadRazorpayScript();
      if (!res) throw new Error("Razorpay SDK failed to load");

      // Pass real customer profile ID and duration to the server
      const orderRes = await createRazorpayOrderAction(
        data.planId,
        baseDuration,
        appliedCoupon?.code,
        customerProfileId,
      );

      if (!orderRes.success || !orderRes.order)
        throw new Error("Could not create order");

      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: orderRes.order.amount,
        currency: orderRes.order.currency,
        name: "Arogyadiet",
        description: `Subscription: ${planName}`,
        order_id: orderRes.order.id,
        theme: { color: "#ea580c" },
        handler: async function (response: any) {
          // Add the customer profile ID into the checkoutData payload for the server
          const finalCheckoutData = { ...data, customerProfileId };

          const verifyRes = await verifyAndActivateSubscriptionAction(
            response,
            finalCheckoutData,
            appliedCoupon?.code,
          );

          if (verifyRes.success) {
            alert("Payment Successful! Welcome to Arogyadiet.");
            router.push("/customer/subscription/success");
          } else {
            alert("Payment verification failed.");
            setIsProcessing(false);
          }
        },
        modal: {
          ondismiss: function () {
            setIsProcessing(false);
          },
        },
        prefill: {
          name: "Customer Name",
          email: "customer@example.com",
          contact: "9999999999",
        },
      };

      const paymentObject = new (window as any).Razorpay(options);
      paymentObject.on("payment.failed", () => {
        setIsProcessing(false);
        alert("Payment failed or was cancelled.");
      });
      paymentObject.open();
    } catch (error) {
      console.error(error);
      alert("Something went wrong initializing payment.");
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-right-4">
      <section>
        <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
          <span className="bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">
            5
          </span>
          Review Your Order
        </h2>
        <p className="text-muted-foreground ml-8">
          Almost there! Please review your subscription details before
          proceeding to secure payment.
        </p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8">
        {/* LEFT COLUMN: Subscription Summary */}
        <div className="lg:col-span-7 space-y-6">
          <Card className="border-2 overflow-hidden">
            <div className="bg-zinc-50 border-b px-6 py-4 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-zinc-700" />
              <h3 className="font-bold text-lg text-zinc-800">
                Subscription Summary
              </h3>
            </div>

            <CardContent className="p-0">
              {/* Plan & Dates */}
              <div className="p-6 flex items-start gap-4">
                <div className="bg-primary/10 p-3 rounded-full text-primary shrink-0 mt-1">
                  <Calendar className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="font-bold text-lg text-zinc-900">
                    {planName} ({baseDuration} Days)
                  </h4>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 mt-2 text-sm text-zinc-600">
                    <p>
                      Starting on{" "}
                      <strong className="text-zinc-900">
                        {data.startDate
                          ? format(new Date(data.startDate), "MMM do, yyyy")
                          : "TBD"}
                      </strong>
                    </p>
                    <span className="hidden sm:inline text-zinc-300">•</span>
                    <p>
                      Ends on{" "}
                      <strong className="text-zinc-900">
                        {endDate ? format(endDate, "MMM do, yyyy") : "TBD"}
                      </strong>
                    </p>
                  </div>
                </div>
              </div>

              <hr className="border-zinc-100" />

              {/* Meal Schedule */}
              <div className="p-6 flex items-start gap-4">
                <div className="bg-amber-100 p-3 rounded-full text-amber-600 shrink-0 mt-1">
                  <Utensils className="h-5 w-5" />
                </div>
                <div className="w-full">
                  <h4 className="font-bold text-lg text-zinc-900">
                    Meal Schedule
                  </h4>
                  <p className="text-sm text-zinc-600 mt-1">
                    Base Plan:{" "}
                    <strong className="text-zinc-900">{data.foodType}</strong>
                  </p>

                  <div className="mt-4 bg-zinc-50 border rounded-lg p-3 w-full">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-semibold text-zinc-700">
                        Pause Credits Used
                      </span>
                      <span className="text-xs font-bold bg-white border px-2 py-1 rounded">
                        {pausesUsed} of {maxPauses}
                      </span>
                    </div>
                    {pausesUsed > 0 ? (
                      <div className="text-xs text-zinc-600">
                        <span className="font-medium">Paused Dates:</span>{" "}
                        {pausedDatesArray
                          .sort()
                          .map((d: string) => format(new Date(d), "MMM do"))
                          .join(", ")}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-500">
                        No dates paused yet.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <hr className="border-zinc-100" />

              {/* Address */}
              <div className="p-6 flex items-start gap-4">
                <div className="bg-green-100 p-3 rounded-full text-green-600 shrink-0 mt-1">
                  <MapPin className="h-5 w-5" />
                </div>
                <div className="w-full">
                  <h4 className="font-bold text-lg text-zinc-900">
                    Delivery Address
                  </h4>
                  {isLoadingAddress ? (
                    <div className="mt-2 h-10 bg-zinc-100 animate-pulse rounded-md w-3/4"></div>
                  ) : deliveryAddress ? (
                    <div className="mt-2 text-sm text-zinc-600 leading-relaxed">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-zinc-900">
                          {deliveryAddress.tag}
                        </span>
                      </div>
                      <p>
                        {deliveryAddress.street_1}, {deliveryAddress.city}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-red-500 mt-2">
                      Error loading address details.
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN: Price Details & Coupon */}
        <div className="lg:col-span-5 space-y-6">
          {/* COUPON SECTION */}
          <Card className="border-2 overflow-hidden shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Tag className="h-5 w-5 text-primary" />
                <h3 className="font-bold text-lg text-zinc-800">
                  Apply Coupon
                </h3>
              </div>

              {!appliedCoupon ? (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Enter code (e.g. DEVTEST1)"
                      value={couponInput}
                      onChange={(e) =>
                        setCouponInput(e.target.value.toUpperCase())
                      }
                      className="uppercase bg-zinc-50"
                      disabled={isLoadingProfile}
                    />
                    <Button
                      variant="secondary"
                      onClick={handleApplyCoupon}
                      disabled={
                        isApplyingCoupon || !couponInput || isLoadingProfile
                      }
                    >
                      {isApplyingCoupon ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Apply"
                      )}
                    </Button>
                  </div>
                  {couponError && (
                    <p className="text-xs text-red-500 font-medium">
                      {couponError}
                    </p>
                  )}
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex justify-between items-center">
                  <div>
                    <p className="text-sm font-bold text-green-800 flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4" /> Coupon Applied!
                    </p>
                    <p className="text-xs text-green-700 mt-0.5">
                      Code: <strong>{appliedCoupon.code}</strong>
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleRemoveCoupon}
                    className="text-green-800 hover:bg-green-100"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* PRICE DETAILS */}
          <Card className="border-2 sticky top-24 overflow-hidden shadow-sm">
            <div className="bg-zinc-50 border-b px-6 py-4 flex items-center gap-2">
              <Receipt className="h-5 w-5 text-zinc-700" />
              <h3 className="font-bold text-lg text-zinc-800">Price Details</h3>
            </div>

            <CardContent className="p-6 space-y-4">
              <div className="flex justify-between text-sm text-zinc-600">
                <span>Base Price</span>
                <span className="font-medium text-zinc-900">
                  ₹{originalBasePrice.toLocaleString("en-IN")}
                </span>
              </div>

              {/* Discount Row */}
              {appliedCoupon && (
                <div className="flex justify-between text-sm font-bold text-green-600">
                  <span>Discount ({appliedCoupon.code})</span>
                  <span>- ₹{discountAmount.toLocaleString("en-IN")}</span>
                </div>
              )}

              <div className="flex justify-between text-sm text-zinc-600">
                <span>GST (5%)</span>
                <span className="font-medium text-zinc-900">
                  ₹
                  {gst.toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>

              <div className="flex justify-between text-sm text-green-600 font-medium">
                <span>Delivery Charges</span>
                <span>Free</span>
              </div>

              <hr className="border-zinc-200 border-dashed" />

              <div className="flex justify-between items-center">
                <span className="font-bold text-lg text-zinc-900">
                  Total Amount
                </span>
                <span className="font-black text-2xl text-primary">
                  ₹
                  {totalAmount.toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>

              <div className="pt-4">
                <Button
                  size="lg"
                  disabled={
                    isProcessing || isLoadingAddress || isLoadingProfile
                  }
                  onClick={handlePayment}
                  className="w-full text-lg font-bold h-14 bg-primary hover:bg-primary/90 text-white transition-all active:scale-95 disabled:opacity-70"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />{" "}
                      Processing...
                    </>
                  ) : (
                    "Proceed to Pay"
                  )}
                </Button>
                <p className="text-center text-[11px] text-muted-foreground mt-4 flex justify-center items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-green-600" />
                  100% Secure Checkout via Razorpay
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="pt-8 border-t flex justify-start">
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={isProcessing}
          className="gap-2 hover:bg-zinc-100"
        >
          <ChevronLeft className="h-4 w-4" /> Back to Meal Planner
        </Button>
      </div>
    </div>
  );
}
