"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { profileSchema, ProfileFormValues } from "@/validations/profileSchema";
import { updateProfileAction } from "@/actions/profileActions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CalendarIcon,
  CheckCircle2,
  AlertCircle,
  Pencil,
  X,
  User,
  Phone,
  Mail,
  Calendar as CalendarDays,
  Info,
  Stethoscope,
  ShieldAlert,
  ExternalLink,
  Image as ImageIcon,
  FileText, // <-- ADDED THESE
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { dispatchNotificationsRefresh } from "@/lib/notifications/refresh";
import { MedicalDocumentUploadModal } from "./medical-document-upload-modal";

interface ProfileFormProps {
  initialData: ProfileFormValues & { id: string }; // id is required for the upload modal
  initialDocuments: any[]; // <-- ADDED THIS
}

export function ProfileForm({
  initialData,
  initialDocuments,
}: ProfileFormProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      ...initialData,
      no_medical_history_confirmed: !initialData.has_medical_history,
    },
  });



  useEffect(() => {
    form.reset(
      {
        ...initialData,
        no_medical_history_confirmed: !initialData.has_medical_history,
      },
      { keepDirtyValues: true },
    );
  }, [initialData, form]);

  const watchedValues = form.watch();
  const hasMedicalHistory = form.watch("has_medical_history");

async function onSubmit(data: ProfileFormValues) {
  setIsPending(true);

  // --- NEW: Custom Validation for Medical History ---
  if (data.has_medical_history) {
    const hasNotes =
      data.medical_history_notes &&
      data.medical_history_notes.trim().length > 0;
    const hasDocs = initialDocuments && initialDocuments.length > 0;

    if (!hasNotes && !hasDocs) {
      setIsPending(false);
      toast.error(
        "Please provide medical notes or upload documents. Otherwise, turn OFF the medical assessment toggle.",
      );
      return; // Stop submission
    }
  } else {
    // Clean up notes if they toggled it off before saving
    data.medical_history_notes = "";
  }
  // ------------------------------------------------

  const result = await updateProfileAction(data);

  setIsPending(false);

  if (result?.error) {
    toast.error(result.error);
    return;
  }

  toast.success("Profile updated successfully!");
  dispatchNotificationsRefresh();
  setIsEditing(false);
  router.refresh();
}
 
  const toggleEdit = () => {
    if (isEditing) form.reset(initialData);
    setIsEditing(!isEditing);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between border-b border-slate-200 pb-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            Personal Details
          </h2>
          <p className="text-sm text-slate-500">
            Manage your profile and dietary preferences.
          </p>
        </div>

        <Button
          variant={isEditing ? "ghost" : "outline"}
          size="sm"
          onClick={toggleEdit}
          className={cn(
            "gap-2 transition-all duration-200",
            isEditing
              ? "text-slate-500 hover:text-slate-700"
              : "border-primary text-primary hover:bg-primary/5",
          )}
        >
          {isEditing ? (
            <>
              <X className="h-4 w-4" /> Cancel
            </>
          ) : (
            <>
              <Pencil className="h-4 w-4" /> Edit Profile
            </>
          )}
        </Button>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {/* Form Level Error for missed mandatory fields */}
        {Object.keys(form.formState.errors).length > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3">
            <AlertCircle className="h-4 w-4 text-red-600 mt-0.5" />
            <p className="text-sm font-medium text-red-800">
              Please fill all mandatory fields marked in red below.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-x-12 gap-y-6 md:grid-cols-2 md:gap-y-8">
          {/* Full Name */}
          <div className="space-y-2">
            <Label
              className={cn(
                "text-xs font-medium uppercase tracking-wider",
                form.formState.errors.full_name
                  ? "text-red-500"
                  : "text-slate-500",
              )}
            >
              Full Name *
            </Label>
            {isEditing ? (
              <Input
                {...form.register("full_name")}
                className={cn(
                  "h-11",
                  form.formState.errors.full_name && "border-red-500",
                )}
              />
            ) : (
              <div className="flex h-11 items-center gap-3 rounded-lg bg-slate-50/80 px-3 py-2.5 font-medium text-slate-900">
                <User className="h-4 w-4 text-slate-400" />{" "}
                {watchedValues.full_name || "Not provided"}
              </div>
            )}
            {form.formState.errors.full_name && (
              <p className="text-[11px] font-medium text-red-500">
                {form.formState.errors.full_name.message}
              </p>
            )}
          </div>

          {/* Email (Read Only) */}
          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Email Address
            </Label>
            <div className="flex h-11 items-center gap-3 rounded-lg bg-slate-50/80 px-3 py-2.5 italic text-slate-500">
              <Mail className="h-4 w-4 text-slate-400" /> {watchedValues.email}
            </div>
          </div>

          {/* Mobile */}
          <div className="space-y-2">
            <Label
              className={cn(
                "text-xs font-medium uppercase tracking-wider",
                form.formState.errors.phone
                  ? "text-red-500"
                  : "text-slate-500",
              )}
            >
              Mobile Number *
            </Label>
            {isEditing ? (
              <Input
                {...form.register("phone")}
                className={cn(
                  "h-11",
                  form.formState.errors.phone && "border-red-500",
                )}
              />
            ) : (
              <div className="flex h-11 items-center gap-3 rounded-lg bg-slate-50/80 px-3 py-2.5 font-medium text-slate-900">
                <Phone className="h-4 w-4 text-slate-400" />{" "}
                {watchedValues.phone || "Not provided"}
              </div>
            )}
            {form.formState.errors.phone && (
              <p className="text-[11px] font-medium text-red-500">
                {form.formState.errors.phone.message}
              </p>
            )}
          </div>

          {/* Gender */}
          <div className="space-y-2">
            <Label
              className={cn(
                "text-xs font-medium uppercase tracking-wider",
                form.formState.errors.gender
                  ? "text-red-500"
                  : "text-slate-500",
              )}
            >
              Gender *
            </Label>
            {isEditing ? (
              <Select
                value={form.watch("gender")}
                onValueChange={(value) =>
                  form.setValue("gender", value as any, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
              >
                <SelectTrigger
                  className={cn(
                    "h-11",
                    form.formState.errors.gender && "border-red-500",
                  )}
                >
                  <SelectValue placeholder="Select Gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="flex h-11 items-center gap-3 rounded-lg bg-slate-50/80 px-3 py-2.5">
                <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-tight text-slate-600">
                  {watchedValues.gender || "Not Selected"}
                </span>
              </div>
            )}
            {form.formState.errors.gender && (
              <p className="text-[11px] font-medium text-red-500">
                {form.formState.errors.gender.message}
              </p>
            )}
          </div>

          {/* Date of Birth */}
          <div className="space-y-2 flex flex-col">
            <Label
              className={cn(
                "mb-1 text-xs font-medium uppercase tracking-wider",
                form.formState.errors.date_of_birth
                  ? "text-red-500"
                  : "text-slate-500",
              )}
            >
              Date of Birth *
            </Label>
            {isEditing ? (
              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "h-11 justify-start text-left font-normal",
                      form.formState.errors.date_of_birth && "border-red-500",
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {watchedValues.date_of_birth
                      ? format(new Date(watchedValues.date_of_birth), "PPP")
                      : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    captionLayout="dropdown"
                    fromYear={1940}
                    toYear={new Date().getFullYear()}
                    selected={
                      watchedValues.date_of_birth
                        ? new Date(watchedValues.date_of_birth)
                        : undefined
                    }
                    onSelect={(date) => {
                      form.setValue(
                        "date_of_birth",
                        date ? date.toISOString() : "",
                        { shouldValidate: true, shouldDirty: true },
                      );
                      setIsCalendarOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            ) : (
              <div className="flex h-11 items-center gap-3 rounded-lg bg-slate-50/80 px-3 py-2.5 font-medium text-slate-900">
                <CalendarDays className="h-4 w-4 text-slate-400" />
                {watchedValues.date_of_birth
                  ? format(
                      new Date(watchedValues.date_of_birth),
                      "MMMM dd, yyyy",
                    )
                  : "Not set"}
              </div>
            )}
            {form.formState.errors.date_of_birth && (
              <p className="text-[11px] font-medium text-red-500">
                {form.formState.errors.date_of_birth.message}
              </p>
            )}
          </div>

          {/* Diet */}
          <div className="space-y-2">
            <Label
              className={cn(
                "text-xs font-medium uppercase tracking-wider",
                form.formState.errors.dietary_preference
                  ? "text-red-500"
                  : "text-slate-500",
              )}
            >
              Dietary Preference *
            </Label>
            {isEditing ? (
              <RadioGroup
                value={form.watch("dietary_preference")}
                onValueChange={(value) =>
                  form.setValue("dietary_preference", value as any, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
                className="flex gap-6 pt-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="Veg" id="veg" />
                  <Label htmlFor="veg">Pure Veg</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="Non-Veg" id="nonveg" />
                  <Label htmlFor="nonveg">Non-Veg</Label>
                </div>
              </RadioGroup>
            ) : (
              <div className="flex h-11 items-center gap-2 rounded-lg bg-slate-50/80 px-3 py-2.5">
                <span
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium uppercase",
                    watchedValues.dietary_preference === "Veg"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-orange-50 text-orange-700 border-orange-200",
                  )}
                >
                  {watchedValues.dietary_preference || "Not Selected"}
                </span>
              </div>
            )}
            {form.formState.errors.dietary_preference && (
              <p className="text-[11px] font-medium text-red-500">
                {form.formState.errors.dietary_preference.message}
              </p>
            )}
          </div>
        </div>

        {/* Allergies */}
        <div className="space-y-2 border-t border-slate-200 pt-6">
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
                "min-h-[80px] resize-none",
                form.formState.errors.allergies && "border-red-500",
              )}
            />
          ) : (
            <div className="flex min-h-[80px] gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm italic text-slate-700">
              <Info className="mt-1 h-4 w-4 shrink-0 text-slate-400" />{" "}
              {watchedValues.allergies || "Not provided."}
            </div>
          )}
          {form.formState.errors.allergies && (
            <p className="text-[11px] font-medium text-red-500">
              {form.formState.errors.allergies.message}
            </p>
          )}
        </div>

        {/* --- CRITICAL MEDICAL SECTION --- */}
        <div className="mt-6 space-y-4 border-t border-dashed border-slate-200 pt-6">
          <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <ShieldAlert className="h-5 w-5 text-blue-600" />
              <h3 className="font-bold text-blue-900">
                Mandatory Medical Assessment
              </h3>
            </div>
            <p className="text-sm text-blue-800">
              Please provide your medical history information. It is critical
              for our chefs to safely plan and prepare your meals.
            </p>
          </div>

          <div className="flex items-center justify-between py-2">
            <Label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Stethoscope className="h-4 w-4 text-slate-500" /> I have medical
              history or documents to share
            </Label>
            <Switch
              checked={hasMedicalHistory}
              disabled={!isEditing || initialDocuments.length > 0}
              onCheckedChange={(checked) => {
                form.setValue("has_medical_history", checked, {
                  shouldValidate: true,
                  shouldDirty: true,
                });
                if (checked)
                  form.setValue("no_medical_history_confirmed", false);
              }}
            />
          </div>

          {hasMedicalHistory ? (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
              {isEditing ? (
                <Textarea
                  {...form.register("medical_history_notes")}
                  placeholder="Describe any past conditions, surgeries, or treatments..."
                  className="min-h-[100px] resize-none"
                />
              ) : (
                <div className="flex min-h-[80px] gap-3 whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  {watchedValues.medical_history_notes || (
                    <span className="italic">Notes pending...</span>
                  )}
                </div>
              )}

              <div className="pt-2">
                <MedicalDocumentUploadModal
                  customerProfileId={initialData.id}
                />
              </div>
            </div>
          ) : (
            <div className="pt-2 animate-in fade-in">
              <div
                className={cn(
                  "flex items-start space-x-3 p-4 rounded-xl border",
                  form.formState.errors.no_medical_history_confirmed
                    ? "bg-red-50 border-red-200"
                    : "border-slate-200 bg-slate-50",
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
                <div className="grid gap-1.5 leading-none">
                  <Label
                    htmlFor="confirm_no_history"
                    className={cn(
                      "text-sm font-bold",
                      form.formState.errors.no_medical_history_confirmed
                        ? "text-red-800"
                        : "text-slate-800",
                    )}
                  >
                    I confirm I have no medical history
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    I acknowledge that I have no underlying medical conditions,
                    surgeries, or doctor instructions that ArogyaDiet should be
                    aware of.
                  </p>
                </div>
              </div>
              {form.formState.errors.no_medical_history_confirmed && (
                <p className="text-[11px] font-medium text-red-500 mt-2 ml-1">
                  {form.formState.errors.no_medical_history_confirmed.message}
                </p>
              )}
            </div>
          )}

          {initialDocuments.length > 0 && (
            <div className="mt-6 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <Label className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Uploaded Documents ({initialDocuments.length})
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {initialDocuments.map((doc) => {
                  const isPdf = doc.file_name.toLowerCase().endsWith(".pdf");

                  return (
                    <div
                      key={doc.id}
                      className="group relative flex items-center gap-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-3 transition-colors duration-200 hover:bg-slate-50"
                    >
                      {/* Thumbnail */}
                      <div className="h-12 w-12 rounded bg-white border shrink-0 flex items-center justify-center overflow-hidden">
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

                      {/* File Info */}
                      <div className="min-w-0 flex-1 pr-6">
                        <p className="truncate text-xs font-semibold text-slate-900">
                          {doc.file_name}
                        </p>
                        <p className="text-[10px] font-medium text-slate-500">
                          {(doc.file_size_bytes / 1024 / 1024).toFixed(2)} MB •{" "}
                          {format(new Date(doc.uploaded_at), "MMM d")}
                        </p>
                      </div>

                      {/* Secure View Link */}
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

        {/* Save Button */}
        {isEditing && (
          <div className="flex justify-end gap-4 pt-4">
            <Button
              type="submit"
              disabled={isPending}
              className="bg-primary px-10 font-semibold transition-all duration-200 hover:bg-primary/90"
            >
              {isPending ? "Saving..." : "Save Profile"}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
