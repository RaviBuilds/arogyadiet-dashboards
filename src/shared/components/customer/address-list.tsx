"use client";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Edit, Trash2, Plus } from "lucide-react";
import type { Address } from "@/services/addressService";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddressFormModal } from "./address-form-modal";
import { deleteAddressAction } from "@/actions/addressActions";
import { dispatchNotificationsRefresh } from "@/lib/notifications/refresh"; 

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

interface AddressListProps {
  addresses: Address[];
  onRefresh?: () => void;
}

export function AddressList({ addresses, onRefresh }: AddressListProps) {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);

  // State for Delete Logic
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
    setAddressToDelete(null); // Closes the dialog
  };

  return (
    <div className="space-y-6">
      {/* --- The Header and Top-Level Button --- */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Delivery Addresses
          </h2>
          <p className="text-sm text-slate-500">
            Manage where you want your daily diet meals delivered.
          </p>

          {addresses && addresses.length >= 2 && (
            <p className="mt-2 inline-block rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
              Note: A maximum of 2 addresses can be maintained.
            </p>
          )}
        </div>

        {addresses && addresses.length > 0 && (
          <Button
            variant="default"
            onClick={handleAdd}
            disabled={addresses.length >= 2}
            className="shrink-0 transition-all duration-200"
          >
            Add Address
          </Button>
        )}
      </div>

      {/* --- EMPTY STATE --- */}
      {!addresses || addresses.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-12 text-center">
          <MapPin className="mb-4 h-12 w-12 text-slate-400 opacity-50" />
          <h3 className="text-lg font-semibold tracking-tight text-slate-900">
            No addresses saved
          </h3>
          <p className="mt-2 mb-6 max-w-sm text-sm text-slate-500">
            You haven't added any delivery addresses yet. Add one now to start
            receiving your diet plans.
          </p>
          <Button onClick={handleAdd} className="transition-all duration-200">
            <Plus className="mr-2 h-4 w-4" /> Add New Address
          </Button>
        </div>
      ) : (
        /* --- POPULATED GRID STATE --- */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {addresses.map((address) => (
            <Card
              key={address.id}
              className="relative flex flex-col overflow-hidden rounded-xl border border-slate-200 shadow-sm transition-all duration-200 hover:shadow-md"
            >
              {address.is_primary && (
                <div className="absolute top-0 left-0 w-full h-1 bg-primary" />
              )}

              <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" />
                  {address.tag}
                </CardTitle>
                <div className="flex gap-2">
                  {address.is_primary && (
                    <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                      Primary Default
                    </Badge>
                  )}
                </div>
              </CardHeader>

              <CardContent className="flex-1 space-y-1 pb-4 text-sm text-slate-500">
                <p className="font-medium text-slate-900">
                  {address.street_1}
                </p>
                {address.street_2 && <p>{address.street_2}</p>}
                {address.landmark && <p>Landmark: {address.landmark}</p>}
                <p className="pt-2 font-medium">
                  {address.city}, {address.state}{" "}
                  <span className="text-slate-900">{address.pincode}</span>
                </p>
              </CardContent>

              <CardFooter className="flex flex-row items-center justify-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit transition-all duration-200"
                  onClick={() => handleEdit(address)}
                >
                  <Edit className="mr-2 h-4 w-4" /> Edit
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="w-fit text-destructive transition-all duration-200 hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setAddressToDelete(address.id)}
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Delete
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* The Edit/Add Modal */}
      <AddressFormModal
        key={editingAddress?.id || "new"}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialData={editingAddress}
        onSuccess={() => {
          setIsModalOpen(false); // Close the inner form
          if (onRefresh) onRefresh(); // Trigger the fetch update!
        }}
      />

      {/* The Delete Confirmation Dialog */}
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
 