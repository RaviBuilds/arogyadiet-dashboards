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
import { AddressFormModal } from "./address-form-modal"; // <-- Imported the modal

interface AddressListProps {
  addresses: Address[];
}

export function AddressList({ addresses }: AddressListProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);

  const handleAdd = () => {
    setEditingAddress(null);
    setIsModalOpen(true);
  };

  const handleEdit = (address: Address) => {
    setEditingAddress(address);
    setIsModalOpen(true);
  };

  // Empty Grid State
  if (!addresses || addresses.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-lg bg-muted/30 text-center">
          <MapPin className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-semibold tracking-tight">
            No addresses saved
          </h3>
          <p className="text-sm text-muted-foreground mt-2 mb-6 max-w-sm">
            You haven't added any delivery addresses yet. Add one now to start
            receiving your diet plans.
          </p>
          {/* Wired up the Add button */}
          <Button onClick={handleAdd}>
            <Plus className="mr-2 h-4 w-4" /> Add New Address
          </Button>
        </div>

        {/* Mounted the modal for the empty state */}
        <AddressFormModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      </>
    );
  }

  // Populated Grid State
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {addresses.map((address) => (
          <Card
            key={address.id}
            className="flex flex-col relative overflow-hidden transition-all hover:shadow-md"
          >
            {/* Subtle indicator line for Primary address */}
            {address.is_primary && (
              <div className="absolute top-0 left-0 w-full h-1 bg-primary" />
            )}

            <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                {address.tag}
              </CardTitle>
              <div className="flex gap-2">
                {address.is_primary && <Badge variant="default">Primary</Badge>}
                {address.is_backup && <Badge variant="secondary">Backup</Badge>}
              </div>
            </CardHeader>

            <CardContent className="flex-1 pb-4 text-sm text-muted-foreground space-y-1">
              <p className="text-foreground font-medium">{address.street_1}</p>
              {address.street_2 && <p>{address.street_2}</p>}
              {address.landmark && <p>Landmark: {address.landmark}</p>}
              <p className="pt-2 font-medium">
                {address.city}, {address.state}{" "}
                <span className="text-foreground">{address.pincode}</span>
              </p>
            </CardContent>

            <CardFooter className="pt-0 flex gap-3">
              {/* Wired up the Edit button */}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => handleEdit(address)}
              >
                <Edit className="h-4 w-4 mr-2" /> Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" /> Delete
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      {/* Mounted the modal for the populated state */}
      <AddressFormModal
        key={editingAddress?.id || "new"} // Forces form reset when switching addresses
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialData={editingAddress}
      />
    </>
  );
}
