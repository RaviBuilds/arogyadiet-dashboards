"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { multiDispatchToManufacturingAction } from "@/actions/inventory-actions";
import {
  type ActiveRawMaterialLot,
  type BaseUom,
  type ManufacturingProductMapping,
} from "@/lib/inventory/product-schema";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
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

interface MultiDispatchPanelProps {
  mappings: ManufacturingProductMapping[];
  activeLots: ActiveRawMaterialLot[];
}

export default function MultiDispatchPanel({
  mappings,
  activeLots,
}: MultiDispatchPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedMappingId, setSelectedMappingId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  const selectedMapping = mappings.find((m) => m.id === selectedMappingId);

  // Get lots matching the selected mapping's raw products
  const relevantLots = selectedMapping
    ? activeLots.filter((lot) =>
        selectedMapping.rawProductIds.includes(lot.productId),
      )
    : [];

  function handleSubmit() {
    if (!selectedMapping) {
      toast.error("Select a mapping first.");
      return;
    }

    const items: { lotId: string; quantityToSend: number }[] = [];

    for (const lot of relevantLots) {
      const qty = Number(quantities[lot.id]);
      if (qty > 0) {
        items.push({ lotId: lot.id, quantityToSend: qty });
      }
    }

    if (items.length === 0) {
      toast.error("Enter quantity for at least one raw material lot.");
      return;
    }

    startTransition(async () => {
      const result = await multiDispatchToManufacturingAction({
        mappingId: selectedMapping.id,
        items,
      });

      if (result.success) {
        toast.success("Multi-material batch dispatched to manufacturing.");
        setQuantities({});
        setSelectedMappingId("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-5 w-5" />
          Multi-Material Dispatch
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Combine multiple raw materials into a single manufacturing batch
          (many-to-one conversion).
        </p>

        <div className="space-y-2">
          <Label>Select Mapping</Label>
          <Select
            value={selectedMappingId}
            onValueChange={(val) => {
              setSelectedMappingId(val);
              setQuantities({});
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a multi-material mapping" />
            </SelectTrigger>
            <SelectContent>
              {mappings.map((mapping) => (
                <SelectItem key={mapping.id} value={mapping.id}>
                  {mapping.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedMapping && (
          <>
            <div className="space-y-2">
              <Label>
                Raw Materials ({selectedMapping.rawProducts.map((p) => p.name).join(", ")})
              </Label>
              {relevantLots.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No active lots for the required raw materials.
                </p>
              ) : (
                <div className="space-y-2">
                  {relevantLots.map((lot) => {
                    const uomLabel = BASE_UOM_LABELS[lot.baseUom];
                    return (
                      <div
                        key={lot.id}
                        className="flex items-center gap-3 rounded-md border p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{lot.productName}</p>
                          <p className="text-xs text-muted-foreground">
                            Batch: {lot.batchNumber} · Available:{" "}
                            {lot.quantityRemaining} {uomLabel}
                          </p>
                        </div>
                        <Input
                          type="number"
                          min={0.01}
                          max={lot.quantityRemaining}
                          step="0.01"
                          placeholder={`Qty (${uomLabel})`}
                          className="w-28"
                          value={quantities[lot.id] ?? ""}
                          onChange={(e) =>
                            setQuantities((prev) => ({
                              ...prev,
                              [lot.id]: e.target.value,
                            }))
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-md bg-muted/50 p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Output Products:{" "}
                {selectedMapping.finishedProducts
                  .map((p) => p.name)
                  .join(", ")}
              </p>
            </div>

            <Button
              onClick={handleSubmit}
              disabled={isPending || relevantLots.length === 0}
              className="w-full"
            >
              {isPending ? (
                <>
                  <Loader2 className="animate-spin" />
                  Dispatching...
                </>
              ) : (
                "Dispatch Batch to Processing"
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
