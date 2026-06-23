import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/shared/components/ui/button";

/**
 * Reusable "Back to System" navigation button.
 * Used on all pages accessible from the System & Configuration cards.
 */
export function BackToSystem() {
  return (
    <Link href="/system">
      <Button variant="outline" size="sm" className="gap-1.5">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to System
      </Button>
    </Link>
  );
}
