"use client";

import { Button } from "@/shared/components/ui/button";
import { MapPin, Home, Edit, Trash2, Plus, CheckCircle2 } from "lucide-react";
import type { Address } from "@/services/addressService";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddressFormModal } from "./address-form-modal";
import { deleteAddressAction } from "@/actions/addressActions";
import { dispatchNotificationsRefresh } from "@/lib/notifications/refresh";
import { SectionCard } from "./profile-ui/SectionCard";
import { StatusPill } from "./profile-ui/StatusPill";
import { IconChip } from "./profile-ui/IconChip";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
} from "@/shared/components/ui/alert-dialog";

interface AddressListProps {
  addresses: Address[];
  onRefresh?: () => void;
  /**
   * When true (KIT-only customers), the address form skips the service-area
   * pincode check and only validates the 6-digit format.
   */
  bypassPincodeServiceability?: boolean;
}

/**
 * Destination card — each saved address reads like a place, not a form row.
 * IconChip + StatusPill reused from the shared profile-ui primitives so this
 * matches the same visual language as Personal Details / Medical Assessment.
 */
function AddressCard({
  address,
  onEdit,
  onDelete,
}: {
  address: Address;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:shadow-md sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <IconChip icon={Home} tone={address.is_primary ? "green" : "slate"} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-slate-900">{address.tag}</p>
              {address.is_primary && (
                <StatusPill icon={CheckCircle2} tone="green">
                  Primary
                </StatusPill>
              )}
            </div>
            {/* Destination hierarchy: street stands out like a place name,
                everything below fades a step, echoing map pin cards rather
                than a plain data dump. */}
            <p className="mt-1.5 truncate text-sm font-semibold text-slate-900">
              {address.street_1}
            </p>
            {address.street_2 && (
              <p className="truncate text-xs text-slate-500">{address.street_2}</p>
            )}
            {address.landmark && (
              <p className="mt-0.5 truncate text-xs text-slate-400">
                Near {address.landmark}
              </p>
            )}
            <p className="mt-1.5 text-xs font-medium text-slate-500">
              {address.city}, {address.state} · {address.pincode}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-1.5 border-t border-slate-100 pt-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 text-slate-500 transition-all duration-200 hover:text-slate-900 active:scale-[0.98]"
          onClick={onEdit}
        >
          <Edit className="mr-1.5 h-3.5 w-3.5" /> Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 text-destructive transition-all duration-200 hover:bg-destructive/10 hover:text-destructive active:scale-[0.98]"
          onClick={onDelete}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
        </Button>
      </div>
    </div>
  );
}

export function AddressList({
  addresses,
  onRefresh,
  bypassPincodeServiceability = false,
}: AddressListProps) {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);

  const [addressToDelete, setAddressToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleAdd = () => {
    setEditingAddress(null);
    setIsModalOpen(true);
  };

  const handleEdit = (address: Address) => {
    setEditingAddress(address);
    setIsModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!addressToDelete) return;
    setIsDeleting(true);

    const result = await deleteAddressAction(addressToDelete);

    if (result?.error) {
      toast.error(result.error);
    } else {
      toast.success("Address deleted successfully.");
      dispatchNotificationsRefresh();
      if (onRefresh) onRefresh();
      router.refresh();
    }

    setIsDeleting(false);
    setAddressToDelete(null);
  };

  const atLimit = addresses && addresses.length >= 2;

  return (
    <div
      className="reveal-rise"
      style={{ ["--reveal-delay" as string]: "600ms" }}
    >
      <SectionCard
        icon={MapPin}
        iconTone="coral"
        title="Delivery Addresses"
        description="Where you want your daily diet meals delivered."
        action={
          addresses && addresses.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleAdd}
              disabled={atLimit}
              className="gap-1.5 border-primary text-primary transition-all duration-200 hover:bg-primary/5 active:scale-[0.98]"
            >
              <Plus className="h-4 w-4" /> Add
            </Button>
          ) : undefined
        }
      >
        {atLimit && (
          <p className="mb-4 inline-block rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
            A maximum of 2 addresses can be maintained.
          </p>
        )}

        {!addresses || addresses.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-10 text-center">
            <MapPin className="mb-3 h-10 w-10 text-slate-400 opacity-50" />
            <h3 className="text-base font-semibold tracking-tight text-slate-900">
              No addresses saved
            </h3>
            <p className="mt-1.5 mb-5 max-w-sm text-sm text-slate-500">
              Add a delivery address to start receiving your diet plans.
            </p>
            <Button
              onClick={handleAdd}
              className="transition-all duration-200 active:scale-[0.98]"
            >
              <Plus className="mr-2 h-4 w-4" /> Add New Address
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {addresses.map((address) => (
              <AddressCard
                key={address.id}
                address={address}
                onEdit={() => handleEdit(address)}
                onDelete={() => setAddressToDelete(address.id)}
              />
            ))}
          </div>
        )}
      </SectionCard>

      <AddressFormModal
        key={editingAddress?.id || "new"}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialData={editingAddress}
        bypassPincodeServiceability={bypassPincodeServiceability}
        onSuccess={() => {
          setIsModalOpen(false);
          if (onRefresh) onRefresh();
        }}
      />

      <AlertDialog
        open={!!addressToDelete}
        onOpenChange={(open) => !open && setAddressToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete this
              delivery address from your profile.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Yes, delete address"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
