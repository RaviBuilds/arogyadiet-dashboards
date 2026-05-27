"use client";

import { Card, CardContent } from "@/shared/components/ui/card";
import {
  IndianRupee,
  TrendingUp,
  Clock,
  Truck,
  CheckCircle,
  AlertCircle,
} from "lucide-react";

interface OverviewData {
  totalRevenue: number;
  pendingCollections: number;
  thisMonthRevenue: number;
  totalRiderPayoutsGenerated: number;
  totalRiderPayoutsPaid: number;
  totalRiderPayoutsPending: number;
  totalDeliveryEarnings: number;
}

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function StatCard({
  icon: Icon,
  label,
  value,
  iconBg,
  iconColor,
}: {
  icon: any;
  label: string;
  value: string;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <Card className="border shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <div
            className={`${iconBg} h-11 w-11 rounded-xl flex items-center justify-center shrink-0`}
          >
            <Icon className={`h-5 w-5 ${iconColor}`} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              {label}
            </p>
            <p className="text-2xl font-bold tracking-tight text-foreground">
              {value}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function OverviewTab({ data }: { data: OverviewData }) {
  return (
    <div className="space-y-8">
      {/* Subscription Revenue Section */}
      <div>
        <h3 className="text-base font-semibold text-foreground mb-4">
          Subscription Revenue
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            icon={IndianRupee}
            label="Total Revenue"
            value={`₹${formatINR(data.totalRevenue)}`}
            iconBg="bg-emerald-50"
            iconColor="text-emerald-600"
          />
          <StatCard
            icon={TrendingUp}
            label="This Month"
            value={`₹${formatINR(data.thisMonthRevenue)}`}
            iconBg="bg-blue-50"
            iconColor="text-blue-600"
          />
          <StatCard
            icon={Clock}
            label="Pending Collections"
            value={`₹${formatINR(data.pendingCollections)}`}
            iconBg="bg-orange-50"
            iconColor="text-orange-600"
          />
        </div>
      </div>

      {/* Rider Payouts Section */}
      <div>
        <h3 className="text-base font-semibold text-foreground mb-4">
          Rider Payouts
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={Truck}
            label="Total Delivery Earnings"
            value={`₹${formatINR(data.totalDeliveryEarnings)}`}
            iconBg="bg-purple-50"
            iconColor="text-purple-600"
          />
          <StatCard
            icon={AlertCircle}
            label="Payouts Generated"
            value={`₹${formatINR(data.totalRiderPayoutsGenerated)}`}
            iconBg="bg-sky-50"
            iconColor="text-sky-600"
          />
          <StatCard
            icon={CheckCircle}
            label="Payouts Paid"
            value={`₹${formatINR(data.totalRiderPayoutsPaid)}`}
            iconBg="bg-emerald-50"
            iconColor="text-emerald-600"
          />
          <StatCard
            icon={Clock}
            label="Payouts Pending"
            value={`₹${formatINR(data.totalRiderPayoutsPending)}`}
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
          />
        </div>
      </div>
    </div>
  );
}
