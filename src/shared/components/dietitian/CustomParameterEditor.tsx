"use client";

// src/shared/components/dietitian/CustomParameterEditor.tsx
// Feature: dietitian-management — Add/remove rows for a Health_Log's
// Custom_Parameter list (Req 12.1, 12.9).
//
// A fully controlled component: the parent (`HealthLogForm`, via
// react-hook-form's `Controller`) owns `value`/`onChange`. This component
// holds no Custom_Parameter state of its own — it only renders the ordered
// list of label/value/unit rows, offers previously-used labels as
// suggestions (Req 12.9) through a native `<datalist>`, and enforces the
// `MAX_CUSTOM_PARAMETERS` cap on the "Add parameter" control so a Dietitian
// cannot even attempt to exceed it from the UI (Req 12.6). The per-field
// length caps mirror `src/lib/dietitian/customParameters.ts` via `maxLength`
// so a Dietitian is stopped before typing past a bound the server would
// reject anyway (Req 12.3).
//
// Requirements: 12.1, 12.3, 12.6, 12.9

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  MAX_CUSTOM_PARAMETERS,
  CUSTOM_PARAMETER_LABEL_MAX_LENGTH,
  CUSTOM_PARAMETER_VALUE_MAX_LENGTH,
  CUSTOM_PARAMETER_UNIT_MAX_LENGTH,
} from "@/lib/dietitian/customParameters";
import type { CustomParameter } from "@/types/dietitian";

const SUGGESTIONS_DATALIST_ID = "custom-parameter-label-suggestions";

const EMPTY_ROW: CustomParameter = { label: "", value: "", unit: "" };

export interface CustomParameterEditorProps {
  /** The Health_Log's ordered Custom_Parameter list (Req 12.2, 12.8). */
  value: CustomParameter[];
  onChange: (next: CustomParameter[]) => void;
  /**
   * Distinct Custom_Parameter labels previously used for this customer
   * (Req 12.9). Fetched server-side (`getCustomParameterSuggestions`) and
   * passed down — this component never fetches on its own.
   */
  suggestions?: string[];
  /** A validation message from the last submission attempt (cap, duplicate label, empty label, etc). */
  error?: string | null;
  disabled?: boolean;
}

/**
 * Add/remove editor for the Custom_Parameter list embedded in
 * `HealthLogForm` (design section 12). Renders one row per entry with a
 * label (suggestion-enabled), value and unit input, plus a remove button; an
 * "Add parameter" button appends a blank row and disables itself at the
 * 20-entry cap.
 */
export function CustomParameterEditor({
  value,
  onChange,
  suggestions = [],
  error,
  disabled = false,
}: CustomParameterEditorProps) {
  const atCap = value.length >= MAX_CUSTOM_PARAMETERS;

  function updateRow(index: number, patch: Partial<CustomParameter>) {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    if (atCap) return;
    onChange([...value, { ...EMPTY_ROW }]);
  }

  function removeRow(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Custom parameters</Label>
        <span className="text-xs text-muted-foreground">
          {value.length}/{MAX_CUSTOM_PARAMETERS}
        </span>
      </div>

      {suggestions.length > 0 && (
        <datalist id={SUGGESTIONS_DATALIST_ID}>
          {suggestions.map((label) => (
            <option key={label} value={label} />
          ))}
        </datalist>
      )}

      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((row, index) => (
            <div
              key={index}
              className="grid grid-cols-1 gap-2 rounded-lg border border-input p-2.5 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end"
            >
              <div className="space-y-1">
                <Label
                  htmlFor={`custom-param-label-${index}`}
                  className="text-xs text-muted-foreground"
                >
                  Label
                </Label>
                <Input
                  id={`custom-param-label-${index}`}
                  list={SUGGESTIONS_DATALIST_ID}
                  value={row.label}
                  maxLength={CUSTOM_PARAMETER_LABEL_MAX_LENGTH}
                  placeholder="e.g. Mood"
                  disabled={disabled}
                  onChange={(e) => updateRow(index, { label: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor={`custom-param-value-${index}`}
                  className="text-xs text-muted-foreground"
                >
                  Value
                </Label>
                <Input
                  id={`custom-param-value-${index}`}
                  value={row.value}
                  maxLength={CUSTOM_PARAMETER_VALUE_MAX_LENGTH}
                  placeholder="e.g. Good"
                  disabled={disabled}
                  onChange={(e) => updateRow(index, { value: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor={`custom-param-unit-${index}`}
                  className="text-xs text-muted-foreground"
                >
                  Unit
                </Label>
                <Input
                  id={`custom-param-unit-${index}`}
                  value={row.unit}
                  maxLength={CUSTOM_PARAMETER_UNIT_MAX_LENGTH}
                  placeholder="optional"
                  disabled={disabled}
                  onChange={(e) => updateRow(index, { unit: e.target.value })}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove custom parameter"
                  disabled={disabled}
                  onClick={() => removeRow(index)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || atCap}
        onClick={addRow}
      >
        <Plus className="size-3.5" />
        Add parameter
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
