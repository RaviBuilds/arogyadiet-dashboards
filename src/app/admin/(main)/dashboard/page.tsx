import Link from "next/link";
import { Warehouse } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

export default function AdminDashboardPage() {
  return (
    <div className="container space-y-8 py-8">
      <h1 className="text-3xl font-bold">
        Welcome to the Arogyadiet Admin Control Center
      </h1>

      <Link href="/admin/inventory" className="block max-w-md">
        <Card className="border-primary/20 transition-colors hover:border-primary/50 hover:bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary">
              <Warehouse className="size-5" />
              Manage Warehouse Inventory
            </CardTitle>
            <CardDescription>
              Open the isolated warehouse system to register and manage master
              catalog products.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full">Enter Warehouse System</Button>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
