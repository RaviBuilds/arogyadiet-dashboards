"use client";

import type { RiderSegmentData, PincodePerformance } from "@/types/dashboard";
import { MapPin, Truck, Route, Users } from "lucide-react";

interface RiderSegmentProps {
  data: RiderSegmentData;
}

const CAPACITY_BADGE: Record<PincodePerformance["capacityStatus"], { bg: string; text: string; label: string }> = {
  optimized: { bg: "bg-emerald-50", text: "text-emerald-800", label: "Optimized" },
  warning: { bg: "bg-amber-50", text: "text-amber-800", label: "High Load" },
  critical: { bg: "bg-red-50", text: "text-red-800", label: "Critical" },
  unassigned: { bg: "bg-slate-100", text: "text-slate-600", label: "Unassigned" },
};

export default function RiderSegment({ data }: RiderSegmentProps) {
  const { pincodePerformance, fleetOverview } = data;

  return (
    <div className="space-y-6">
      {/* Fleet Overview Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <FleetStatCard
          icon={<Users className="h-4 w-4 text-slate-600" />}
          label="Total Fleet"
          value={fleetOverview.totalRiders.toString()}
        />
        <FleetStatCard
          icon={<Truck className="h-4 w-4 text-emerald-600" />}
          label="Active Riders"
          value={fleetOverview.activeRiders.toString()}
        />
        <FleetStatCard
          icon={<div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />}
          label="Online Now"
          value={fleetOverview.onlineNow.toString()}
        />
        <FleetStatCard
          icon={<Route className="h-4 w-4 text-slate-600" />}
          label="Avg Deliveries/Rider"
          value={`${fleetOverview.avgDeliveriesPerRider}/wk`}
        />
        <FleetStatCard
          icon={<MapPin className="h-4 w-4 text-slate-600" />}
          label="Total Distance"
          value={`${fleetOverview.totalDistanceKm} km`}
          subtitle="Last 7 days"
        />
      </div>

      {/* Pincode Performance Table */}
      <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-slate-600" />
            <h3 className="text-sm font-semibold text-slate-800">
              Pincode Service Area Performance
            </h3>
          </div>
          <div className="flex items-center gap-3">
            <CapacityLegendItem status="optimized" />
            <CapacityLegendItem status="warning" />
            <CapacityLegendItem status="critical" />
            <CapacityLegendItem status="unassigned" />
          </div>
        </div>

        <div className="overflow-auto max-h-[420px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white border-b border-slate-200">
              <tr>
                <th className="text-left py-3 px-5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Pincode
                </th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Area
                </th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Assigned Rider
                </th>
                <th className="text-right py-3 px-5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Volume (7d)
                </th>
                <th className="text-center py-3 px-5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pincodePerformance.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    No service area data available
                  </td>
                </tr>
              ) : (
                pincodePerformance.map((area) => {
                  const badge = CAPACITY_BADGE[area.capacityStatus];
                  return (
                    <tr key={area.pincode} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3 px-5 font-mono text-xs font-semibold text-slate-800">
                        {area.pincode}
                      </td>
                      <td className="py-3 px-5 text-slate-600">
                        {area.areaName}
                      </td>
                      <td className="py-3 px-5 text-slate-600">
                        {area.assignedRider || (
                          <span className="text-slate-400 italic">Unassigned</span>
                        )}
                      </td>
                      <td className="py-3 px-5 text-right font-semibold text-slate-800">
                        {area.deliveryVolume}
                      </td>
                      <td className="py-3 px-5 text-center">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FleetStatCard({
  icon,
  label,
  value,
  subtitle,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xl font-bold text-slate-800">{value}</p>
      {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function CapacityLegendItem({ status }: { status: PincodePerformance["capacityStatus"] }) {
  const badge = CAPACITY_BADGE[status];
  return (
    <div className="flex items-center gap-1.5">
      <div className={`h-2 w-2 rounded-full ${badge.bg.replace("50", "500")}`} />
      <span className="text-xs text-slate-500">{badge.label}</span>
    </div>
  );
}
