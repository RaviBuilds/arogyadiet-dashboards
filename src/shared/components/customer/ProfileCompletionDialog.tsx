"use client";

// src/shared/components/customer/ProfileCompletionDialog.tsx
// Customer-portal profile-completion popup (customer-mobile-onboarding, Task 10.2;
// extended for accommodation customers in Task 10.1 of accommodation-customer-flow).
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
// --- Accommodation customers (customerCategory === "ACCOMMODATION") ---
// For accommodation customers, medical history is MANDATORY rather than
// optional (Req 6.1-6.9):
//   - The subscription section shows stay type/occupancy/dates instead of the
//     Meal/KIT subscription block (Req 6.1).
//   - A confirmation checkbox is shown alongside the medical history textarea;
//     checking it clears + disables the textarea, unchecking re-enables it
//     (Req 6.2, 6.4, 6.9).
//   - "Mark complete onboarding" stays disabled until the textarea has at
//     least 1 non-whitespace character OR the checkbox is checked (Req 6.3).
//   - A document upload control accepts images/PDF, max 5 files, max 10MB
//     each (Req 6.5).
//   - The "Skip for now" button is removed — the dialog's built-in top-right
//     X close button (from the Dialog primitive) is used instead, and closing
//     without completing simply re-displays the popup on the next /dashboard
//     visit since nothing is persisted (Req 6.6, 6.8).
//
// Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.7, 10.5, 15.1, 15.12,
//               6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { format, parseISO } from "date-fns";
import {
  Loader2,
  Utensils,
  Calendar,
  BedDouble,
  Users,
  UploadCloud,
  FileText,
  X as RemoveFileIcon,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

import {
  markOnboardingCompletedAction,
  saveProfileCompletionAction,
  type ProfileCompletionActionResult,
} from "@/actions/profileCompletionActions";
import {
  completeAccommodationProfileAction,
  type ProfileCompletionActionResult as AccommodationProfileCompletionActionResult,
} from "@/actions/accommodationOnboardingActions";
import {
  profileCompletionSchema,
  type ProfileCompletionInput,
} from "@/validations/profileCompletionSchema";
import { createClient } from "@/lib/supabase/client";
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
import { Checkbox } from "@/shared/components/ui/checkbox";
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
  medicalHistoryConfirmed: boolean;
  email: string;
};

const EMPTY_VALUES: FormValues = {
  dateOfBirth: "",
  gender: "",
  dietaryPreference: "",
  allergies: "",
  medicalHistoryNotes: "",
  medicalHistoryConfirmed: false,
  email: "",
};

// ---------------------------------------------------------------------------
// Accommodation document-upload constraints (Req 6.5)
// ---------------------------------------------------------------------------

const MAX_MEDICAL_DOCUMENT_FILES = 5;
const MAX_MEDICAL_DOCUMENT_SIZE_MB = 10;
const MAX_MEDICAL_DOCUMENT_SIZE_BYTES =
  MAX_MEDICAL_DOCUMENT_SIZE_MB * 1024 * 1024;

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
  /**
   * Optional subscription details to display at the top of the dialog.
   * Ignored for accommodation customers, which render `accommodationStay`
   * instead (Req 6.1).
   */
  subscription?: {
    category: string | null;
    planName: string | null;
    startDate: string | null;
    endDate: string | null;
  } | null;
  /**
   * The customer's category. When "ACCOMMODATION", the dialog renders the
   * accommodation-specific subscription section and makes medical history
   * mandatory (Req 6.1-6.9).
   */
  customerCategory?: string | null;
  /** Active/pending stay details shown for accommodation customers (Req 6.1). */
  accommodationStay?: {
    stayType: string;
    occupancyType: string;
    startDate: string | null;
    endDate: string | null;
  } | null;
  /**
   * The customer's `customer_profiles.id`. Required to persist medical
   * history via `completeAccommodationProfileAction` for accommodation
   * customers.
   */
  customerProfileId?: string | null;
}

/**
 * Build the cleaned {@link ProfileCompletionInput} payload from the raw form
 * values: trim strings and drop empties so omitted fields are left unchanged on
 * the Customer_Record (every field is optional — Req 9.2/9.3).
 */
function buildPayload(values: FormValues): ProfileCompletionInput {
  const payload: Record<string, string> = {};
  const put = (key: keyof FormValues) => {
    const v = values[key];
    const trimmed = typeof v === "string" ? v.trim() : "";
    if (trimmed) payload[key] = trimmed;
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
  subscription = null,
  customerCategory = null,
  accommodationStay = null,
  customerProfileId = null,
}: ProfileCompletionDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [submitting, setSubmitting] = useState<null | "save" | "complete">(null);

  // Accommodation-only: selected medical documents pending upload (Req 6.5).
  const [medicalDocuments, setMedicalDocuments] = useState<File[]>([]);
  const [documentError, setDocumentError] = useState<string | null>(null);

  const isAccommodation = customerCategory === "ACCOMMODATION";

  const {
    control,
    register,
    handleSubmit,
    getValues,
    watch,
    setValue,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: EMPTY_VALUES, mode: "onSubmit" });

  const fieldsToRender = emptyFields.filter((f) =>
    ALL_COMPLETABLE_FIELDS.includes(f),
  );
  // Medical history is mandatory for accommodation customers, so always show
  // it regardless of whether it was already empty (Req 6.2).
  if (isAccommodation && !fieldsToRender.includes("medicalHistoryNotes")) {
    fieldsToRender.push("medicalHistoryNotes");
  }

  // Live values used to drive the mutual-exclusion + button-enablement rules.
  const medicalHistoryNotesValue = watch("medicalHistoryNotes");
  const medicalHistoryConfirmed = watch("medicalHistoryConfirmed");

  /**
   * Req 6.3: enabled iff the textarea has ≥1 non-whitespace char OR the
   * confirmation checkbox is checked. Implemented inline (rather than
   * importing `AccommodationService.isProfileComplete`) because that module
   * also pulls in the server-only `stayRepository` and cannot be bundled into
   * a client component.
   */
  const accommodationProfileComplete =
    medicalHistoryConfirmed ||
    (medicalHistoryNotesValue?.trim().length ?? 0) > 0;

  /** Req 6.4/6.9: mutual exclusion between the checkbox and the textarea. */
  function handleMedicalHistoryConfirmedChange(checked: boolean) {
    setValue("medicalHistoryConfirmed", checked);
    if (checked) {
      setValue("medicalHistoryNotes", "");
    }
  }

  function handleDocumentSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setDocumentError(null);
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    if (medicalDocuments.length + files.length > MAX_MEDICAL_DOCUMENT_FILES) {
      setDocumentError(
        `You can upload a maximum of ${MAX_MEDICAL_DOCUMENT_FILES} documents.`,
      );
      e.target.value = "";
      return;
    }

    const validFiles: File[] = [];
    for (const file of files) {
      const isAccepted =
        file.type.startsWith("image/") || file.type === "application/pdf";
      if (!isAccepted) {
        setDocumentError(`${file.name} must be an image or PDF file.`);
        continue;
      }
      if (file.size > MAX_MEDICAL_DOCUMENT_SIZE_BYTES) {
        setDocumentError(
          `${file.name} exceeds the ${MAX_MEDICAL_DOCUMENT_SIZE_MB}MB limit.`,
        );
        continue;
      }
      validFiles.push(file);
    }

    setMedicalDocuments((prev) => [...prev, ...validFiles]);
    e.target.value = "";
  }

  function removeDocument(index: number) {
    setMedicalDocuments((prev) => prev.filter((_, i) => i !== index));
    setDocumentError(null);
  }

  /**
   * Uploads the selected medical documents to the private `medical_records`
   * storage bucket, mirroring the pattern in `medical-document-upload-modal.tsx`.
   * Returns the document references to persist on `customer_profiles.medical_documents`.
   */
  async function uploadMedicalDocuments(): Promise<
    Array<{ name: string; url: string; type: string }>
  > {
    if (medicalDocuments.length === 0) return [];

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("Unauthorized.");
    }

    const uploaded: Array<{ name: string; url: string; type: string }> = [];
    for (const file of medicalDocuments) {
      const fileExt = file.name.split(".").pop();
      const safeFileName = `${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
      const filePath = `${user.id}/${safeFileName}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("medical_records")
        .upload(filePath, file, { cacheControl: "3600", upsert: false });
      if (uploadError) {
        throw new Error(uploadError.message);
      }

      uploaded.push({
        name: file.name,
        url: uploadData.path,
        type: file.type,
      });
    }
    return uploaded;
  }

  /** Apply an action result: on success close/refresh, on failure flag fields. */
  function applyResult(
    result: ProfileCompletionActionResult | AccommodationProfileCompletionActionResult,
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

  /** Accommodation-specific completion: mandatory medical history + documents. */
  async function runAccommodationComplete() {
    clearErrors();
    if (!customerProfileId) {
      toast.error("Unable to complete onboarding: missing customer reference.");
      return;
    }

    setSubmitting("complete");
    try {
      const uploadedDocuments = await uploadMedicalDocuments();
      const values = getValues();
      const result = await completeAccommodationProfileAction({
        customerProfileId,
        medicalHistoryNotes: values.medicalHistoryNotes,
        medicalHistoryConfirmed: values.medicalHistoryConfirmed,
        medicalDocuments: uploadedDocuments,
      });
      const success = applyResult(result, "complete");
      if (success) {
        router.push("/profile#medical-documents");
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setSubmitting(null);
    }
  }

  async function runSubmit(intent: "save" | "complete") {
    if (isAccommodation && intent === "complete") {
      return runAccommodationComplete();
    }

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
      const success = applyResult(result, intent);

      // Redirect to profile page medical documents section after completion
      if (success && intent === "complete") {
        router.push("/profile#medical-documents");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(null);
    }
  }

  const isBusy = submitting !== null;

  const formatSubscriptionDate = (dateStr: string | null): string => {
    if (!dateStr) return "N/A";
    try {
      return format(parseISO(dateStr), "MMM dd, yyyy");
    } catch {
      return "N/A";
    }
  };

  const getCategoryLabel = (category: string | null): string => {
    if (!category) return "N/A";
    const labels: Record<string, string> = {
      MEAL: "Meal Subscription",
      KIT: "Kit Subscription",
      ACCOMMODATION: "Accommodation Subscription",
    };
    return labels[category] || category;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Complete your profile</DialogTitle>
          <DialogDescription>
            {isAccommodation
              ? "Add a few more details to finish setting up your account. Medical history is required before you can complete onboarding."
              : "Add a few more details to finish setting up your account. Every field is optional — you can fill them in now or later."}
          </DialogDescription>
        </DialogHeader>

        {/* Subscription / Accommodation stay details section (Req 6.1) */}
        {isAccommodation && accommodationStay ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <div className="rounded-full bg-emerald-100 p-1.5">
                <BedDouble className="h-4 w-4 text-emerald-600" />
              </div>
              <h4 className="text-sm font-semibold text-slate-900">
                Your Stay
              </h4>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Stay Type:</span>
                <span className="font-medium text-slate-900">
                  {accommodationStay.stayType || "N/A"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Occupancy:</span>
                <div className="flex items-center gap-1.5 text-right">
                  <Users className="h-3.5 w-3.5 text-slate-400" />
                  <span className="font-medium text-slate-900">
                    {accommodationStay.occupancyType || "N/A"}
                  </span>
                </div>
              </div>
              <div className="flex items-start justify-between">
                <span className="text-slate-500">Duration:</span>
                <div className="flex items-center gap-1.5 text-right">
                  <Calendar className="h-3.5 w-3.5 text-slate-400" />
                  <span className="font-medium text-slate-900">
                    {formatSubscriptionDate(accommodationStay.startDate)}
                    {" → "}
                    {formatSubscriptionDate(accommodationStay.endDate)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          !isAccommodation &&
          subscription && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <div className="rounded-full bg-emerald-100 p-1.5">
                  <Utensils className="h-4 w-4 text-emerald-600" />
                </div>
                <h4 className="text-sm font-semibold text-slate-900">
                  Your Subscription
                </h4>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Service:</span>
                  <span className="font-medium text-slate-900">
                    {getCategoryLabel(subscription.category)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Plan:</span>
                  <span className="font-medium text-slate-900">
                    {subscription.planName || "N/A"}
                  </span>
                </div>
                <div className="flex items-start justify-between">
                  <span className="text-slate-500">Duration:</span>
                  <div className="flex items-center gap-1.5 text-right">
                    <Calendar className="h-3.5 w-3.5 text-slate-400" />
                    <span className="font-medium text-slate-900">
                      {formatSubscriptionDate(subscription.startDate)}
                      {" → "}
                      {formatSubscriptionDate(subscription.endDate)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )
        )}

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
                disabled={isBusy || (isAccommodation && medicalHistoryConfirmed)}
                maxLength={2000}
                aria-invalid={!!errors.medicalHistoryNotes}
                {...register("medicalHistoryNotes")}
              />
              <FieldError
                errors={
                  errors.medicalHistoryNotes ? [errors.medicalHistoryNotes] : []
                }
              />

              {/* Req 6.2/6.4/6.9: mandatory confirmation checkbox with mutual
                  exclusion against the textarea, accommodation customers only. */}
              {isAccommodation && (
                <Controller
                  control={control}
                  name="medicalHistoryConfirmed"
                  render={({ field }) => (
                    <label className="mt-2 flex items-start gap-2 text-sm text-slate-700">
                      <Checkbox
                        id="pcd-medicalHistoryConfirmed"
                        checked={field.value}
                        disabled={isBusy}
                        onCheckedChange={(checked) =>
                          handleMedicalHistoryConfirmedChange(checked === true)
                        }
                      />
                      <span>
                        I confirm I don&apos;t have any medical history to
                        share with ArogyaDiet
                      </span>
                    </label>
                  )}
                />
              )}

              {/* Req 6.5: document upload, accommodation customers only. */}
              {isAccommodation && (
                <div className="mt-3 space-y-2">
                  <FieldLabel htmlFor="pcd-medicalDocuments">
                    Medical documents (optional)
                  </FieldLabel>
                  <div className="relative rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 p-4 text-center transition-colors hover:bg-slate-100">
                    <input
                      id="pcd-medicalDocuments"
                      type="file"
                      multiple
                      accept="image/*,application/pdf"
                      onChange={handleDocumentSelect}
                      disabled={
                        isBusy ||
                        medicalDocuments.length >= MAX_MEDICAL_DOCUMENT_FILES
                      }
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                    />
                    <UploadCloud className="mx-auto mb-2 h-6 w-6 text-slate-400" />
                    <p className="text-xs font-medium text-slate-600">
                      Click to upload images or PDFs (max{" "}
                      {MAX_MEDICAL_DOCUMENT_FILES} files,{" "}
                      {MAX_MEDICAL_DOCUMENT_SIZE_MB}MB each)
                    </p>
                  </div>

                  {documentError && (
                    <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
                      <p className="text-xs font-medium text-red-800">
                        {documentError}
                      </p>
                    </div>
                  )}

                  {medicalDocuments.length > 0 && (
                    <div className="space-y-1.5">
                      {medicalDocuments.map((file, index) => (
                        <div
                          key={`${file.name}-${index}`}
                          className="flex items-center justify-between rounded-md border bg-white p-2 shadow-sm"
                        >
                          <div className="flex items-center gap-2 overflow-hidden">
                            <FileText className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                            <span className="truncate text-xs font-medium text-slate-900">
                              {file.name}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeDocument(index)}
                            disabled={isBusy}
                            className="rounded p-0.5 text-slate-400 hover:text-red-600 disabled:opacity-50"
                          >
                            <RemoveFileIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
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
          {/* Req 6.6: accommodation customers rely on the Dialog's built-in
              top-right X close button instead of "Skip for now". */}
          {!isAccommodation && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isBusy}
              className="min-h-11"
            >
              Skip for now
            </Button>
          )}
          <Button
            type="button"
            onClick={() => runSubmit("complete")}
            disabled={isBusy || (isAccommodation && !accommodationProfileComplete)}
            className="min-h-11"
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
