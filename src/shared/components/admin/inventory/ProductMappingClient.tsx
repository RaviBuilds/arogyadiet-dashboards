"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createMappingAction,
  deleteMappingAction,
  updateMappingAction,
} from "@/actions/inventory-actions";
import type {
  FinishedGoodOption,
  InventoryProduct,
  ManufacturingProductMapping,
} from "@/lib/inventory/product-schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

type RawProduct = Pick<InventoryProduct, "id" | "name" | "baseUom">;

interface ProductMappingClientProps {
  mappings: ManufacturingProductMapping[];
  rawProducts: RawProduct[];
  finishedProducts: FinishedGoodOption[];
}

export default function ProductMappingClient({
  mappings,
  rawProducts,
  finishedProducts,
}: ProductMappingClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function handleDelete(mappingId: string) {
    startTransition(async () => {
      setDeletingId(mappingId);
      const result = await deleteMappingAction(mappingId);
      setDeletingId(null);

      if (result.success) {
        toast.success("Mapping deleted.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {mappings.length} mapping{mappings.length !== 1 ? "s" : ""} configured
        </p>
        <MappingFormDialog
          rawProducts={rawProducts}
          finishedProducts={finishedProducts}
        />
      </div>

      {mappings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <p className="font-medium text-foreground">No mappings configured</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a mapping to define which raw materials can be converted to
              which finished products.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {mappings.map((mapping) => {
            const isDeleting = isPending && deletingId === mapping.id;
            return (
              <Card key={mapping.id} className="shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{mapping.name}</CardTitle>
                    <div className="flex gap-1">
                      <MappingFormDialog
                        rawProducts={rawProducts}
                        finishedProducts={finishedProducts}
                        existingMapping={mapping}
                      />
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive"
                            disabled={isDeleting}
                          >
                            {isDeleting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete mapping?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will remove the &ldquo;{mapping.name}&rdquo;
                              mapping. Existing manufacturing orders won&apos;t
                              be affected, but future conversions will show all
                              finished products in the dropdown.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(mapping.id)}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 space-y-1">
                      <p className="text-xs font-medium uppercase text-muted-foreground">
                        Raw Materials
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {mapping.rawProducts.map((p) => (
                          <Badge key={p.id} variant="secondary">
                            {p.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 space-y-1">
                      <p className="text-xs font-medium uppercase text-muted-foreground">
                        Finished Products
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {mapping.finishedProducts.map((p) => (
                          <Badge key={p.id} variant="outline">
                            {p.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Create / Edit Mapping Dialog ---

interface MappingFormDialogProps {
  rawProducts: RawProduct[];
  finishedProducts: FinishedGoodOption[];
  existingMapping?: ManufacturingProductMapping;
}

function MappingFormDialog({
  rawProducts,
  finishedProducts,
  existingMapping,
}: MappingFormDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(existingMapping?.name ?? "");
  const [selectedRawIds, setSelectedRawIds] = useState<string[]>(
    existingMapping?.rawProductIds ?? [],
  );
  const [selectedFinishedIds, setSelectedFinishedIds] = useState<string[]>(
    existingMapping?.finishedProductIds ?? [],
  );

  const isEdit = !!existingMapping;

  function resetForm() {
    if (!isEdit) {
      setName("");
      setSelectedRawIds([]);
      setSelectedFinishedIds([]);
    } else {
      setName(existingMapping.name);
      setSelectedRawIds(existingMapping.rawProductIds);
      setSelectedFinishedIds(existingMapping.finishedProductIds);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      resetForm();
    }
  }

  function toggleRaw(productId: string) {
    setSelectedRawIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId],
    );
  }

  function toggleFinished(productId: string) {
    setSelectedFinishedIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId],
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!name.trim()) {
      toast.error("Mapping name is required.");
      return;
    }

    if (selectedRawIds.length === 0) {
      toast.error("Select at least one raw material.");
      return;
    }

    if (selectedFinishedIds.length === 0) {
      toast.error("Select at least one finished product.");
      return;
    }

    startTransition(async () => {
      const input = {
        name: name.trim(),
        rawProductIds: selectedRawIds,
        finishedProductIds: selectedFinishedIds,
      };

      const result = isEdit
        ? await updateMappingAction({ mappingId: existingMapping.id, ...input })
        : await createMappingAction(input);

      if (result.success) {
        toast.success(isEdit ? "Mapping updated." : "Mapping created.");
        setOpen(false);
        resetForm();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button size="icon" variant="ghost" className="h-8 w-8">
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="mr-1 h-4 w-4" />
            New Mapping
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Mapping" : "Create Product Mapping"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="mapping-name">Mapping Name</Label>
            <Input
              id="mapping-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sesame Oil Tin → Sesame Oil 1Lt"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Raw Materials (Input)</Label>
            <p className="text-xs text-muted-foreground">
              Select one or more raw materials that go into this conversion.
            </p>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
              {rawProducts.map((product) => (
                <label
                  key={product.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    checked={selectedRawIds.includes(product.id)}
                    onChange={() => toggleRaw(product.id)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-sm">{product.name}</span>
                </label>
              ))}
              {rawProducts.length === 0 && (
                <p className="py-2 text-center text-sm text-muted-foreground">
                  No raw materials in catalog.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Finished Products (Output)</Label>
            <p className="text-xs text-muted-foreground">
              Select one or more finished products that can be produced from
              the selected raw materials.
            </p>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
              {finishedProducts.map((product) => (
                <label
                  key={product.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    checked={selectedFinishedIds.includes(product.id)}
                    onChange={() => toggleFinished(product.id)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-sm">{product.name}</span>
                </label>
              ))}
              {finishedProducts.length === 0 && (
                <p className="py-2 text-center text-sm text-muted-foreground">
                  No finished products in catalog.
                </p>
              )}
            </div>
          </div>

          <Button
            type="submit"
            disabled={isPending}
            className="w-full"
          >
            {isPending ? (
              <>
                <Loader2 className="animate-spin" />
                {isEdit ? "Updating..." : "Creating..."}
              </>
            ) : isEdit ? (
              "Update Mapping"
            ) : (
              "Create Mapping"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
