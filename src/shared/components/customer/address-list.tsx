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
import { AddressFormModal } from "./address-form-modal";
import { deleteAddressAction } from "@/actions/addressActions"; // <-- Import the new action

// <-- Import Shadcn Alert Dialog components
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
}

export function AddressList({ addresses }: AddressListProps) {
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

  // The function that actually triggers the server action
  const confirmDelete = async () => {
    if (!addressToDelete) return;
    setIsDeleting(true);

    const result = await deleteAddressAction(addressToDelete);

    if (result.error) {
      console.error(result.error);
      // Optional: Add a toast notification here later
    }

    setIsDeleting(false);
    setAddressToDelete(null); // Closes the dialog
  };

  return (
    <div className="space-y-6">
      {/* --- The Header and Top-Level Button --- */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Delivery Addresses
          </h2>
          <p className="text-muted-foreground">
            Manage where you want your daily diet meals delivered.
          </p>

          {addresses && addresses.length >= 2 && (
            <p className="text-sm font-medium text-amber-600 mt-2 bg-amber-50 inline-block px-2 py-1 rounded">
              Note: A maximum of 2 addresses can be maintained.
            </p>
          )}
        </div>

        {addresses && addresses.length > 0 && (
          <Button
            variant="default"
            onClick={handleAdd}
            disabled={addresses.length >= 2}
          >
            Add Address
          </Button>
        )}
      </div>

      {/* --- EMPTY STATE --- */}
      {!addresses || addresses.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-lg bg-muted/30 text-center">
          <MapPin className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-semibold tracking-tight">
            No addresses saved
          </h3>
          <p className="text-sm text-muted-foreground mt-2 mb-6 max-w-sm">
            You haven't added any delivery addresses yet. Add one now to start
            receiving your diet plans.
          </p>
          <Button onClick={handleAdd}>
            <Plus className="mr-2 h-4 w-4" /> Add New Address
          </Button>
        </div>
      ) : (
        /* --- POPULATED GRID STATE --- */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {addresses.map((address) => (
            <Card
              key={address.id}
              className="flex flex-col relative overflow-hidden transition-all hover:shadow-md"
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
                    <Badge className="bg-secondary text-secondary-foreground hover:bg-secondary/90 border-none">
                      Primary Default
                    </Badge>
                  )}
                </div>
              </CardHeader>

              <CardContent className="flex-1 pb-4 text-sm text-muted-foreground space-y-1">
                <p className="text-foreground font-medium">
                  {address.street_1}
                </p>
                {address.street_2 && <p>{address.street_2}</p>}
                {address.landmark && <p>Landmark: {address.landmark}</p>}
                <p className="pt-2 font-medium">
                  {address.city}, {address.state}{" "}
                  <span className="text-foreground">{address.pincode}</span>
                </p>
              </CardContent>

              <CardFooter className=" flex flex-row items-center justify-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() => handleEdit(address)}
                >
                  <Edit className="h-4 w-4 mr-2" /> Edit
                </Button>

                {/* Updated Delete Button to trigger the alert dialog */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-fit text-destructive hover:bg-destructive/10 hover:text-destructive"
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
            {/* The destructive action button */}
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
