import Link from "next/link";
import { AlertCircle, ArrowRight } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/shared/components/ui/alert";

/**
 * ProfileGateBanner — unchanged business rule (profile must be complete
 * before subscribing), restyled to match the premium wellness language
 * instead of a plain amber alert box.
 */
export function ProfileGateBanner() {
  return (
    <Alert className="reveal-rise rounded-3xl border-amber-200 bg-amber-50/80 p-5 text-amber-900 shadow-sm sm:p-6">
      <AlertCircle className="h-5 w-5 stroke-amber-600" />
      <AlertTitle className="font-semibold text-amber-900">
        Profile Incomplete
      </AlertTitle>
      <AlertDescription className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <p className="text-sm leading-relaxed text-amber-800/90">
          Please update your dietary preferences in your profile before
          initiating a plan customization and purchase.
        </p>
        <Button
          asChild
          size="sm"
          className="shrink-0 bg-amber-600 text-white transition-all duration-200 hover:bg-amber-700"
        >
          <Link href="/profile">
            Update Profile Now <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
