"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { profileSchema, ProfileFormValues } from "@/validations/profileSchema";
import { updateProfileAction } from "@/actions/profileActions";
import { submitRealEmailAction } from "@/actions/profileCompletionActions";
import { Input } from "@/shared/components/ui/input";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Calendar } from "@/shared/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import {
  CalendarIcon,
  AlertCircle,
  Pencil,
  X,
  User,
  Sparkles,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { dispatchNotificationsRefresh } from "@/lib/notifications/refresh";
import { SectionCard } from "./profile-ui/SectionCard";
import { InfoRow } from "./profile-ui/InfoRow";
import { MedicalAssessmentSection } from "./profile-ui/MedicalAssessmentSection";

interface ProfileFormProps {
  initialData: ProfileFormValues & { id: string };
  initialDocuments: any[];
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

  async function onSubmit(data: ProfileFormValues) {
    setIsPending(true);

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
        return;
      }
    } else {
      data.medical_history_notes = "";
    }

    const newEmail = data.email?.trim();
    if (newEmail && newEmail !== initialData.email) {
      const emailResult = await submitRealEmailAction(newEmail);
      if ("error" in emailResult) {
        setIsPending(false);
        form.setError("email", { type: "server", message: emailResult.error });
        toast.error(emailResult.error);
        return;
      }
    }

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
    <div
      className="reveal-rise space-y-6"
      style={{ ["--reveal-delay" as string]: "300ms" }}
    >
      <SectionCard
        icon={User}
        iconTone="coral"
        title="Personal Details"
        description="Manage your profile and dietary preferences."
        action={
          <Button
            type="button"
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
        }
      >
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          {Object.keys(form.formState.errors).length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 text-red-600" />
              <p className="text-sm font-medium text-red-800">
                Please fill all mandatory fields marked in red below.
              </p>
            </div>
          )}

          {/* Basic Information */}
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Basic Information
            </p>
            <div className="grid grid-cols-1 gap-x-12 gap-y-6 md:grid-cols-2 md:gap-y-7">
              {/* Full Name */}
              <div className="space-y-2">
                {isEditing ? (
                  <>
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
                    <Input
                      {...form.register("full_name")}
                      className={cn(
                        "h-11",
                        form.formState.errors.full_name && "border-red-500",
                      )}
                    />
                  </>
                ) : (
                  <InfoRow label="Full Name" value={watchedValues.full_name} />
                )}
                {form.formState.errors.full_name && (
                  <p className="text-[11px] font-medium text-red-500">
                    {form.formState.errors.full_name.message}
                  </p>
                )}
              </div>

              {/* Mobile */}
              <div className="space-y-2">
                {isEditing ? (
                  <>
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
                    <Input
                      {...form.register("phone")}
                      className={cn(
                        "h-11",
                        form.formState.errors.phone && "border-red-500",
                      )}
                    />
                  </>
                ) : (
                  <InfoRow label="Mobile Number" value={watchedValues.phone} />
                )}
                {form.formState.errors.phone && (
                  <p className="text-[11px] font-medium text-red-500">
                    {form.formState.errors.phone.message}
                  </p>
                )}
              </div>

              {/* Email */}
              <div className="space-y-2">
                {isEditing ? (
                  <>
                    <Label
                      className={cn(
                        "text-xs font-medium uppercase tracking-wider",
                        form.formState.errors.email
                          ? "text-red-500"
                          : "text-slate-500",
                      )}
                    >
                      Email Address
                    </Label>
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      {...form.register("email")}
                      className={cn(
                        "h-11",
                        form.formState.errors.email && "border-red-500",
                      )}
                    />
                  </>
                ) : (
                  <InfoRow label="Email Address" value={watchedValues.email} />
                )}
                {form.formState.errors.email && (
                  <p className="text-[11px] font-medium text-red-500">
                    {form.formState.errors.email.message}
                  </p>
                )}
              </div>

              {/* Date of Birth */}
              <div className="flex flex-col space-y-2">
                {isEditing ? (
                  <>
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
                    <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
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
                  </>
                ) : (
                  <InfoRow
                    label="Date of Birth"
                    value={
                      watchedValues.date_of_birth
                        ? format(new Date(watchedValues.date_of_birth), "MMMM dd, yyyy")
                        : null
                    }
                  />
                )}
                {form.formState.errors.date_of_birth && (
                  <p className="text-[11px] font-medium text-red-500">
                    {form.formState.errors.date_of_birth.message}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Lifestyle */}
          <div className="space-y-4 border-t border-slate-200 pt-6">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <Sparkles className="h-3.5 w-3.5" /> Lifestyle
            </p>
            <div className="grid grid-cols-1 gap-x-12 gap-y-6 md:grid-cols-2 md:gap-y-7">
              {/* Gender */}
              <div className="space-y-2">
                {isEditing ? (
                  <>
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
                  </>
                ) : (
                  <InfoRow label="Gender" value={watchedValues.gender} />
                )}
                {form.formState.errors.gender && (
                  <p className="text-[11px] font-medium text-red-500">
                    {form.formState.errors.gender.message}
                  </p>
                )}
              </div>

              {/* Diet */}
              <div className="space-y-2">
                {isEditing ? (
                  <>
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
                  </>
                ) : (
                  <InfoRow
                    label="Dietary Preference"
                    value={watchedValues.dietary_preference}
                  />
                )}
                {form.formState.errors.dietary_preference && (
                  <p className="text-[11px] font-medium text-red-500">
                    {form.formState.errors.dietary_preference.message}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Medical Assessment lives in its own SectionCard but stays inside
              this form so the same submit/edit state governs both. */}
          <div className="border-t border-slate-200 pt-6">
            <MedicalAssessmentSection
              form={form}
              isEditing={isEditing}
              customerProfileId={initialData.id}
              initialDocuments={initialDocuments}
            />
          </div>

          {isEditing && (
            <div className="flex justify-end gap-4">
              <Button
                type="submit"
                disabled={isPending}
                className="bg-primary px-10 font-semibold transition-all duration-200 hover:bg-primary/90 active:scale-[0.98]"
              >
                {isPending ? "Saving..." : "Save Profile"}
              </Button>
            </div>
          )}
        </form>
      </SectionCard>
    </div>
  );
}
