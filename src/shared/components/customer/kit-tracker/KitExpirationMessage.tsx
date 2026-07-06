"use client";

import { AlertCircle, MessageCircle } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

const SUPPORT_WHATSAPP = "919959389389";
const WHATSAPP_URL = `https://wa.me/${SUPPORT_WHATSAPP}?text=Hi%20Admin,%20my%20KIT%20has%20expired.%20Please%20issue%20a%20new%20KIT.`;

/**
 * Displays expiration messaging when a customer's KIT has expired
 * and no new PENDING/ACTIVE subscription exists.
 * Includes a "Contact Admin" CTA that opens WhatsApp support.
 *
 * Requirements: 7.1, 7.2
 */
export function KitExpirationMessage() {
  return (
    <div className="flex items-center justify-center min-h-[400px] px-4">
      <Card className="w-full max-w-md shadow-lg border-0">
        <CardHeader className="text-center pb-2 pt-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
            <AlertCircle className="h-7 w-7 text-gray-500" />
          </div>
          <CardTitle className="text-xl">KIT Expired</CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            KIT has been expired, contact the admin to issue new KIT
          </p>
        </CardHeader>
        <CardContent className="space-y-4 px-6 pb-8 pt-4">
          <Button
            className="w-full h-12 rounded-lg text-base font-semibold shadow-sm"
            asChild
          >
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle className="mr-2 h-5 w-5" />
              Contact Admin
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
