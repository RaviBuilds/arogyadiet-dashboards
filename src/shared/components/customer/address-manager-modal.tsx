"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { AddressList } from "@/shared/components/customer/address-list";
import { createClient } from "@/lib/supabase/client";

interface AddressManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddressUpdated: () => void;
}

export function AddressManagerModal({
  isOpen,
  onClose,
  onAddressUpdated,
}: AddressManagerModalProps) {
  const [addresses, setAddresses] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const supabase = createClient();

  // 1. Wrap the fetch logic in useCallback so we can trigger it anytime
  const loadAddresses = useCallback(async () => {
    if (!isOpen) return;
    setIsLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from("customer_profiles")
      .select("id")
      .eq(
        "user_id",
        (
          await supabase
            .from("users")
            .select("id")
            .eq("auth_user_id", user.id)
            .single()
        ).data?.id,
      )
      .single();

    if (profile) {
      const { data: addrData } = await supabase
        .from("addresses")
        .select("*")
        .eq("customer_profile_id", profile.id)
        .order("is_primary", { ascending: false });

      setAddresses(addrData || []);
    }
    setIsLoading(false);
  }, [isOpen, supabase]);

  // 2. Call it on initial open
  useEffect(() => {
    loadAddresses();
  }, [loadAddresses]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onAddressUpdated();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-4xl w-[95vw] md:w-[90vw] lg:w-[80vw] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">
            Manage Addresses
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {isLoading ? (
            <div className="h-32 flex items-center justify-center">
              Loading...
            </div>
          ) : (
            // 3. Pass the refresh function down to your list!
            <AddressList addresses={addresses} onRefresh={loadAddresses} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
