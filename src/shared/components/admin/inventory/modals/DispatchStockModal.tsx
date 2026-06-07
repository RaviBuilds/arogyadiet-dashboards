"use client";



import { type ReactNode, useState } from "react";

import { toast } from "sonner";



import {

  DISPATCH_STOCK_REASONS,

  type BaseUom,

  type DispatchStockReason,

} from "@/lib/inventory/product-schema";

import { useInventoryStore } from "@/shared/stores/useInventoryStore";

import { Button } from "@/shared/components/ui/button";

import {

  Dialog,

  DialogContent,

  DialogHeader,

  DialogTitle,

  DialogTrigger,

} from "@/shared/components/ui/dialog";

import { Input } from "@/shared/components/ui/input";

import { Label } from "@/shared/components/ui/label";

import {

  Select,

  SelectContent,

  SelectItem,

  SelectTrigger,

  SelectValue,

} from "@/shared/components/ui/select";



const BASE_UOM_LABELS: Record<BaseUom, string> = {

  KG: "KG",

  LITRE: "Litre",

  UNIT: "Unit",

};



interface DispatchStockModalProps {

  productId: string;

  productName: string;

  baseUom: BaseUom;

  trigger?: ReactNode;

}



export default function DispatchStockModal({

  productId,

  productName,

  baseUom,

  trigger,

}: DispatchStockModalProps) {

  const addOutboundItem = useInventoryStore((state) => state.addOutboundItem);

  const [open, setOpen] = useState(false);

  const [quantity, setQuantity] = useState("");

  const [reason, setReason] = useState<DispatchStockReason | "">("");



  const uomLabel = BASE_UOM_LABELS[baseUom];



  function resetForm() {

    setQuantity("");

    setReason("");

  }



  function handleOpenChange(nextOpen: boolean) {

    setOpen(nextOpen);

    if (!nextOpen) {

      resetForm();

    }

  }



  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {

    event.preventDefault();



    if (!reason) {

      toast.error("Select a dispatch reason.");

      return;

    }



    addOutboundItem({

      productId,

      name: productName,

      qty: Number(quantity),

      reason,

    });



    toast.success("Added to Staging");

    resetForm();

    setOpen(false);

  }



  return (

    <Dialog open={open} onOpenChange={handleOpenChange}>

      <DialogTrigger asChild>

        {trigger ?? (

          <Button type="button" variant="outline" className="w-full">

            - Dispatch

          </Button>

        )}

      </DialogTrigger>

      <DialogContent className="sm:max-w-md">

        <DialogHeader>

          <DialogTitle>Dispatch Stock: {productName}</DialogTitle>

        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">

          <div className="space-y-2">

            <Label htmlFor={`dispatch-quantity-${productId}`}>

              Quantity to Dispatch ({uomLabel})

            </Label>

            <Input

              id={`dispatch-quantity-${productId}`}

              type="number"

              min={0.01}

              step="0.01"

              required

              value={quantity}

              onChange={(e) => setQuantity(e.target.value)}

              placeholder={`Enter quantity in ${uomLabel}`}

            />

          </div>



          <div className="space-y-2">

            <Label htmlFor={`dispatch-reason-${productId}`}>

              Reason / Destination

            </Label>

            <Select

              value={reason}

              onValueChange={(value) =>

                setReason(value as DispatchStockReason)

              }

              required

            >

              <SelectTrigger id={`dispatch-reason-${productId}`}>

                <SelectValue placeholder="Select reason" />

              </SelectTrigger>

              <SelectContent>

                {DISPATCH_STOCK_REASONS.map((option) => (

                  <SelectItem key={option} value={option}>

                    {option}

                  </SelectItem>

                ))}

              </SelectContent>

            </Select>

          </div>



          <p className="text-sm text-muted-foreground">

            Note: Stock will be deducted automatically using FIFO (oldest expiry

            first).

          </p>



          <Button

            type="submit"

            variant="destructive"

            disabled={!reason}

            className="w-full"

          >

            Add to Outbound Cart

          </Button>

        </form>

      </DialogContent>

    </Dialog>

  );

}

