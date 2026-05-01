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
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface ProfileFormProps {
  initialData: ProfileFormValues;
}

export function ProfileForm({ initialData }: ProfileFormProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: initialData,
  });

  // IMPORTANT FIX:
  // whenever server sends fresh props after router.refresh(),
  // sync them back into RHF
  useEffect(() => {
    form.reset(initialData);
  }, [initialData, form]);

  const watchedValues = form.watch();

  async function onSubmit(data: ProfileFormValues) {
    setIsPending(true);
    setMessage(null);

    const result = await updateProfileAction(data);

    setIsPending(false);

    if (result?.error) {
      setMessage({
        type: "error",
        text: result.error,
      });
      return;
    }

    setMessage({
      type: "success",
      text: "Profile updated successfully!",
    });

    setIsEditing(false);

    // fetch fresh DB data
    router.refresh();
  }

  const toggleEdit = () => {
    if (isEditing) {
      form.reset(initialData);
    }

    setIsEditing(!isEditing);
    setMessage(null);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex justify-between items-center border-b pb-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-900">Personal Details</h2>
          <p className="text-sm text-muted-foreground">
            Manage your profile and dietary preferences
          </p>
        </div>

        <Button
          variant={isEditing ? "ghost" : "outline"}
          size="sm"
          onClick={toggleEdit}
          className={cn(
            "gap-2",
            isEditing
              ? "text-zinc-500"
              : "border-primary text-primary hover:bg-primary/5",
          )}
        >
          {isEditing ? (
            <>
              <X className="h-4 w-4" />
              Cancel
            </>
          ) : (
            <>
              <Pencil className="h-4 w-4" />
              Edit Profile
            </>
          )}
        </Button>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
          {/* Full Name */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-bold">
              Full Name
            </Label>

            {isEditing ? (
              <Input {...form.register("full_name")} className="h-11" />
            ) : (
              <div className="flex items-center gap-3 h-11 px-1 text-zinc-900 font-medium">
                <User className="h-4 w-4 text-zinc-400" />
                {watchedValues.full_name || "Not provided"}
              </div>
            )}
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-bold">
              Email Address
            </Label>

            <div className="flex items-center gap-3 h-11 px-1 text-zinc-500 italic">
              <Mail className="h-4 w-4 text-zinc-400" />
              {watchedValues.email}
            </div>
          </div>

          {/* Mobile */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-bold">
              Mobile Number
            </Label>

            {isEditing ? (
              <Input {...form.register("phone")} className="h-11" />
            ) : (
              <div className="flex items-center gap-3 h-11 px-1 text-zinc-900 font-medium">
                <Phone className="h-4 w-4 text-zinc-400" />
                {watchedValues.phone || "Not provided"}
              </div>
            )}
          </div>

          {/* Gender */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-bold">
              Gender
            </Label>

            {isEditing ? (
              <Select
                value={form.watch("gender")}
                onValueChange={(value) =>
                  form.setValue("gender", value as any, {
                    shouldDirty: true,
                  })
                }
              >
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Select Gender" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center gap-3 h-11 px-1 text-zinc-900 font-medium">
                <span className="bg-zinc-100 text-zinc-600 text-[11px] px-2 py-1 rounded font-bold uppercase tracking-tight">
                  {watchedValues.gender || "Select Gender"}
                </span>
              </div>
            )}
          </div>

          {/* DOB */}
          <div className="space-y-2 flex flex-col">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-1">
              Date of Birth
            </Label>

            {isEditing ? (
              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-11 justify-start text-left font-normal"
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
                        { shouldDirty: true },
                      );
                      setIsCalendarOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            ) : (
              <div className="flex items-center gap-3 h-11 px-1 text-zinc-900 font-medium">
                <CalendarDays className="h-4 w-4 text-zinc-400" />

                {watchedValues.date_of_birth
                  ? format(
                      new Date(watchedValues.date_of_birth),
                      "MMMM dd, yyyy",
                    )
                  : "Not set"}
              </div>
            )}
          </div>

          {/* Diet */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-bold">
              Dietary Preference
            </Label>

            {isEditing ? (
              <RadioGroup
                value={form.watch("dietary_preference")}
                onValueChange={(value) =>
                  form.setValue("dietary_preference", value as any, {
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
              <div className="flex items-center gap-2 h-11 px-1">
                <span
                  className={cn(
                    "text-[11px] px-3 py-1 rounded-full font-bold border uppercase",
                    watchedValues.dietary_preference === "Veg"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-orange-50 text-orange-700 border-orange-200",
                  )}
                >
                  {watchedValues.dietary_preference || "Not Selected"}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Allergies */}
        <div className="space-y-2 pt-4 border-t">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground font-bold">
            Allergies or Special Instructions
          </Label>

          {isEditing ? (
            <Textarea
              {...form.register("allergies")}
              className="min-h-[100px] resize-none"
            />
          ) : (
            <div className="flex gap-3 p-4 bg-zinc-50 rounded-xl border border-dashed text-zinc-700 text-sm italic min-h-[80px]">
              <Info className="h-4 w-4 text-zinc-400 mt-1 shrink-0" />
              {watchedValues.allergies || "No special instructions provided."}
            </div>
          )}
        </div>

        {/* Message */}
        {message && (
          <div
            className={cn(
              "p-4 rounded-lg flex items-center gap-3 text-sm font-medium border",
              message.type === "success"
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : "bg-red-50 text-red-800 border-red-200",
            )}
          >
            {message.type === "success" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}

            {message.text}
          </div>
        )}

        {/* Save */}
        {isEditing && (
          <div className="flex justify-end gap-4">
            <Button
              type="submit"
              disabled={isPending || !form.formState.isDirty}
              className="px-10 bg-primary hover:bg-primary/90 font-bold"
            >
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
