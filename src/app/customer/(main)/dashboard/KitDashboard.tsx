import { format, parseISO } from "date-fns";
import { Package, Calendar, Clock, ShieldCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import type { ShippingInfo } from "@/types/kitShipping";
import { ShippingTracker } from "./ShippingTracker";

/**
 * KIT-specific customer dashboard component
 * 
 * Displays KIT subscription information including:
 * - Product name and pricing details
 * - Purchase date and duration
 * - Shipping status and tracking information
 * - Order status (paid, shipped, delivered)
 * 
 * This component is completely isolated from meal subscription UI.
 * 
 * Requirements: 8.1, 8.3
 * Task: 16.1
 */

interface KitSubscription {
  id: string;
  subscription_code: string;
  starts_on: string;
  kit_duration_days: number;
  customer_category: string;
  status: string;
  kit_products: {
    name: string;
    base_price: number;
    tax_rate: number;
  } | {
    name: string;
    base_price: number;
    tax_rate: number;
  }[] | null;
}

interface KitDashboardProps {
  subscription: KitSubscription;
  shippingInfo: ShippingInfo | null;
}

export function KitDashboard({ subscription, shippingInfo }: KitDashboardProps) {
  // Handle kit_products being either an object or an array
  const kitProduct = Array.isArray(subscription.kit_products)
    ? subscription.kit_products[0]
    : subscription.kit_products;
  
  // Calculate pricing
  const basePrice = kitProduct?.base_price ?? 0;
  const taxRate = kitProduct?.tax_rate ?? 0.05;
  const taxAmount = basePrice * taxRate;
  const totalPrice = basePrice + taxAmount;

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  return (
    <div className="relative z-10 max-w-5xl mx-auto space-y-6">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight">
            My KIT Order
          </h1>
          <p className="text-sm text-slate-500 mt-1 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-green-600" /> Order ID:{" "}
            <span className="font-mono text-slate-700 font-medium">
              {subscription.subscription_code}
            </span>
          </p>
        </div>
        <Badge
          variant="outline"
          className="shrink-0 rounded-full border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-700"
        >
          {subscription.status === 'ACTIVE' ? 'PAID' : subscription.status}
        </Badge>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Product Information Card */}
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
            <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              Product Details
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div>
              <h3 className="text-xl font-semibold text-slate-900 mb-1">
                {kitProduct?.name ?? 'KIT Product'}
              </h3>
              <p className="text-sm text-slate-500">
                {subscription.kit_duration_days} Days Duration
              </p>
            </div>

            <div className="space-y-3 pt-4 border-t border-slate-100">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">Base Price</span>
                <span className="font-semibold text-slate-900">
                  {formatCurrency(basePrice)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">
                  Tax ({(taxRate * 100).toFixed(0)}%)
                </span>
                <span className="font-semibold text-slate-900">
                  {formatCurrency(taxAmount)}
                </span>
              </div>
              <div className="flex justify-between items-center pt-3 border-t border-slate-100">
                <span className="text-base font-semibold text-slate-900">Total</span>
                <span className="text-lg font-bold text-slate-900">
                  {formatCurrency(totalPrice)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Order Timeline Card */}
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
            <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              Order Timeline
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-green-100 p-2 text-green-600 shrink-0">
                  <Calendar className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    Order Placed
                  </p>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {subscription.starts_on
                      ? format(parseISO(subscription.starts_on), "MMM do, yyyy")
                      : "Date unavailable"}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="rounded-full bg-blue-100 p-2 text-blue-600 shrink-0">
                  <Clock className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">Duration</p>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {subscription.kit_duration_days} days of meals included
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Shipping Information - Using Reusable Component */}
      <ShippingTracker shippingInfo={shippingInfo} />

      {/* Additional Information */}
      <Card className="border border-blue-200 bg-blue-50/50 shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-blue-100 p-2 text-blue-600 shrink-0">
              <Package className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-900 mb-1">
                About Your KIT
              </p>
              <p className="text-sm text-blue-800/90 leading-relaxed">
                Your KIT contains {subscription.kit_duration_days} days of pre-packaged,
                ready-to-eat meals. Once shipped, you&apos;ll receive tracking information
                to monitor your delivery. For any questions about your order, please contact
                our support team.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
