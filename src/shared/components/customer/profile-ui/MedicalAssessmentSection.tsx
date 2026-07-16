"use client";

import { format } from "date-fns";
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { UseFormReturn } from "react-hook-form";
import type { ProfileFormValues } from "@/validations/profileSchema";
import { MedicalDocumentUploadModal } from "../medical-document-upload-modal";
import { SectionCard } from "./SectionCard";
import { StatusPill } from "./StatusPill";
import { InfoRow } from "./InfoRow";

type MedicalDocument = {
  id: string;
  file_name: string;
  file_size_bytes: number;
  uploaded_at: string;
  signedUrl?: string | null;
};

/**
 * MedicalAssessmentSection — extracted from profile-form.tsx per the
 * profile redesign. Its own tinted SectionCard so it visually communicates
 * "we ask this because your health matters" rather than sitting as another
 * form block below a dashed divider.
 */
export function MedicalAssessmentSection({
  form,
  isEditing,
  customerProfileId,
  initialDocuments,
}: {
  form: UseFormReturn<ProfileFormValues>;
  isEditing: boolean;
  customerProfileId: string;
  initialDocuments: MedicalDocument[];
}) {
  const hasMedicalHistory = form.watch("has_medical_history");
  const noHistoryConfirmed = form.watch("no_medical_history_confirmed");
  const watchedNotes = form.watch("medical_history_notes");
  const watchedAllergies = form.watch("allergies");

  return (
    <SectionCard
      icon={ShieldCheck}
      iconTone="green"
      tinted
      title="Medical Assessment"
      description="This helps our chefs plan and prepare your meals safely."
    >
      <div className="space-y-6">
        <div className="space-y-1.5">
          <Label
            className={cn(
              "text-xs font-medium uppercase tracking-wider",
              form.formState.errors.allergies
                ? "text-red-500"
                : "text-slate-500",
            )}
          >
            Allergies or Special Instructions *
          </Label>
          {isEditing ? (
            <Textarea
              {...form.register("allergies")}
              placeholder="Type your allergies or write 'None'"
              className={cn(
                "min-h-[80px] resize-none bg-white",
                form.formState.errors.allergies && "border-red-500",
              )}
            />
          ) : (
            <InfoRow label="Allergies or Special Instructions" value={watchedAllergies} />
          )}
          {form.formState.errors.allergies && (
            <p className="text-[11px] font-medium text-red-500">
              {form.formState.errors.allergies.message}
            </p>
          )}
        </div>

        {/* Grouped as its own card so the toggle + its resulting state read
            as one coherent unit rather than floating between the fields
            above and below it. */}
        <div className="space-y-4 rounded-2xl border border-emerald-900/10 bg-white/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <Label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Stethoscope className="h-4 w-4 text-slate-500" />
              I have medical history or documents to share
            </Label>
            <Switch
              checked={hasMedicalHistory}
              disabled={!isEditing || initialDocuments.length > 0}
              onCheckedChange={(checked) => {
                form.setValue("has_medical_history", checked, {
                  shouldValidate: true,
                  shouldDirty: true,
                });
                if (checked) form.setValue("no_medical_history_confirmed", false);
              }}
            />
          </div>

        {hasMedicalHistory ? (
          <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
            {isEditing ? (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Medical History Notes
                </Label>
                <Textarea
                  {...form.register("medical_history_notes")}
                  placeholder="Describe any past conditions, surgeries, or treatments..."
                  className="min-h-[100px] resize-none bg-white"
                />
              </div>
            ) : (
              <InfoRow
                label="Medical History Notes"
                value={watchedNotes || "Notes pending"}
              />
            )}

            <div className="pt-1">
              <MedicalDocumentUploadModal customerProfileId={customerProfileId} />
            </div>
          </div>
        ) : (
          <div className="animate-in fade-in">
            {noHistoryConfirmed ? (
              <StatusPill icon={CheckCircle2} tone="green" className="py-1.5">
                No medical history on file
              </StatusPill>
            ) : (
              <>
                {!isEditing && (
                  <p className="mb-2 text-xs italic text-muted-foreground">
                    Click &quot;Edit Profile&quot; to confirm your medical history.
                  </p>
                )}
                <div
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-4",
                    form.formState.errors.no_medical_history_confirmed
                      ? "border-red-200 bg-red-50"
                      : "border-emerald-900/10 bg-white/70",
                  )}
                >
                  <Checkbox
                    id="confirm_no_history"
                    disabled={!isEditing}
                    checked={form.watch("no_medical_history_confirmed")}
                    onCheckedChange={(checked) =>
                      form.setValue(
                        "no_medical_history_confirmed",
                        checked as boolean,
                        { shouldValidate: true, shouldDirty: true },
                      )
                    }
                    className="mt-0.5"
                  />
                  <div className="grid gap-1 leading-none">
                    <Label
                      htmlFor="confirm_no_history"
                      className="text-sm font-semibold text-slate-800"
                    >
                      I confirm I have no medical history
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      No underlying conditions, surgeries, or doctor
                      instructions ArogyaDiet should be aware of.
                    </p>
                  </div>
                </div>
                {form.formState.errors.no_medical_history_confirmed && (
                  <p className="ml-1 mt-2 text-[11px] font-medium text-red-500">
                    {form.formState.errors.no_medical_history_confirmed.message}
                  </p>
                )}
              </>
            )}
          </div>
        )}
        </div>

        {initialDocuments.length > 0 && (
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <Label className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Uploaded Documents ({initialDocuments.length})
            </Label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {initialDocuments.map((doc) => {
                const isPdf = doc.file_name.toLowerCase().endsWith(".pdf");
                return (
                  <div
                    key={doc.id}
                    className="group relative flex items-center gap-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-3"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border bg-white">
                      {isPdf ? (
                        <FileText className="h-6 w-6 text-red-500" />
                      ) : doc.signedUrl ? (
                        <img
                          src={doc.signedUrl}
                          alt={doc.file_name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <ImageIcon className="h-6 w-6 text-slate-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 pr-6">
                      <p className="truncate text-xs font-semibold text-slate-900">
                        {doc.file_name}
                      </p>
                      <p className="text-[10px] font-medium text-slate-500">
                        {(doc.file_size_bytes / 1024 / 1024).toFixed(2)} MB •{" "}
                        {format(new Date(doc.uploaded_at), "MMM d")}
                      </p>
                    </div>
                    {doc.signedUrl && (
                      <a
                        href={doc.signedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="absolute right-3 top-3 rounded border bg-white p-1.5 text-slate-400 opacity-0 shadow-sm transition-all duration-200 hover:text-blue-600 group-hover:opacity-100"
                        title="View Document"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
