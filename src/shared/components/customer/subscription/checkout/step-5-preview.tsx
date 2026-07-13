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
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/shared/components/ui/alert";
import { createClient } from "@/lib/supabase/client";
import { CONTENT_STAGES } from "./content-stages";

import {
  createRazorpayOrderAction,
  verifyAndActivateSubscriptionAction,
  validateCouponAction,
  previewDeliveryChargeAction,
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

  // Delivery charge state (Req 9.1, 9.2, 9.3, 9.7)
  const [deliveryCharge, setDeliveryCharge] = useState<number | null>(null);
  const [isLoadingDeliveryCharge, setIsLoadingDeliveryCharge] = useState(true);
  const [deliveryChargeError, setDeliveryChargeError] = useState<string | null>(null);

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
  const planAmount = currentBasePrice + gst;
  const totalAmount = planAmount + (deliveryCharge ?? 0); // Total_Payable = Plan_Price + Total_Delivery_Charge (Req 4.6)

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

  // Fetch delivery charge once customerProfileId is available (Req 9.1)
  useEffect(() => {
    async function fetchDeliveryCharge() {
      if (!customerProfileId || !data.planId) {
        setIsLoadingDeliveryCharge(false);
        return;
      }
      setIsLoadingDeliveryCharge(true);
      setDeliveryChargeError(null);

      const res = await previewDeliveryChargeAction(customerProfileId, data.planId);

      if (res.success) {
        setDeliveryCharge(res.totalDeliveryCharge);
      } else {
        setDeliveryCharge(null);
        // Map failure reason to user-friendly message (Req 9.7)
        if ("deliveryChargeFailure" in res && res.deliveryChargeFailure) {
          const failure = res.deliveryChargeFailure;
          if (failure.reason === "unresolved_clinic") {
            setDeliveryChargeError(
              "We could not determine the delivery clinic for your area. Please update your delivery address or contact support."
            );
          } else if (failure.reason === "missing_coordinates") {
            setDeliveryChargeError(
              "Your delivery address is missing location coordinates. Please update your address with a valid location."
            );
          } else if (failure.reason === "missing_pincode") {
            setDeliveryChargeError(
              "Your delivery address is missing a pincode. Please update your address."
            );
          } else {
            setDeliveryChargeError(
              "Unable to compute delivery charge. Please update your delivery address or contact support."
            );
          }
        } else {
          setDeliveryChargeError(
            "Unable to compute delivery charge. Please try again later or contact support."
          );
        }
      }
      setIsLoadingDeliveryCharge(false);
    }
    fetchDeliveryCharge();
  }, [customerProfileId, data.planId]);

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
        <h2 className="text-lg font-semibold text-slate-900 tracking-tight flex items-center gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">
            {CONTENT_STAGES.REVIEW}
          </span>
          Review Your Order
        </h2>
        <p className="text-sm text-slate-500 ml-10 mt-1">
          Please review your subscription details before secure payment.
        </p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8">
        <div className="lg:col-span-7 space-y-6">
          <Card className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-slate-700" />
              <h3 className="font-semibold text-slate-900">
                Subscription Summary
              </h3>
            </div>

            <CardContent className="p-0">
              <div className="p-6 flex items-start gap-4">
                <div className="rounded-full bg-primary/10 p-3 text-primary shrink-0 mt-0.5">
                  <Calendar className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-semibold text-slate-900 truncate">
                    {planName}
                  </h4>
                  <div className="flex flex-col mt-2 text-sm text-slate-500 space-y-1">
                    <p>
                      Starts:{" "}
                      <strong className="font-medium text-slate-900">
                        {data.startDate
                          ? format(new Date(data.startDate), "MMM do, yyyy")
                          : "TBD"}
                      </strong>
                    </p>
                    <p>
                      Ends:{" "}
                      <strong className="font-medium text-slate-900">
                        {endDate ? format(endDate, "MMM do, yyyy") : "TBD"}
                      </strong>
                    </p>
                  </div>
                </div>
              </div>

              <hr className="border-slate-100" />

              <div className="p-6 flex items-start gap-4">
                <div className="rounded-full bg-amber-100 p-3 text-amber-600 shrink-0 mt-0.5">
                  <Utensils className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-semibold text-slate-900">
                    Meal Schedule
                  </h4>
                  <p className="text-sm text-slate-500 mt-1">
                    Base Plan:{" "}
                    <strong className="font-medium text-slate-900">
                      {data.foodType}
                    </strong>
                  </p>

                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4 w-full">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-2">
                      <span className="text-sm font-semibold text-slate-700">
                        Pause Credits Used
                      </span>
                      <Badge
                        variant="outline"
                        className="w-fit border-slate-200 bg-white text-xs font-semibold"
                      >
                        {pausesUsed} of {maxPauses}
                      </Badge>
                    </div>
                    {pausesUsed > 0 ? (
                      <div className="text-xs text-slate-500 leading-relaxed break-words">
                        <span className="font-medium text-slate-700">
                          Paused Dates:
                        </span>{" "}
                        {pausedDatesArray
                          .sort()
                          .map((d: string) => format(new Date(d), "MMM do"))
                          .join(", ")}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">
                        No dates paused.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <hr className="border-slate-100" />

              <div className="p-6 flex items-start gap-4">
                <div className="rounded-full bg-green-100 p-3 text-green-600 shrink-0 mt-0.5">
                  <MapPin className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-semibold text-slate-900">
                    Delivery Address
                  </h4>
                  {isLoadingAddress ? (
                    <div className="mt-2 h-10 bg-slate-100 animate-pulse rounded-md w-3/4"></div>
                  ) : deliveryAddress ? (
                    <div className="mt-2 text-sm text-slate-500 leading-relaxed break-words">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-slate-900 truncate">
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

        <div className="lg:col-span-5 space-y-6">
          <Card className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Tag className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-slate-900">Apply Coupon</h3>
              </div>

              {!appliedCoupon ? (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Code (e.g. DEVTEST1)"
                      value={couponInput}
                      onChange={(e) =>
                        setCouponInput(e.target.value.toUpperCase())
                      }
                      className="uppercase bg-slate-50 border-slate-200 text-sm"
                      disabled={isLoadingProfile}
                    />
                    <Button
                      variant="secondary"
                      onClick={handleApplyCoupon}
                      disabled={
                        isApplyingCoupon || !couponInput || isLoadingProfile
                      }
                      className="transition-all duration-200"
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
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 flex justify-between items-center">
                  <div className="min-w-0">
                    <Badge
                      variant="outline"
                      className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold"
                    >
                      <ShieldCheck className="h-3 w-3" /> Applied!
                    </Badge>
                    <p className="text-xs text-emerald-700 mt-2 truncate">
                      Code: <strong>{appliedCoupon.code}</strong>
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleRemoveCoupon}
                    className="text-emerald-800 hover:bg-emerald-100 shrink-0 h-8 w-8 transition-all duration-200"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border border-slate-200 rounded-xl overflow-hidden shadow-sm relative">
            <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4 flex items-center gap-2">
              <Receipt className="h-5 w-5 text-slate-700" />
              <h3 className="font-semibold text-slate-900">Price Details</h3>
            </div>

            <CardContent className="p-6 space-y-4">
              <div className="flex justify-between text-sm text-slate-500">
                <span>Base Price</span>
                <span className="font-medium text-slate-900">
                  ₹{originalBasePrice.toLocaleString("en-IN")}
                </span>
              </div>

              {appliedCoupon && (
                <div className="flex justify-between text-sm font-semibold text-emerald-600">
                  <span>Discount</span>
                  <span>- ₹{discountAmount.toLocaleString("en-IN")}</span>
                </div>
              )}

              <div className="flex justify-between text-sm text-slate-500">
                <span>GST ({gstRate * 100}%)</span>
                <span className="font-medium text-slate-900">
                  ₹
                  {gst.toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>

              <div className="flex justify-between text-sm text-slate-500">
                <span>Delivery Charges</span>
                {isLoadingDeliveryCharge ? (
                  <span className="h-4 w-16 bg-slate-100 animate-pulse rounded" />
                ) : deliveryCharge !== null && deliveryCharge > 0 ? (
                  <span className="font-medium text-slate-900">
                    ₹
                    {deliveryCharge.toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                ) : deliveryCharge === 0 ? (
                  <span className="font-medium text-emerald-600">Free</span>
                ) : (
                  <span className="font-medium text-red-500 text-xs">Unable to compute</span>
                )}
              </div>

              <hr className="border-slate-200 border-dashed" />

              <div className="flex justify-between items-center">
                <span className="text-lg font-semibold text-slate-900">
                  Total
                </span>
                <span className="text-2xl font-semibold text-primary">
                  ₹
                  {totalAmount.toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>

              <div className="pt-4 space-y-4">
                {/* DELIVERY CHARGE FAILURE MESSAGE (Req 9.7) */}
                {deliveryChargeError && (
                  <Alert
                    variant="destructive"
                    className="bg-amber-50 text-amber-900 border-amber-200 animate-in fade-in slide-in-from-bottom-2"
                  >
                    <AlertCircle className="h-4 w-4 stroke-amber-600" />
                    <AlertTitle className="font-semibold">
                      Delivery Charge Issue
                    </AlertTitle>
                    <AlertDescription className="text-xs mt-1">
                      {deliveryChargeError}
                    </AlertDescription>
                  </Alert>
                )}

                {/* MODERN ERROR OVERLAY */}
                {paymentError && (
                  <Alert
                    variant="destructive"
                    className="bg-red-50 text-red-900 border-red-200 animate-in fade-in slide-in-from-bottom-2"
                  >
                    <AlertCircle className="h-4 w-4 stroke-red-600" />
                    <AlertTitle className="font-semibold">
                      Payment Issue
                    </AlertTitle>
                    <AlertDescription className="text-xs mt-1">
                      {paymentError}
                    </AlertDescription>
                  </Alert>
                )}

                <Button
                  size="lg"
                  disabled={
                    isProcessing || isLoadingAddress || isLoadingProfile || isLoadingDeliveryCharge || !!deliveryChargeError
                  }
                  onClick={handlePayment}
                  className="w-full h-12 sm:h-14 text-base font-semibold transition-all duration-200 active:scale-95 disabled:opacity-80"
                >
                  {isProcessing ? (
                    <span className="flex items-center">
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Verifying Payment...
                    </span>
                  ) : (
                    "Proceed to Pay"
                  )}
                </Button>
                <p className="text-center text-xs text-slate-500 flex justify-center items-center gap-1.5 break-words">
                  <ShieldCheck className="h-4 w-4 text-green-600 shrink-0" />
                  100% Secure Checkout via Razorpay
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="pt-8 border-t border-slate-100 flex flex-col-reverse sm:flex-row justify-between items-center gap-4 mt-8 pb-6">
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={isProcessing}
          className="w-full sm:w-auto gap-2 hover:bg-slate-50 text-sm transition-all duration-200"
        >
          <ChevronLeft className="h-4 w-4 shrink-0" /> Back to Meal Planner
        </Button>
      </div>
    </div>
  );
}
