"use client";

// src/shared/components/customer/ProfileCompletionDialog.tsx
// Customer-portal profile-completion popup (customer-mobile-onboarding, Task 10.2).
//
// Shown on the customer dashboard while the Customer_Record is IN_PROGRESS
// (the dashboard RSC decides visibility from `onboarding_status` and only
// mounts this component then — Req 9.1/9.5). It renders one input per still-
// empty completable field, all of which are OPTIONAL (Req 9.2), plus a real-
// email input WHEN the customer's current email is an admin-entered Test_Email
// (Req 10.5).
//
// Two actions:
//   "Save"                        → saveProfileCompletionAction  (persist only)
//   "Mark completed onboarding"   → markOnboardingCompletedAction (persist +
//                                    transition IN_PROGRESS → COMPLETED; valid
//                                    even with zero fields — Req 9.4)
//
// On a validation/persistence failure the entered values are retained and the
// server's per-field messages are surfaced inline (Req 9.7). Accessibility:
// Radix Dialog provides the focus trap + focus restore, and every input has an
// associated <Label> (Req 15.12).
//
// Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.7, 10.5, 15.1, 15.12

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  markOnboardingCompletedAction,
  saveProfileCompletionAction,
  type ProfileCompletionActionResult,
} from "@/actions/profileCompletionActions";
import {
  profileCompletionSchema,
  type ProfileCompletionInput,
} from "@/validations/profileCompletionSchema";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

// ---------------------------------------------------------------------------
// Field model
// ---------------------------------------------------------------------------

/** The completable `customer_profiles` fields the dialog can render. */
export type CompletableField =
  | "dateOfBirth"
  | "gender"
  | "dietaryPreference"
  | "allergies"
  | "medicalHistoryNotes";

/** All completable fields in display order (used when none is specified). */
const ALL_COMPLETABLE_FIELDS: CompletableField[] = [
  "dateOfBirth",
  "gender",
  "dietaryPreference",
  "allergies",
  "medicalHistoryNotes",
];

/** Every field the form tracks, camelCase to match the server fieldErrors keys. */
type FormValues = {
  dateOfBirth: string;
  gender: string;
  dietaryPreference: string;
  allergies: string;
  medicalHistoryNotes: string;
  email: string;
};

const EMPTY_VALUES: FormValues = {
  dateOfBirth: "",
  gender: "",
  dietaryPreference: "",
  allergies: "",
  medicalHistoryNotes: "",
  email: "",
};

interface ProfileCompletionDialogProps {
  /**
   * Which completable fields are currently empty on the Customer_Record and
   * should therefore be offered (Req 9.1). Defaults to all completable fields.
   */
  emptyFields?: CompletableField[];
  /**
   * WHERE the customer's current email is a Test_Email, offer a real-email
   * input so they can replace it (Req 10.5).
   */
  isTestEmail?: boolean;
  /** Controls the initial open state; defaults to open (mounted only when IN_PROGRESS). */
  defaultOpen?: boolean;
}

/**
 * Build the cleaned {@link ProfileCompletionInput} payload from the raw form
 * values: trim strings and drop empties so omitted fields are left unchanged on
 * the Customer_Record (every field is optional — Req 9.2/9.3).
 */
function buildPayload(values: FormValues): ProfileCompletionInput {
  const payload: Record<string, string> = {};
  const put = (key: keyof FormValues) => {
    const v = values[key]?.trim();
    if (v) payload[key] = v;
  };
  put("dateOfBirth");
  put("gender");
  put("dietaryPreference");
  put("allergies");
  put("medicalHistoryNotes");
  put("email");
  return payload as ProfileCompletionInput;
}

export function ProfileCompletionDialog({
  emptyFields = ALL_COMPLETABLE_FIELDS,
  isTestEmail = false,
  defaultOpen = true,
}: ProfileCompletionDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [submitting, setSubmitting] = useState<null | "save" | "complete">(null);

  const {
    control,
    register,
    handleSubmit,
    getValues,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: EMPTY_VALUES, mode: "onSubmit" });

  const fieldsToRender = emptyFields.filter((f) =>
    ALL_COMPLETABLE_FIELDS.includes(f),
  );

  /** Apply an action result: on success close/refresh, on failure flag fields. */
  function applyResult(
    result: ProfileCompletionActionResult,
    intent: "save" | "complete",
  ): boolean {
    if ("error" in result) {
      // Retain entered values and surface per-field messages (Req 9.7/10.7/10.8).
      if (result.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          setError(field as keyof FormValues, { type: "server", message });
        }
      }
      toast.error(result.error);
      return false;
    }

    if (intent === "complete") {
      toast.success("Onboarding completed.");
      setOpen(false);
    } else {
      toast.success("Your details were saved.");
    }
    // Reflect persisted changes (fewer empty fields / COMPLETED status).
    router.refresh();
    return true;
  }

  /** Client-side format validation mirroring the server schema (Req 9.7). */
  function validateLocally(payload: ProfileCompletionInput): boolean {
    const parsed = profileCompletionSchema.safeParse(payload);
    if (parsed.success) return true;
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") {
        setError(key as keyof FormValues, {
          type: "validation",
          message: issue.message,
        });
      }
    }
    return false;
  }

  async function runSubmit(intent: "save" | "complete") {
    clearErrors();
    const payload = buildPayload(getValues());
    if (!validateLocally(payload)) {
      return;
    }
    setSubmitting(intent);
    try {
      const result =
        intent === "complete"
          ? await markOnboardingCompletedAction(payload)
          : await saveProfileCompletionAction(payload);
      applyResult(result, intent);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(null);
    }
  }

  const isBusy = submitting !== null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Complete your profile</DialogTitle>
          <DialogDescription>
            Add a few more details to finish setting up your account. Every field
            is optional — you can fill them in now or later.
          </DialogDescription>
        </DialogHeader>

        {/* handleSubmit gates on RHF's own state; our buttons call runSubmit
            directly with an explicit intent so "Save" and "Mark completed"
            share the same form values. */}
        <form
          className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-0.5"
          onSubmit={handleSubmit(() => runSubmit("save"))}
        >
          {fieldsToRender.includes("dateOfBirth") && (
            <Field data-invalid={!!errors.dateOfBirth}>
              <FieldLabel htmlFor="pcd-dateOfBirth">Date of birth</FieldLabel>
              <Input
                id="pcd-dateOfBirth"
                type="date"
                disabled={isBusy}
                aria-invalid={!!errors.dateOfBirth}
                {...register("dateOfBirth")}
              />
              <FieldError errors={errors.dateOfBirth ? [errors.dateOfBirth] : []} />
            </Field>
          )}

          {fieldsToRender.includes("gender") && (
            <Field data-invalid={!!errors.gender}>
              <FieldLabel htmlFor="pcd-gender">Gender</FieldLabel>
              <Controller
                control={control}
                name="gender"
                render={({ field }) => (
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                    disabled={isBusy}
                  >
                    <SelectTrigger
                      id="pcd-gender"
                      className="w-full"
                      aria-invalid={!!errors.gender}
                    >
                      <SelectValue placeholder="Select gender" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError errors={errors.gender ? [errors.gender] : []} />
            </Field>
          )}

          {fieldsToRender.includes("dietaryPreference") && (
            <Field data-invalid={!!errors.dietaryPreference}>
              <FieldLabel htmlFor="pcd-dietaryPreference">
                Diet preference
              </FieldLabel>
              <Controller
                control={control}
                name="dietaryPreference"
                render={({ field }) => (
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                    disabled={isBusy}
                  >
                    <SelectTrigger
                      id="pcd-dietaryPreference"
                      className="w-full"
                      aria-invalid={!!errors.dietaryPreference}
                    >
                      <SelectValue placeholder="Select diet preference" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Veg">Veg</SelectItem>
                      <SelectItem value="Non-Veg">Non-Veg</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError
                errors={errors.dietaryPreference ? [errors.dietaryPreference] : []}
              />
            </Field>
          )}

          {fieldsToRender.includes("allergies") && (
            <Field data-invalid={!!errors.allergies}>
              <FieldLabel htmlFor="pcd-allergies">Allergies</FieldLabel>
              <Textarea
                id="pcd-allergies"
                placeholder="Any food allergies we should know about?"
                disabled={isBusy}
                aria-invalid={!!errors.allergies}
                {...register("allergies")}
              />
              <FieldError errors={errors.allergies ? [errors.allergies] : []} />
            </Field>
          )}

          {fieldsToRender.includes("medicalHistoryNotes") && (
            <Field data-invalid={!!errors.medicalHistoryNotes}>
              <FieldLabel htmlFor="pcd-medicalHistoryNotes">
                Medical history notes
              </FieldLabel>
              <Textarea
                id="pcd-medicalHistoryNotes"
                placeholder="Any medical conditions or dietary restrictions?"
                disabled={isBusy}
                aria-invalid={!!errors.medicalHistoryNotes}
                {...register("medicalHistoryNotes")}
              />
              <FieldError
                errors={
                  errors.medicalHistoryNotes ? [errors.medicalHistoryNotes] : []
                }
              />
            </Field>
          )}

          {/* Real email input, only when the current email is a Test_Email (Req 10.5). */}
          {isTestEmail && (
            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="pcd-email">Email address</FieldLabel>
              <Input
                id="pcd-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                disabled={isBusy}
                aria-invalid={!!errors.email}
                {...register("email")}
              />
              <FieldError errors={errors.email ? [errors.email] : []} />
            </Field>
          )}
        </form>

        <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => runSubmit("save")}
            disabled={isBusy}
          >
            {submitting === "save" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </Button>
          <Button
            type="button"
            onClick={() => runSubmit("complete")}
            disabled={isBusy}
          >
            {submitting === "complete" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Completing...
              </>
            ) : (
              "Mark completed onboarding"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
