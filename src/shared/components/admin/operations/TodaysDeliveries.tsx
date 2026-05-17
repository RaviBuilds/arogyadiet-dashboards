"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { User, Phone, MapPin, Navigation, Package } from "lucide-react";

export default function TodaysDeliveries({ data }: { data: any[] }) {
  // Helper to format the "Time Updated"
  const getTimeUpdated = (order: any) => {
    const dateStr =
      order.delivered_at || order.pickup_marked_at || order.created_at;
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: "2-digit",
      minute: "2-digit",
    }).toUpperCase();
  };

  // Helper to aggregate Batch Data
  const getBatchSummary = () => {
    const batches: Record<string, any> = {};

    data.forEach((order) => {
      // Fallback if batch ID is null, we group them as "Unbatched"
      const batchId = order.delivery_batches?.id || "Unbatched";

      if (!batches[batchId]) {
        batches[batchId] = {
          batchId:
            batchId === "Unbatched"
              ? "Unbatched"
              : batchId.substring(0, 8).toUpperCase(),
          riderName: order.rider_profiles?.users?.full_name || "Unassigned",
          meals: 0,
          products: 0,
          status: order.delivery_batches?.status || "PENDING",
          distance: order.delivery_batches?.total_distance_km || 0,
          payout: order.delivery_batches?.expected_payout || 0,
        };
      }

      batches[batchId].meals += 1;

      // Count Add-on Products
      const addons = order.addon_orders || [];
      addons.forEach((addon: any) => {
        const items = addon.addon_order_items || [];
        items.forEach((item: any) => {
          batches[batchId].products += item.quantity || 1;
        });
      });
    });

    return Object.values(batches);
  };

  const batchSummary = getBatchSummary();

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* TABLE 1: DELIVERY ORDERS */}
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-4 border-b">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Dispatch Board
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 md:px-6">
          <div className="rounded-md border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/10">
                  <TableHead>Customer</TableHead>
                  <TableHead>Meal Type</TableHead>
                  <TableHead>Assigned Rider</TableHead>
                  <TableHead>Seq.</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Status & Time</TableHead>
                  <TableHead className="text-right">Payout</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-8 text-muted-foreground"
                    >
                      No deliveries scheduled for today.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((order, i) => (
                    <TableRow
                      key={order.id || i}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      {/* Customer Pop-up */}
                      <TableCell className="font-medium">
                        <Dialog>
                          <DialogTrigger className="hover:underline hover:text-primary transition-all text-left">
                            {order.customer_profiles?.users?.full_name ||
                              "Unknown"}
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2">
                                <User className="h-5 w-5" /> Customer Info
                              </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 pt-4">
                              <div>
                                <p className="text-sm text-muted-foreground">
                                  Full Name
                                </p>
                                <p className="font-medium">
                                  {order.customer_profiles?.users?.full_name}
                                </p>
                              </div>
                              <div>
                                <p className="text-sm text-muted-foreground">
                                  Mobile
                                </p>
                                <p className="font-medium flex items-center gap-2">
                                  <Phone className="h-4 w-4" />{" "}
                                  {order.customer_profiles?.users?.mobile ||
                                    "N/A"}
                                </p>
                              </div>
                              <div className="bg-muted/50 p-3 rounded-md border">
                                <p className="text-sm text-muted-foreground flex items-center gap-2 mb-1">
                                  <MapPin className="h-4 w-4" /> Current
                                  Delivery Address
                                </p>
                                <p className="font-medium text-sm leading-relaxed">
                                  {order.customer_profiles?.addresses?.[0]
                                    ?.street_1 || "Address not provided"}{" "}
                                  <br />
                                  {
                                    order.customer_profiles?.addresses?.[0]
                                      ?.city
                                  }{" "}
                                  -{" "}
                                  {
                                    order.customer_profiles?.addresses?.[0]
                                      ?.pincode
                                  }
                                </p>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </TableCell>

                      <TableCell>
                        {order.meal_categories?.name || "Standard"}
                      </TableCell>

                      {/* Rider Pop-up */}
                      <TableCell>
                        {order.rider_profiles ? (
                          <Dialog>
                            <DialogTrigger className="hover:underline hover:text-primary transition-all text-left">
                              {order.rider_profiles.users?.full_name}
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                  <Navigation className="h-5 w-5" /> Rider Info
                                </DialogTitle>
                              </DialogHeader>
                              <div className="space-y-4 pt-4">
                                <div>
                                  <p className="text-sm text-muted-foreground">
                                    Rider Name
                                  </p>
                                  <p className="font-medium">
                                    {order.rider_profiles.users?.full_name}
                                  </p>
                                </div>
                                <div className="bg-red-50 dark:bg-red-950/20 p-3 rounded-md border border-red-100 dark:border-red-900">
                                  <p className="text-sm text-red-600 dark:text-red-400 font-semibold mb-1">
                                    Emergency Contact
                                  </p>
                                  <p className="font-medium flex items-center gap-2">
                                    <Phone className="h-4 w-4" />{" "}
                                    {order.rider_profiles.emergency_contact ||
                                      "Not Provided"}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-sm text-muted-foreground mb-2">
                                    Assigned Service Areas (Pincodes)
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    {order.rider_profiles.rider_service_areas?.map(
                                      (area: any) => (
                                        <Badge
                                          key={area.area_name}
                                          variant="secondary"
                                        >
                                          {area.area_name}
                                        </Badge>
                                      ),
                                    ) || (
                                      <span className="text-sm">
                                        None assigned
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </DialogContent>
                          </Dialog>
                        ) : (
                          <span className="text-muted-foreground text-sm italic">
                            Unassigned
                          </span>
                        )}
                      </TableCell>

                      <TableCell>{order.route_sequence || "-"}</TableCell>

                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">
                          {order.delivery_batches?.id
                            ? order.delivery_batches.id
                                .substring(0, 6)
                                .toUpperCase()
                            : "None"}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge
                            variant={
                              order.status === "DELIVERED"
                                ? "default"
                                : "secondary"
                            }
                            className="w-fit"
                          >
                            {order.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {getTimeUpdated(order)}
                          </span>
                        </div>
                      </TableCell>

                      <TableCell className="text-right font-medium">
                        ₹{order.payout_amount || 0}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* TABLE 2: BATCH AGGREGATION */}
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-4 border-b">
          <CardTitle className="text-lg font-semibold">
            Active Batches Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 md:px-6">
          <div className="rounded-md border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/10">
                  <TableHead>Batch Number</TableHead>
                  <TableHead>Meals Count</TableHead>
                  <TableHead>Shop Products Count</TableHead>
                  <TableHead>Distance (km)</TableHead>
                  <TableHead>Payout (INR)</TableHead>
                  <TableHead>Assigned Rider</TableHead>
                  <TableHead>Batch Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batchSummary.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-6 text-muted-foreground"
                    >
                      No batches active.
                    </TableCell>
                  </TableRow>
                ) : (
                  batchSummary.map((batch, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono font-medium">
                        {batch.batchId}
                      </TableCell>
                      <TableCell className="font-semibold text-lg">
                        {batch.meals}
                      </TableCell>
                      <TableCell className="font-semibold text-lg text-primary">
                        {batch.products}
                      </TableCell>
                      <TableCell className="font-semibold text-lg">
                        {batch.distance.toFixed(2)}
                      </TableCell>
                      <TableCell className="font-semibold text-lg">
                        ₹{batch.payout.toFixed(2)}
                      </TableCell>
                      <TableCell>{batch.riderName}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            batch.status === "PICKED" ? "default" : "outline"
                          }
                        >
                          {batch.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
