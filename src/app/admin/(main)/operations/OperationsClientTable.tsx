"use client";

import { type FC } from "react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";

interface OperationsClientTableProps {
  data: any[]; // TODO: Define a proper type for delivery data
}

const OperationsClientTable: FC<OperationsClientTableProps> = ({ data }) => {
  return (
    <Card className="border-border shadow-sm">
      <CardContent className="p-4 md:px-6">
        <div className="rounded-md border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Rider</TableHead>
                <TableHead>Delivery Date</TableHead>
                <TableHead>Route Sequence</TableHead>
                <TableHead>Batch ID</TableHead>
                <TableHead>Batch Status</TableHead>
                <TableHead>Distance (km)</TableHead>
                <TableHead>Payout (INR)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell>{delivery.id}</TableCell>
                  <TableCell>{delivery.status}</TableCell>
                  <TableCell>{delivery.customer_profiles?.users?.full_name}</TableCell>
                  <TableCell>{delivery.rider_profiles?.users?.full_name}</TableCell>
                  <TableCell>{delivery.delivery_date}</TableCell>
                  <TableCell>{delivery.route_sequence}</TableCell>
                  <TableCell>{delivery.delivery_batches?.id}</TableCell>
                  <TableCell>{delivery.delivery_batches?.status}</TableCell>
                  <TableCell>{delivery.delivery_batches?.total_distance_km?.toFixed(2) || "N/A"}</TableCell>
                  <TableCell>{delivery.delivery_batches?.expected_payout?.toFixed(2) || "N/A"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};

export default OperationsClientTable;
