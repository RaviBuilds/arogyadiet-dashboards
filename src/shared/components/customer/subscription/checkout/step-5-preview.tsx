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
  AlertCircle,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/shared/components/ui/alert";
import { createClient } from "@/lib/supabase/client";

import {
  createRazorpayOrderAction,
  verifyAndActivateSubscriptionAction,
  validateCouponAction,
} from "@/actions/checkoutActions";

export function OrderPreview({ data, plans, onBack }: any) {
  const router = useRouter();
  const [isProcessing, setIsProcessing] = useState(false);

  // NEW: Modern Error State instead of alerts
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const [deliveryAddress, setDeliveryAddress] = useState<any>(null);
  const [isLoadingAddress, setIsLoadingAddress] = useState(true);
  const [customerProfileId, setCustomerProfileId] = useState<string | null>(
    null,
  );
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  const [couponInput, setCouponInput] = useState("");
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [couponError, setCouponError] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<any>(null);

  const selectedPlan = plans?.find((p: any) => p.id === data.planId);
  const planName = selectedPlan?.name || "Standard Plan";
  const baseDuration = selectedPlan?.duration_days || 30;

  const originalBasePrice = selectedPlan?.base_price || 25000;
  const originalTaxAmount = selectedPlan?.tax_amount || 1250;
  const gstRate =
    originalBasePrice > 0 ? originalTaxAmount / originalBasePrice : 0.05;

  let currentBasePrice = originalBasePrice;
  let discountAmount = 0;

  if (appliedCoupon) {
    if (appliedCoupon.discount_type === "FLAT") {
      discountAmount = appliedCoupon.discount_value;
    } else if (appliedCoupon.discount_type === "PERCENTAGE") {
      discountAmount = (originalBasePrice * appliedCoupon.discount_value) / 100;
    }
    currentBasePrice = Math.max(1, originalBasePrice - discountAmount);
  }

  const gst = appliedCoupon ? currentBasePrice * gstRate : originalTaxAmount;
  const totalAmount = currentBasePrice + gst;

  const maxPauses = selectedPlan?.pause_credits || 7;
  const pausedDatesArray = data.pausedDates || [];
  const pausesUsed = pausedDatesArray.length;
  const endDate = data.startDate
    ? addDays(new Date(data.startDate), baseDuration + pausesUsed - 1)
    : null;

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
      }
      setIsLoadingProfile(false);
    }
    fetchProfile();
  }, []);

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

  const handleApplyCoupon = async () => {
    if (!couponInput.trim() || !customerProfileId) return;
    setIsApplyingCoupon(true);
    setCouponError("");
    setPaymentError(null);

    const res = await validateCouponAction(
      couponInput.trim(),
      customerProfileId,
      data.planId,
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
    setPaymentError(null);

    if (!customerProfileId) {
      setPaymentError("Profile not fully loaded. Please refresh the page.");
      return;
    }

    setIsProcessing(true);

    try {
      const res = await loadRazorpayScript();
      if (!res) throw new Error("Razorpay SDK failed to load");

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
          // Keep processing state true while we verify with the DB
          setIsProcessing(true);
          const finalCheckoutData = { ...data, customerProfileId };
          const verifyRes = await verifyAndActivateSubscriptionAction(
            response,
            finalCheckoutData,
            appliedCoupon?.code,
          );

          if (verifyRes.success) {
            router.push("/subscription/success");
          } else {
            setPaymentError(
              "Database sync failed after payment. Please contact support.",
            );
            setIsProcessing(false);
          }
        },
        modal: {
          ondismiss: function () {
            setPaymentError("Payment window was closed.");
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

      paymentObject.on("payment.failed", (response: any) => {
        setIsProcessing(false);
        setPaymentError(
          response.error.description ||
            "Payment failed at gateway. Please try again.",
        );
      });

      paymentObject.open();
    } catch (error) {
      console.error(error);
      setPaymentError("Something went wrong initializing the payment gateway.");
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6 sm:space-y-10 animate-in fade-in slide-in-from-right-4 max-w-full overflow-hidden relative">
      {/* Full screen loading overlay block (optional, prevents clicking back while paying) */}
      {isProcessing && (
        <div className="absolute inset-0 z-50 bg-white/50 backdrop-blur-[1px] rounded-xl" />
      )}

      <section>
        <h2 className="text-lg sm:text-xl font-bold mb-1 sm:mb-2 flex items-center gap-2">
          <span className="bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0">
            5
          </span>
          Review Your Order
        </h2>
        <p className="text-sm sm:text-base text-muted-foreground ml-8">
          Please review your subscription details before secure payment.
        </p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8">
        <div className="lg:col-span-7 space-y-6">
          <Card className="border sm:border-2 overflow-hidden shadow-sm">
            <div className="bg-zinc-50 border-b px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 sm:h-5 sm:w-5 text-zinc-700" />
              <h3 className="font-bold text-base sm:text-lg text-zinc-800">
                Subscription Summary
              </h3>
            </div>

            <CardContent className="p-0">
              <div className="p-4 sm:p-6 flex items-start gap-3 sm:gap-4">
                <div className="bg-primary/10 p-2 sm:p-3 rounded-full text-primary shrink-0 mt-0.5">
                  <Calendar className="h-4 w-4 sm:h-5 sm:w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-base sm:text-lg text-zinc-900 truncate">
                    {planName}
                  </h4>
                  <div className="flex flex-col mt-1 sm:mt-2 text-xs sm:text-sm text-zinc-600 space-y-1">
                    <p>
                      Starts:{" "}
                      <strong className="text-zinc-900">
                        {data.startDate
                          ? format(new Date(data.startDate), "MMM do, yyyy")
                          : "TBD"}
                      </strong>
                    </p>
                    <p>
                      Ends:{" "}
                      <strong className="text-zinc-900">
                        {endDate ? format(endDate, "MMM do, yyyy") : "TBD"}
                      </strong>
                    </p>
                  </div>
                </div>
              </div>

              <hr className="border-zinc-100" />

              <div className="p-4 sm:p-6 flex items-start gap-3 sm:gap-4">
                <div className="bg-amber-100 p-2 sm:p-3 rounded-full text-amber-600 shrink-0 mt-0.5">
                  <Utensils className="h-4 w-4 sm:h-5 sm:w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-base sm:text-lg text-zinc-900">
                    Meal Schedule
                  </h4>
                  <p className="text-xs sm:text-sm text-zinc-600 mt-1">
                    Base Plan:{" "}
                    <strong className="text-zinc-900">{data.foodType}</strong>
                  </p>

                  <div className="mt-3 bg-zinc-50 border rounded-lg p-3 w-full">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-2">
                      <span className="text-xs sm:text-sm font-semibold text-zinc-700">
                        Pause Credits Used
                      </span>
                      <span className="text-xs font-bold bg-white border px-2 py-1 rounded w-fit">
                        {pausesUsed} of {maxPauses}
                      </span>
                    </div>
                    {pausesUsed > 0 ? (
                      <div className="text-[11px] sm:text-xs text-zinc-600 leading-relaxed break-words">
                        <span className="font-medium">Paused Dates:</span>{" "}
                        {pausedDatesArray
                          .sort()
                          .map((d: string) => format(new Date(d), "MMM do"))
                          .join(", ")}
                      </div>
                    ) : (
                      <p className="text-[11px] sm:text-xs text-zinc-500">
                        No dates paused.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <hr className="border-zinc-100" />

              <div className="p-4 sm:p-6 flex items-start gap-3 sm:gap-4">
                <div className="bg-green-100 p-2 sm:p-3 rounded-full text-green-600 shrink-0 mt-0.5">
                  <MapPin className="h-4 w-4 sm:h-5 sm:w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-base sm:text-lg text-zinc-900">
                    Delivery Address
                  </h4>
                  {isLoadingAddress ? (
                    <div className="mt-2 h-10 bg-zinc-100 animate-pulse rounded-md w-3/4"></div>
                  ) : deliveryAddress ? (
                    <div className="mt-2 text-xs sm:text-sm text-zinc-600 leading-relaxed break-words">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-zinc-900 truncate">
                          {deliveryAddress.tag}
                        </span>
                      </div>
                      <p>
                        {deliveryAddress.street_1}, {deliveryAddress.city}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs sm:text-sm text-red-500 mt-2">
                      Error loading address details.
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-5 space-y-6">
          <Card className="border sm:border-2 overflow-hidden shadow-sm">
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-3 sm:mb-4">
                <Tag className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                <h3 className="font-bold text-base sm:text-lg text-zinc-800">
                  Apply Coupon
                </h3>
              </div>

              {!appliedCoupon ? (
                <div className="space-y-2 sm:space-y-3">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Code (e.g. DEVTEST1)"
                      value={couponInput}
                      onChange={(e) =>
                        setCouponInput(e.target.value.toUpperCase())
                      }
                      className="uppercase bg-zinc-50 text-sm"
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
                    <p className="text-[11px] sm:text-xs text-red-500 font-medium">
                      {couponError}
                    </p>
                  )}
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex justify-between items-center">
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-bold text-green-800 flex items-center gap-1.5 truncate">
                      <ShieldCheck className="h-3 w-3 sm:h-4 sm:w-4 shrink-0" />{" "}
                      Applied!
                    </p>
                    <p className="text-[10px] sm:text-xs text-green-700 mt-0.5 truncate">
                      Code: <strong>{appliedCoupon.code}</strong>
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleRemoveCoupon}
                    className="text-green-800 hover:bg-green-100 shrink-0 h-8 w-8"
                  >
                    <X className="h-3 w-3 sm:h-4 sm:w-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border sm:border-2 overflow-hidden shadow-sm relative">
            <div className="bg-zinc-50 border-b px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-2">
              <Receipt className="h-4 w-4 sm:h-5 sm:w-5 text-zinc-700" />
              <h3 className="font-bold text-base sm:text-lg text-zinc-800">
                Price Details
              </h3>
            </div>

            <CardContent className="p-4 sm:p-6 space-y-3 sm:space-y-4">
              <div className="flex justify-between text-xs sm:text-sm text-zinc-600">
                <span>Base Price</span>
                <span className="font-medium text-zinc-900">
                  ₹{originalBasePrice.toLocaleString("en-IN")}
                </span>
              </div>

              {appliedCoupon && (
                <div className="flex justify-between text-xs sm:text-sm font-bold text-green-600">
                  <span>Discount</span>
                  <span>- ₹{discountAmount.toLocaleString("en-IN")}</span>
                </div>
              )}

              <div className="flex justify-between text-xs sm:text-sm text-zinc-600">
                <span>GST ({gstRate * 100}%)</span>
                <span className="font-medium text-zinc-900">
                  ₹
                  {gst.toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>

              <div className="flex justify-between text-xs sm:text-sm text-green-600 font-medium">
                <span>Delivery</span>
                <span>Free</span>
              </div>

              <hr className="border-zinc-200 border-dashed" />

              <div className="flex justify-between items-center">
                <span className="font-bold text-base sm:text-lg text-zinc-900">
                  Total
                </span>
                <span className="font-black text-xl sm:text-2xl text-primary">
                  ₹
                  {totalAmount.toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>

              <div className="pt-2 sm:pt-4 space-y-4">
                {/* MODERN ERROR OVERLAY */}
                {paymentError && (
                  <Alert
                    variant="destructive"
                    className="bg-red-50 text-red-900 border-red-200 animate-in fade-in slide-in-from-bottom-2"
                  >
                    <AlertCircle className="h-4 w-4 stroke-red-600" />
                    <AlertTitle className="font-bold">Payment Issue</AlertTitle>
                    <AlertDescription className="text-xs mt-1">
                      {paymentError}
                    </AlertDescription>
                  </Alert>
                )}

                <Button
                  size="lg"
                  disabled={
                    isProcessing || isLoadingAddress || isLoadingProfile
                  }
                  onClick={handlePayment}
                  className="w-full relative text-base sm:text-lg font-bold h-12 sm:h-14 bg-primary hover:bg-primary/90 text-white transition-all active:scale-95 disabled:opacity-80"
                >
                  {isProcessing ? (
                    <span className="flex items-center">
                      <Loader2 className="mr-2 h-4 w-4 sm:h-5 sm:w-5 animate-spin" />
                      Verifying Payment...
                    </span>
                  ) : (
                    "Proceed to Pay"
                  )}
                </Button>
                <p className="text-center text-[10px] sm:text-[11px] text-muted-foreground mt-3 sm:mt-4 flex justify-center items-center gap-1 sm:gap-1.5 break-words">
                  <ShieldCheck className="h-3 w-3 sm:h-4 sm:w-4 text-green-600 shrink-0" />
                  100% Secure Checkout via Razorpay
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="pt-4 sm:pt-8 border-t flex flex-col-reverse sm:flex-row justify-between items-center gap-4 mt-8 pb-6">
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={isProcessing}
          className="w-full sm:w-auto gap-2 hover:bg-zinc-100 text-sm"
        >
          <ChevronLeft className="h-4 w-4 shrink-0" /> Back to Meal Planner
        </Button>
      </div>
    </div>
  );
}
