"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PackagePlus } from "lucide-react";

import type { InventoryProductCategory } from "@/lib/inventory/product-schema";
import AddProductForm from "@/shared/components/admin/inventory/AddProductForm";
import { Button } from "@/shared/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/components/ui/sheet";

interface RegisterProductSheetProps {
  basePath?: string;
  categories?: InventoryProductCategory[];
}

export default function RegisterProductSheet({
  categories = [],
}: RegisterProductSheetProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function handleSuccess() {
    setOpen(false);
    router.refresh();
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button>
          <PackagePlus />
          Register New Product
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-xl"
      >
        <SheetHeader>
          <SheetTitle>Register New Master Product</SheetTitle>
          <SheetDescription>
            Add a raw material or finished good to the warehouse master
            catalog.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <AddProductForm onSuccess={handleSuccess} categories={categories} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
