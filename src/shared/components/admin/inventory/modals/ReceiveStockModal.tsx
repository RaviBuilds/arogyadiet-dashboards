"use client";



import { type ReactNode, useState } from "react";

import { format } from "date-fns";

import { CalendarIcon } from "lucide-react";

import { toast } from "sonner";



import { type BaseUom } from "@/lib/inventory/product-schema";

import { cn } from "@/lib/utils";

import { useInventoryStore } from "@/shared/stores/useInventoryStore";

import { Button } from "@/shared/components/ui/button";

import { Calendar } from "@/shared/components/ui/calendar";

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

  Popover,

  PopoverContent,

  PopoverTrigger,

} from "@/shared/components/ui/popover";



const BASE_UOM_LABELS: Record<BaseUom, string> = {

  KG: "KG",

  LITRE: "Litre",

  UNIT: "Unit",

};



interface ReceiveStockModalProps {

  productId: string;

  productName: string;

  baseUom: BaseUom;

  trigger?: ReactNode;

}



export default function ReceiveStockModal({

  productId,

  productName,

  baseUom,

  trigger,

}: ReceiveStockModalProps) {

  const addInboundItem = useInventoryStore((state) => state.addInboundItem);

  const [open, setOpen] = useState(false);

  const [quantity, setQuantity] = useState("");

  const [totalCost, setTotalCost] = useState("");

  const [expiryDate, setExpiryDate] = useState<Date | undefined>();

  const [isCalendarOpen, setIsCalendarOpen] = useState(false);



  const uomLabel = BASE_UOM_LABELS[baseUom];



  function resetForm() {

    setQuantity("");

    setTotalCost("");

    setExpiryDate(undefined);

    setIsCalendarOpen(false);

  }



  function handleOpenChange(nextOpen: boolean) {

    setOpen(nextOpen);

    if (!nextOpen) {

      resetForm();

    }

  }



  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {

    event.preventDefault();



    addInboundItem({

      productId,

      name: productName,

      qty: Number(quantity),

      cost: Number(totalCost),

      expiry: expiryDate ? format(expiryDate, "yyyy-MM-dd") : undefined,

    });



    toast.success("Added to Staging");

    resetForm();

    setOpen(false);

  }



  return (

    <Dialog open={open} onOpenChange={handleOpenChange}>

      <DialogTrigger asChild>

        {trigger ?? (

          <Button type="button" variant="secondary" className="w-full">

            + Receive Stock

          </Button>

        )}

      </DialogTrigger>

      <DialogContent className="sm:max-w-md">

        <DialogHeader>

          <DialogTitle>Receive Inbound Stock: {productName}</DialogTitle>

        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">

          <div className="space-y-2">

            <Label htmlFor={`quantity-${productId}`}>

              Quantity Received ({uomLabel})

            </Label>

            <Input

              id={`quantity-${productId}`}

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

            <Label htmlFor={`totalCost-${productId}`}>

              Total Purchase Cost (INR)

            </Label>

            <Input

              id={`totalCost-${productId}`}

              type="number"

              min={0}

              step="0.01"

              required

              value={totalCost}

              onChange={(e) => setTotalCost(e.target.value)}

              placeholder="Enter total purchase cost"

            />

          </div>



          <div className="space-y-2">

            <Label>Expiry Date (Optional)</Label>

            <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>

              <PopoverTrigger asChild>

                <Button

                  type="button"

                  variant="outline"

                  className={cn(

                    "w-full justify-start text-left font-normal",

                    !expiryDate && "text-muted-foreground",

                  )}

                >

                  <CalendarIcon className="mr-2 h-4 w-4" />

                  {expiryDate

                    ? format(expiryDate, "PPP")

                    : "Auto-calculated from durability"}

                </Button>

              </PopoverTrigger>

              <PopoverContent className="w-auto p-0" align="start">

                <Calendar

                  mode="single"

                  selected={expiryDate}

                  onSelect={(date) => {

                    setExpiryDate(date);

                    setIsCalendarOpen(false);

                  }}

                  initialFocus

                />

              </PopoverContent>

            </Popover>

            <p className="text-xs text-muted-foreground">

              Leave blank to auto-calculate expiry from the product&apos;s

              durability setting.

            </p>

          </div>



          <Button type="submit" className="w-full">

            Add to Inbound Cart

          </Button>

        </form>

      </DialogContent>

    </Dialog>

  );

}

