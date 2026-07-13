"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { IndianRupee, Save, Loader2, AlertCircle } from "lucide-react";

import { Card, CardContent } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

import {
  getRateConfigsAction,
  upsertRateAction,
  type RateConfigView,
} from "@/actions/master-actions/rateConfigActions";
import type { RateScope, RateField } from "@/services/RateConfigService";
import { MASTER_CARD_MAX_RATE_PER_KM } from "@/lib/delivery/deliveryCharge";

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

const MIN_RATE = 0;
const MAX_RATE = MASTER_CARD_MAX_RATE_PER_KM; // 9,999.99

/**
 * Validates a rate string input against Req 10.7, 10.8 constraints:
 * - Must be numeric
 * - Must be >= 0.00
 * - Must be <= 9,999.99
 * - Must have at most 2 decimal places
 */
function validateRateInput(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return "Rate is required";

  const num = Number(trimmed);
  if (!Number.isFinite(num)) return "Rate must be a valid number";
  if (num < MIN_RATE) return `Rate must be between ₹0.00 and ₹${MAX_RATE.toLocaleString("en-IN")} per km`;
  if (num > MAX_RATE) return `Rate must be between ₹0.00 and ₹${MAX_RATE.toLocaleString("en-IN")} per km`;

  // Check at most 2 decimal places
  const parts = trimmed.split(".");
  if (parts.length === 2 && parts[1].length > 2) {
    return "Rate must have at most 2 decimal places";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Inline-editable rate field
// ---------------------------------------------------------------------------

interface RateFieldInputProps {
  label: string;
  fieldKey: string;
  initialValue: number | null;
  scope: RateScope;
  field: RateField;
}

function RateFieldInput({ label, fieldKey, initialValue, scope, field }: RateFieldInputProps) {
  const [value, setValue] = useState(initialValue !== null ? String(initialValue) : "");
  const [previousValue, setPreviousValue] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Sync if parent data reloads
  useEffect(() => {
    const v = initialValue !== null ? String(initialValue) : "";
    setValue(v);
    setPreviousValue(v);
  }, [initialValue]);

  const handleSave = () => {
    const validationError = validateRateInput(value);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await upsertRateAction({ scope, field, value: Number(value) });
      if (result.success) {
        toast.success("Rate saved successfully");
        setPreviousValue(value);
      } else {
        toast.error(result.error || "Failed to save rate");
        // Retain previous value on persistence failure (Req 10.9)
        setValue(previousValue);
      }
    });
  };

  return (
    <div className="space-y-1">
      <Label htmlFor={fieldKey} className="flex items-center gap-1.5 text-sm font-medium">
        <IndianRupee className="h-3.5 w-3.5 text-muted-foreground" />
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={fieldKey}
          type="number"
          step="0.01"
          min="0"
          max={MAX_RATE}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          className="max-w-[160px]"
          placeholder="0.00"
        />
        <span className="text-xs text-muted-foreground whitespace-nowrap">/km</span>
        <Button
          size="sm"
          variant="outline"
          onClick={handleSave}
          disabled={isPending}
          className="gap-1.5"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save
        </Button>
      </div>
      {error && (
        <p className="flex items-center gap-1 text-xs text-red-600">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main card component
// ---------------------------------------------------------------------------

export function RateConfigCard() {
  const [data, setData] = useState<RateConfigView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const result = await getRateConfigsAction();
    if (result.success) {
      setData(result.data);
      setLoadError(null);
    } else {
      setLoadError(result.error);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading rate configurations…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="flex items-center gap-2 text-sm text-red-600">
            <AlertCircle className="h-4 w-4" />
            {loadError}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card>
      <CardContent className="p-6 space-y-8">
        {/* Header */}
        <div>
          <h3 className="text-base font-semibold text-foreground mb-1">
            Rate Configuration
          </h3>
          <p className="text-sm text-muted-foreground">
            Manage per-km delivery and rider payout rates for the Core Business
            and each franchise. Rates are in INR per kilometer.
          </p>
        </div>

        {/* Core Business Rates */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-foreground border-b pb-2">
            Core Business Rates
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <RateFieldInput
              label="Delivery Rate"
              fieldKey="core-delivery-rate"
              initialValue={data.core.deliveryRatePerKm}
              scope={{ type: "CORE_BUSINESS" }}
              field="delivery_rate_per_km"
            />
            <RateFieldInput
              label="Rider Payout Rate"
              fieldKey="core-payout-rate"
              initialValue={data.core.riderPayoutRatePerKm}
              scope={{ type: "CORE_BUSINESS" }}
              field="rider_payout_rate_per_km"
            />
          </div>
        </div>

        {/* Franchise Rates */}
        {data.franchises.length > 0 && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-foreground border-b pb-2">
              Franchise Rates
            </h4>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Franchise</TableHead>
                    <TableHead>Delivery Rate (₹/km)</TableHead>
                    <TableHead>Rider Payout Rate (₹/km)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.franchises.map((franchise) => (
                    <TableRow key={franchise.franchiseId}>
                      <TableCell className="font-medium text-sm">
                        {franchise.franchiseName}
                      </TableCell>
                      <TableCell>
                        <RateFieldInput
                          label=""
                          fieldKey={`franchise-${franchise.franchiseId}-delivery`}
                          initialValue={franchise.deliveryRatePerKm}
                          scope={{ type: "FRANCHISE", franchiseId: franchise.franchiseId }}
                          field="delivery_rate_per_km"
                        />
                      </TableCell>
                      <TableCell>
                        <RateFieldInput
                          label=""
                          fieldKey={`franchise-${franchise.franchiseId}-payout`}
                          initialValue={franchise.riderPayoutRatePerKm}
                          scope={{ type: "FRANCHISE", franchiseId: franchise.franchiseId }}
                          field="rider_payout_rate_per_km"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              Leave franchise rates empty to inherit from Core Business rates.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
