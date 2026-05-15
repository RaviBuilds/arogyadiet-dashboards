"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, MapPin, User, Phone, Clock } from "lucide-react";

import { Card, CardContent } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { LiveTrackingMap } from "@/modules/customer/component/LiveTrackingMap";

type DeliveryOrder = {
  id: string;
  status: string;
  assigned_rider_id: string | null;
  rider?: unknown;
  address?: unknown;
};

export default function LiveTrackingClient({
  order,
  riderName,
  riderPhone,
  riderAvatar,
  addressString,
  customerLat,
  customerLng,
}: {
  order: DeliveryOrder;
  riderName: string;
  riderPhone: string | null;
  riderAvatar: string | null;
  addressString: string;
  customerLat?: number;
  customerLng?: number;
}) {
  const [etaText, setEtaText] = useState<string | null>(null);

  const formatStatus = (status: string) => {
    if (status === "OUT_FOR_DELIVERY") return "Out for delivery";
    if (status === "REACHING_TO_LOCATION") return "Rider is arriving";
    if (status === "ASSIGNED") return "Rider assigned";
    if (status === "DELIVERED") return "Delivered";
    return "Preparing...";
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          asChild
          variant="outline"
          size="icon"
          className="rounded-full shrink-0"
        >
          <Link href="/meals">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Live Tracking</h1>
          <p className="text-muted-foreground text-sm flex items-center gap-1">
            <Clock className="h-4 w-4" />
            {etaText ? `Estimated arrival in ${etaText}` : "Calculating ETA..."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Order Details */}
        <div className="lg:col-span-1 space-y-6">
          {/* Rider Card */}
          <Card className="border-2 shadow-sm">
            <CardContent className="p-6">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-4">
                Your Delivery Partner
              </p>

              <div className="flex items-center gap-4 mb-6">
                {/* Rider Avatar Logic */}
                <div className="h-14 w-14 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center overflow-hidden shrink-0 relative">
                  {riderAvatar ? (
                    <Image
                      src={riderAvatar}
                      alt={riderName}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <User className="h-6 w-6 text-blue-500" />
                  )}
                </div>

                <div>
                  <h3 className="font-black text-lg text-zinc-900 leading-tight">
                    {riderName}
                  </h3>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-500 mt-1">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                    </span>
                    {formatStatus(order.status)}
                  </div>
                </div>
              </div>

              {/* Call Rider CTA Logic */}
              {riderPhone ? (
                <Button
                  asChild
                  className="w-full bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl h-12 font-bold"
                >
                  <a href={`tel:${riderPhone}`}>
                    <Phone className="h-4 w-4 mr-2" /> Call Rider
                  </a>
                </Button>
              ) : (
                <Button
                  disabled
                  className="w-full bg-zinc-100 text-zinc-400 font-bold rounded-xl h-12 cursor-not-allowed"
                >
                  <Phone className="h-4 w-4 mr-2" /> Call Rider
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Destination Card */}
          <Card className="border-none shadow-sm bg-zinc-50">
            <CardContent className="p-6">
              <div className="flex gap-4">
                <div className="bg-white p-3 rounded-full shrink-0 h-fit shadow-sm border border-zinc-100">
                  <MapPin className="h-5 w-5 text-red-500" />
                </div>
                <div>
                  <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                    Delivering To
                  </p>
                  <p className="font-bold text-zinc-900 mt-1 line-clamp-3 leading-relaxed">
                    {addressString || "Delivery Address"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: THE MAP */}
        <div className="lg:col-span-2 h-[500px] lg:h-auto min-h-[500px] rounded-2xl overflow-hidden shadow-lg border border-zinc-200">
          <LiveTrackingMap
            riderId={order.assigned_rider_id}
            orderStatus={order.status}
            customerLat={customerLat}
            customerLng={customerLng}
            onEtaChange={setEtaText}
          />
        </div>
      </div>
    </div>
  );
}
