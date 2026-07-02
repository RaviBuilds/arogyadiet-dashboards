"use client";

// src/shared/components/admin/TempPinField.tsx
// Admin-facing Temporary PIN field with auto-generate for onboarding and reset forms.
// Provides a single-row layout: 6-digit numeric input + "Auto-generate" button.
// Requirements: 6.1, 6.2, 6.3

import { useCallback } from "react";
import { Wand2 } from "lucide-react";

import { Input } from "@/shared/components/ui/input";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import { generateTemporaryPin, isValidPinFormat } from "@/lib/pin/pinUtils";

interface TempPinFieldProps {
  /** Current value of the PIN field (controlled). */
  value: string;
  /** Called when the PIN value changes (manual entry or auto-generate). */
  onChange: (value: string) => void;
  /** External error message to display (e.g. from form validation). */
  error?: string;
  /** Disable the input and button. */
  disabled?: boolean;
  /** Label text for the field. Defaults to "Temporary PIN". */
  label?: string;
}

export function TempPinField({
  value,
  onChange,
  error,
  disabled = false,
  label = "Temporary PIN",
}: TempPinFieldProps) {
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // Allow only numeric digits, cap at 6 characters
      const raw = e.target.value.replace(/\D/g, "").slice(0, 6);
      onChange(raw);
    },
    [onChange],
  );

  const handleAutoGenerate = useCallback(() => {
    const pin = generateTemporaryPin();
    onChange(pin);
  }, [onChange]);

  // Derive inline validation: show error if value is non-empty and not a valid 6-digit PIN
  const showValidationError =
    !error && value.length > 0 && !isValidPinFormat(value);
  const displayError =
    error || (showValidationError ? "PIN must be exactly 6 digits" : undefined);

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="000000"
          value={value}
          onChange={handleInputChange}
          disabled={disabled}
          aria-label={label}
          aria-invalid={!!displayError}
          aria-describedby={displayError ? "temp-pin-error" : undefined}
          className="w-32 font-mono tracking-widest"
        />
        <Button
          type="button"
          variant="outline"
          size="default"
          onClick={handleAutoGenerate}
          disabled={disabled}
          aria-label="Auto-generate PIN"
        >
          <Wand2 data-icon="inline-start" className="size-4" />
          Auto-generate
        </Button>
      </div>
      {displayError && (
        <p id="temp-pin-error" className="text-sm text-destructive">
          {displayError}
        </p>
      )}
    </div>
  );
}
