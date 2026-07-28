"use client";

// src/shared/components/dietitian/HealthLogForm.tsx
// Feature: dietitian-management — the Health_Log capture form (design
// section 12, task 10.1).
//
// Renders `fieldSetFor(category)` field-by-field switched on `FieldKind`
// (Req 11.3, 11.4), embeds `CustomParameterEditor` (Req 12.1, 12.9) and shows
// the Closing_Comment textarea as the LAST field (Req 13.1). The log date
// defaults to the current IST date and the picker only offers the caller's
// `selectableDates` (Req 15.5, 15.6) — both computed server-side via
// `defaultLogDate`/`selectableLogDates` (`src/lib/dietitian/logDates.ts`) and
// handed in as props, so this client leaf never re-derives Eligible_Days
// itself and can never drift from the Cadence_Engine.
//
// VALIDATION: `healthLogSchemaFor(category)` — the exact schema
// `HealthLogService.submitHealthLog` re-applies server-side — drives the
// `zodResolver`, so a Dietitian sees the same out-of-range / required /
// duplicate-label messages before submitting that the server would otherwise
// return. The schema's `.transform` already accepts the loosely-typed raw
// values this form produces (plain numbers/strings for `number` fields,
// `"Yes"`/`"No"`/`""` tokens for `boolean` fields, `{ systolic, diastolic }`
// for `bp`) and turns them into the canonical `ParameterValue` shapes, so the
// values `onSubmit` receives are already normalized and can be forwarded to
// `submitHealthLog` unchanged — the server re-validates them idempotently.
//
// Requirements: 11.3, 11.4, 12.1, 12.9, 13.1, 15.5, 15.6, 15.15

import { useMemo, useState } from "react";
import { Controller, useForm, type Resolver, type SubmitHandler } from "react-hook-form";
import { toast } from "sonner";
import { format } from "date-fns";
import { CalendarIcon, Loader2, Lock } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { Calendar } from "@/shared/components/ui/calendar";

import { CustomParameterEditor } from "@/shared/components/dietitian/CustomParameterEditor";
import { BP_RANGES, fieldSetFor, type FieldDefinition } from "@/lib/dietitian/fieldSets";
import { healthLogSchemaFor } from "@/validations/healthLogSchema";
import { submitHealthLog } from "@/actions/dietitian-actions/healthLogActions";
import { parseISODateString } from "@/lib/dates/ist";
import type {
  CustomerCategory,
  CustomParameter,
  HealthLog,
  ParameterValue,
} from "@/types/dietitian";

// ─── Form-level shape ────────────────────────────────────────────────────────
//
// Deliberately loose (`parameters: Record<string, unknown>`) rather than the
// canonical `Record<string, ParameterValue>`: the raw widgets below produce
// plain strings/booleans/tokens, and `healthLogSchemaFor(category)` — not this
// component — is the single place that turns them into `ParameterValue`.

interface FormValues {
  customerProfileId: string;
  /** IST calendar date, YYYY-MM-DD. */
  logDate: string;
  /** Sparse map keyed by `FieldDefinition.key`. */
  parameters: Record<string, unknown>;
  customParameters: CustomParameter[];
  closingComment: string;
}

/**
 * Sentinel Select value standing in for "no value entered" on a `boolean`/
 * `enum` field. Radix `Select.Item` rejects an empty-string `value` (that
 * string is reserved to mean "clear the selection"), so this component uses
 * this sentinel as the Select's own value and translates it to/from `""` —
 * the value `healthLogSchemaFor` treats as blank/absent (Req 11.5) — at the
 * `Controller` boundary, never storing the sentinel in form state itself.
 */
const NOT_RECORDED_VALUE = "__not_recorded__";

export interface HealthLogFormProps {
  customerProfileId: string;
  category: CustomerCategory;
  /**
   * Eligible dates the picker may offer, ascending order (Req 15.6) —
   * `selectableLogDates()` from `src/lib/dietitian/logDates.ts`, computed by
   * the server-rendered parent.
   */
  selectableDates: string[];
  /**
   * The date to pre-select — `defaultLogDate()` from the same module
   * (Req 15.5). `null` when no date in the trailing window is selectable.
   */
  defaultLogDate: string | null;
  /**
   * Distinct Custom_Parameter labels previously used for this customer
   * (Req 12.9) — `getCustomParameterSuggestions(customerProfileId)`, fetched
   * by the server-rendered parent and passed down.
   */
  customParameterSuggestions?: string[];
  /** An existing Dietitian_Log to prefill for a same-day update, or `null` for a fresh log. */
  initialValues?: {
    parameters: Record<string, ParameterValue>;
    customParameters: CustomParameter[];
    closingComment: string;
  } | null;
  /**
   * Slot mode: when set, the log date is fixed to this value (chosen from the
   * Log_Slot selector by the parent) and the in-form calendar picker is not
   * rendered. When `undefined`, the legacy trailing-window calendar picker is
   * used instead (driven by `selectableDates`/`defaultLogDate`).
   */
  fixedLogDate?: string | null;
  /**
   * Locks the form to read-only — every control is disabled and the submit
   * button is hidden. Used for a logged slot whose same-day edit window has
   * closed (Req 18.1, 18.2).
   */
  readOnly?: boolean;
  /** Called after a successful submit (Req 15.15) — e.g. to return to the Log Customer list. */
  onSubmitted?: (healthLog: HealthLog) => void;
}

// ─── Default-value construction ──────────────────────────────────────────────

function existingToRaw(
  field: FieldDefinition,
  existing: ParameterValue | undefined,
): unknown {
  if (existing === undefined) {
    return field.kind === "bp" ? { systolic: "", diastolic: "" } : "";
  }
  switch (field.kind) {
    case "number":
      return "value" in existing && typeof existing.value === "number"
        ? String(existing.value)
        : "";
    case "boolean":
      return "value" in existing && typeof existing.value === "boolean"
        ? existing.value
          ? "Yes"
          : "No"
        : "";
    case "enum":
    case "text":
      return "value" in existing && typeof existing.value === "string" ? existing.value : "";
    case "bp":
      return "systolic" in existing
        ? { systolic: String(existing.systolic), diastolic: String(existing.diastolic) }
        : { systolic: "", diastolic: "" };
  }
}

function buildDefaultValues(props: {
  customerProfileId: string;
  logDate: string | null;
  category: CustomerCategory;
  initialValues?: HealthLogFormProps["initialValues"];
}): FormValues {
  const parameters: Record<string, unknown> = {};
  for (const field of fieldSetFor(props.category)) {
    parameters[field.key] = existingToRaw(field, props.initialValues?.parameters[field.key]);
  }

  return {
    customerProfileId: props.customerProfileId,
    logDate: props.logDate ?? "",
    parameters,
    customParameters: props.initialValues?.customParameters ?? [],
    closingComment: props.initialValues?.closingComment ?? "",
  };
}

// ─── The component ───────────────────────────────────────────────────────────

export function HealthLogForm({
  customerProfileId,
  category,
  selectableDates,
  defaultLogDate,
  customParameterSuggestions = [],
  initialValues = null,
  fixedLogDate,
  readOnly = false,
  onSubmitted,
}: HealthLogFormProps) {
  const slotMode = fixedLogDate !== undefined;
  const fields = useMemo(() => fieldSetFor(category), [category]);
  const schema = useMemo(() => healthLogSchemaFor(category), [category]);
  const selectableDateSet = useMemo(() => new Set(selectableDates), [selectableDates]);

  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const {
    control,
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<FormValues>({
    // `healthLogSchemaFor` is a `z.object(...).transform(...)` schema whose
    // declared Input (the raw, per-field-kind shape) is structurally
    // compatible with this form's looser `FormValues`, but its Output
    // (canonical `HealthLogInput`) is a different, narrower shape than the
    // form's `FieldValues`, and its `HealthLogSchema` alias does not line up
    // with any `zodResolver` overload's `Zod3Type`/`$ZodType` constraint.
    // `resolver` is therefore built by hand as a plain async function
    // delegating to the schema's own `safeParseAsync` — this runs the exact
    // same runtime validation `zodResolver` would, without fighting its
    // overload resolution for a `.transform`-ed schema. Issue paths are
    // written into a nested object (not flat dot-keys) so react-hook-form's
    // `errors.parameters?.[field.key]?.message` lookups keep working exactly
    // as they would under `zodResolver`.
    resolver: (async (values) => {
      const result = await schema.safeParseAsync(values);
      if (result.success) return { values: result.data as unknown as FormValues, errors: {} };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errors: Record<string, any> = {};
      for (const issue of result.error.issues) {
        let node = errors;
        for (let i = 0; i < issue.path.length - 1; i++) {
          const segment = String(issue.path[i]);
          node[segment] ??= {};
          node = node[segment];
        }
        const lastSegment = String(issue.path[issue.path.length - 1] ?? "root");
        node[lastSegment] ??= { type: "validation", message: issue.message };
      }
      return { values: {}, errors };
    }) as Resolver<FormValues>,
    defaultValues: buildDefaultValues({
      customerProfileId,
      logDate: slotMode ? fixedLogDate ?? null : defaultLogDate,
      category,
      initialValues,
    }),
  });

  const onSubmit: SubmitHandler<FormValues> = async (values) => {
    setServerError(null);
    clearErrors();
    setSubmitting(true);

    const result = await submitHealthLog({
      customerProfileId: values.customerProfileId,
      logDate: values.logDate,
      category,
      parameters: values.parameters,
      customParameters: values.customParameters,
      closingComment: values.closingComment,
    });

    setSubmitting(false);

    if (result.success) {
      toast.success("Health log saved.");
      onSubmitted?.(result.data);
      return;
    }

    setServerError(result.error);
    toast.error(result.error);
    if (result.fieldErrors) {
      for (const [path, message] of Object.entries(result.fieldErrors)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setError(path as any, { type: "server", message });
      }
    }
  };

  function renderField(field: FieldDefinition) {
    const name = `parameters.${field.key}`;
    const fieldError = (errors.parameters as Record<string, { message?: string }> | undefined)?.[
      field.key
    ]?.message;

    switch (field.kind) {
      case "number":
        return (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={name}>
              {field.label}
              {field.unit ? ` (${field.unit})` : ""}
            </Label>
            <Input
              id={name}
              type="number"
              min={field.min}
              max={field.max}
              step="any"
              disabled={submitting}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              {...register(name as any)}
            />
            {fieldError && <p className="text-sm text-destructive">{fieldError}</p>}
          </div>
        );

      case "boolean":
        return (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={name}>{field.label}</Label>
            <Controller
              control={control}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              name={name as any}
              render={({ field: controllerField }) => (
                <Select
                  // Radix `Select.Item` forbids an empty-string `value` (it is
                  // reserved to mean "clear the selection"), so "not recorded"
                  // is represented by the sentinel below rather than "" and
                  // translated back to "" — the value `healthLogSchemaFor`
                  // treats as blank/no-value (Req 11.5) — on every change.
                  value={((controllerField.value as string) || NOT_RECORDED_VALUE)}
                  onValueChange={(next) =>
                    controllerField.onChange(next === NOT_RECORDED_VALUE ? "" : next)
                  }
                  disabled={submitting}
                >
                  <SelectTrigger id={name} className="w-full sm:w-40">
                    <SelectValue placeholder="Not recorded" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOT_RECORDED_VALUE}>Not recorded</SelectItem>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            {fieldError && <p className="text-sm text-destructive">{fieldError}</p>}
          </div>
        );

      case "enum":
        return (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={name}>{field.label}</Label>
            <Controller
              control={control}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              name={name as any}
              render={({ field: controllerField }) => (
                <Select
                  value={((controllerField.value as string) || NOT_RECORDED_VALUE)}
                  onValueChange={(next) =>
                    controllerField.onChange(next === NOT_RECORDED_VALUE ? "" : next)
                  }
                  disabled={submitting}
                >
                  <SelectTrigger id={name} className="w-full sm:w-48">
                    <SelectValue placeholder="Not recorded" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOT_RECORDED_VALUE}>Not recorded</SelectItem>
                    {(field.options ?? []).map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {fieldError && <p className="text-sm text-destructive">{fieldError}</p>}
          </div>
        );

      case "text":
        return (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={name}>{field.label}</Label>
            <Textarea
              id={name}
              maxLength={field.maxLength}
              rows={3}
              disabled={submitting}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              {...register(name as any)}
            />
            {fieldError && <p className="text-sm text-destructive">{fieldError}</p>}
          </div>
        );

      case "bp":
        return (
          <div key={field.key} className="space-y-1.5">
            <Label>
              {field.label}
              {field.unit ? ` (${field.unit})` : ""}
            </Label>
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor={`${name}.systolic`} className="text-xs text-muted-foreground">
                  Systolic
                </Label>
                <Input
                  id={`${name}.systolic`}
                  type="number"
                  min={BP_RANGES.systolic.min}
                  max={BP_RANGES.systolic.max}
                  disabled={submitting}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  {...register(`${name}.systolic` as any)}
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label htmlFor={`${name}.diastolic`} className="text-xs text-muted-foreground">
                  Diastolic
                </Label>
                <Input
                  id={`${name}.diastolic`}
                  type="number"
                  min={BP_RANGES.diastolic.min}
                  max={BP_RANGES.diastolic.max}
                  disabled={submitting}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  {...register(`${name}.diastolic` as any)}
                />
              </div>
            </div>
            {fieldError && <p className="text-sm text-destructive">{fieldError}</p>}
          </div>
        );

      default:
        return null;
    }
  }

  if (!slotMode && selectableDates.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-input p-6 text-center text-sm text-muted-foreground">
        No eligible dates are available to log for this customer right now.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      {/* Customer_Record reference — carried through, never edited by this form. */}
      <input type="hidden" {...register("customerProfileId")} />

      {readOnly && (
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
          <Lock className="mt-0.5 size-4 shrink-0 text-slate-400" />
          <span>
            This slot was logged on an earlier day and its same-day edit window
            has closed, so it&apos;s now read-only.
          </span>
        </div>
      )}

      {/* Log date — fixed to the selected Log_Slot in slot mode (Req 15.5), or
          picked from the trailing Eligible_Days in the legacy path (Req 15.6). */}
      {slotMode ? (
        <Controller
          control={control}
          name="logDate"
          render={({ field }) => (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              <CalendarIcon className="size-4 text-primary" />
              <span className="text-muted-foreground">Log date</span>
              <span className="font-semibold text-slate-900">
                {field.value
                  ? format(parseISODateString(field.value), "dd MMM yyyy")
                  : "—"}
              </span>
            </div>
          )}
        />
      ) : (
        <div className="space-y-1.5">
          <Label>Log date</Label>
          <Controller
            control={control}
            name="logDate"
            render={({ field }) => (
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start text-left font-normal sm:w-64"
                  >
                    <CalendarIcon className="mr-2 size-4" />
                    {field.value
                      ? format(parseISODateString(field.value), "dd MMM yyyy")
                      : "Select a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={field.value ? parseISODateString(field.value) : undefined}
                    defaultMonth={field.value ? parseISODateString(field.value) : undefined}
                    onSelect={(date) => {
                      if (!date) return;
                      field.onChange(format(date, "yyyy-MM-dd"));
                      setDatePickerOpen(false);
                    }}
                    disabled={(date) => !selectableDateSet.has(format(date, "yyyy-MM-dd"))}
                  />
                </PopoverContent>
              </Popover>
            )}
          />
          {errors.logDate && <p className="text-sm text-destructive">{errors.logDate.message}</p>}
        </div>
      )}

      {/* All editable controls; a disabled fieldset makes the whole block
          read-only when the slot's edit window has closed (Req 18.1, 18.2). */}
      <fieldset disabled={readOnly} className="m-0 min-w-0 space-y-8 border-0 p-0">

      {/* Category field set, switched on FieldKind (Req 11.3, 11.4). */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-slate-900">Measurements</h3>
          <div className="h-px flex-1 bg-slate-200" />
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((field) => (
            <div
              key={field.key}
              className={
                field.kind === "text" ? "sm:col-span-2 lg:col-span-3" : undefined
              }
            >
              {renderField(field)}
            </div>
          ))}
        </div>
      </div>

      {/* Custom_Parameter editor (Req 12.1, 12.9). */}
      <Controller
        control={control}
        name="customParameters"
        render={({ field }) => (
          <CustomParameterEditor
            value={field.value}
            onChange={field.onChange}
            suggestions={customParameterSuggestions}
            error={errors.customParameters?.message as string | undefined}
            disabled={submitting}
          />
        )}
      />

      {/* Closing_Comment — the final field of every log form (Req 13.1). */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-slate-900">Closing comment</h3>
          <div className="h-px flex-1 bg-slate-200" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="closingComment" className="sr-only">
            Closing comment
          </Label>
          <Textarea
            id="closingComment"
            maxLength={2000}
            rows={4}
            placeholder="Summarize this visit for the record"
            disabled={submitting}
            {...register("closingComment")}
          />
          {errors.closingComment && (
            <p className="text-sm text-destructive">{errors.closingComment.message}</p>
          )}
        </div>
      </div>

      </fieldset>

      {serverError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {serverError}
        </p>
      )}

      {!readOnly && (
        <div className="flex flex-col-reverse gap-2 border-t pt-6 sm:flex-row sm:items-center sm:justify-end">
          <Button type="submit" disabled={submitting} className="sm:min-w-40">
            {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
            {submitting ? "Saving…" : "Save log"}
          </Button>
        </div>
      )}
    </form>
  );
}
