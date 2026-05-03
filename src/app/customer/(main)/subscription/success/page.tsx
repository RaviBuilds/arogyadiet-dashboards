import Link from "next/link";
import { CheckCircle2, ReceiptText } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

export default function SubscriptionSuccessPage() {
  return (
    <div className="min-h-[calc(100vh-6rem)] bg-slate-50/50 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <Card className="border-2 shadow-sm">
          <CardHeader className="items-center text-center">
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-9 w-9" strokeWidth={1.8} />
            </div>
            <CardTitle className="text-2xl">Subscription Activated</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 text-center">
            <p className="text-sm leading-6 text-muted-foreground">
              Your payment was verified and your Arogyadiet subscription has
              been activated successfully.
            </p>
            <div className="flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild className="gap-2">
                <Link href="/customer/subscription">
                  <ReceiptText className="h-4 w-4" />
                  View Subscription
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
