"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Blend, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { multiDispatchToManufacturingAction } from "@/actions/inventory-actions";
import {
  type ActiveRawMaterialLot,
  type BaseUom,
  type ManufacturingProductMapping,
} from "@/lib/inventory/product-schema";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
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

  // Group lots by raw product so the UI reads as "N raw materials", not
  // "N batches" — a single ingredient can have multiple lots/batches.
  const lotsByProduct = useMemo(() => {
    const groups = new Map<
      string,
      { productId: string; productName: string; lots: ActiveRawMaterialLot[] }
    >();

    for (const lot of relevantLots) {
      const existing = groups.get(lot.productId);
      if (existing) {
        existing.lots.push(lot);
      } else {
        groups.set(lot.productId, {
          productId: lot.productId,
          productName: lot.productName,
          lots: [lot],
        });
      }
    }

    return Array.from(groups.values());
  }, [relevantLots]);

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
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Blend className="size-4 text-primary" />
          </div>
          <div>
            <p className="text-[15px] font-semibold leading-snug text-slate-900">
              Multi-Material Dispatch
            </p>
            <p className="text-xs text-slate-500">
              Combine multiple raw materials into one manufacturing batch.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-medium text-slate-700">
            Select Mapping
          </Label>
          <Select
            value={selectedMappingId}
            onValueChange={(val) => {
              setSelectedMappingId(val);
              setQuantities({});
            }}
          >
            <SelectTrigger className="border-slate-200">
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
            {/* Recipe summary: N raw materials -> finished products, unambiguous count */}
            <div className="flex items-stretch gap-3 rounded-xl bg-slate-50/80 p-3.5">
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {selectedMapping.rawProducts.length} Raw Material
                  {selectedMapping.rawProducts.length !== 1 ? "s" : ""}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedMapping.rawProducts.map((p) => (
                    <Badge
                      key={p.id}
                      className="border-0 bg-secondary/15 font-normal text-emerald-800"
                    >
                      {p.name}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center">
                <ArrowRight className="size-4 text-slate-400" />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Output
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedMapping.finishedProducts.map((p) => (
                    <Badge
                      key={p.id}
                      variant="outline"
                      className="border-slate-300 font-normal text-slate-700"
                    >
                      {p.name}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2.5">
              <Label className="text-xs font-medium text-slate-700">
                Available Lots by Ingredient
              </Label>
              {lotsByProduct.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-3.5 py-6 text-center text-sm text-slate-500">
                  No active lots for the required raw materials.
                </p>
              ) : (
                <div className="space-y-3">
                  {lotsByProduct.map((group) => (
                    <div
                      key={group.productId}
                      className="rounded-xl border border-slate-200 bg-white p-3"
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">
                          {group.productName}
                        </p>
                        {group.lots.length > 1 && (
                          <Badge
                            variant="outline"
                            className="border-slate-300 text-[11px] font-normal text-slate-500"
                          >
                            {group.lots.length} batches available
                          </Badge>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {group.lots.map((lot) => {
                          const uomLabel = BASE_UOM_LABELS[lot.baseUom];
                          return (
                            <div
                              key={lot.id}
                              className="flex items-center gap-3 rounded-lg bg-slate-50/80 px-3 py-2"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium text-slate-700">
                                  Batch {lot.batchNumber}
                                </p>
                                <p className="text-xs text-slate-500">
                                  Available: {lot.quantityRemaining} {uomLabel}
                                </p>
                              </div>
                              <Input
                                type="number"
                                min={0.01}
                                max={lot.quantityRemaining}
                                step="0.01"
                                placeholder={`Qty (${uomLabel})`}
                                className="w-28 border-slate-200 bg-white"
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
                    </div>
                  ))}
                </div>
              )}
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
