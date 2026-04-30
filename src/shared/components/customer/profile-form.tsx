"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
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
import { CalendarIcon, CheckCircle2, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface ProfileFormProps {
  initialData: ProfileFormValues;
}

export function ProfileForm({ initialData }: ProfileFormProps) {
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: initialData,
  });

  async function onSubmit(data: ProfileFormValues) {
    setIsPending(true);
    setMessage(null);
    const result = await updateProfileAction(data);
    setIsPending(false);

    if (result?.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setMessage({
        type: "success",
        text: "Profile details updated successfully!",
      });
      form.reset(data); // Clear dirty state
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
        {/* Full Name - Users Table */}
        <div className="space-y-2">
          <Label htmlFor="full_name">Full Name</Label>
          <Input
            {...form.register("full_name")}
            placeholder="Ravindra Kamble"
          />
          {form.formState.errors.full_name && (
            <p className="text-xs text-red-500 font-medium">
              {form.formState.errors.full_name.message}
            </p>
          )}
        </div>

        {/* Email - Read Only */}
        <div className="space-y-2">
          <Label className="text-muted-foreground">
            Email Address (Primary)
          </Label>
          <Input
            {...form.register("email")}
            disabled
            className="bg-slate-50 cursor-not-allowed"
          />
        </div>

        {/* Mobile Number - Users Table (Mapped to 'mobile' in DB) */}
        <div className="space-y-2">
          <Label htmlFor="phone">Mobile Number</Label>
          <Input {...form.register("phone")} placeholder="8019443314" />
          {form.formState.errors.phone && (
            <p className="text-xs text-red-500 font-medium">
              {form.formState.errors.phone.message}
            </p>
          )}
        </div>

        {/* Gender - Customer Profiles Table */}
        <div className="space-y-2">
          <Label>Gender</Label>
          <Select
            defaultValue={form.getValues("gender")}
            onValueChange={(val) =>
              form.setValue("gender", val as any, { shouldDirty: true })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select Gender" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Male">Male</SelectItem>
              <SelectItem value="Female">Female</SelectItem>
              <SelectItem value="Other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Date of Birth - Customer Profiles Table */}
        <div className="space-y-2 flex flex-col">
          <Label className="mb-1">Date of Birth</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={"outline"}
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !form.watch("date_of_birth") && "text-muted-foreground",
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {form.watch("date_of_birth") ? (
                  format(new Date(form.watch("date_of_birth")!), "PPP")
                ) : (
                  <span>Pick a date</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={
                  form.watch("date_of_birth")
                    ? new Date(form.watch("date_of_birth")!)
                    : undefined
                }
                onSelect={(date) =>
                  form.setValue("date_of_birth", date?.toISOString() || "", {
                    shouldDirty: true,
                  })
                }
                disabled={(date) =>
                  date > new Date() || date < new Date("1900-01-01")
                }
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Dietary Preference - Users Table */}
        <div className="space-y-2">
          <Label>Dietary Preference</Label>
          <RadioGroup
            defaultValue={form.getValues("dietary_preference")}
            onValueChange={(val: string) =>
              form.setValue("dietary_preference", val as any, {
                shouldDirty: true,
              })
            }
            className="flex gap-6 pt-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem
                value="Veg"
                id="veg"
                className="text-primary border-primary"
              />
              <Label htmlFor="veg" className="font-normal cursor-pointer">
                Pure Veg
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem
                value="Non-Veg"
                id="non-veg"
                className="text-primary border-primary"
              />
              <Label htmlFor="non-veg" className="font-normal cursor-pointer">
                Non-Veg (Incl. Eggs)
              </Label>
            </div>
          </RadioGroup>
        </div>
      </div>

      {/* Allergies - Users Table[cite: 1] */}
      <div className="space-y-2">
        <Label htmlFor="allergies">Allergies or Special Instructions</Label>
        <Textarea
          {...form.register("allergies")}
          placeholder="e.g., Brinjal, No peanuts, lactose intolerant..."
          className="min-h-[100px] resize-none"
        />
      </div>

      {/* Status Messages */}
      {message && (
        <div
          className={cn(
            "p-4 rounded-lg flex items-center gap-3 text-sm font-medium border",
            message.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-destructive/10 text-destructive border-destructive/20",
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

      <div className="flex justify-start">
        <Button
          type="submit"
          disabled={isPending || !form.formState.isDirty}
          className="px-8"
        >
          {isPending ? "Updating..." : "Update Profile"}
        </Button>
      </div>
    </form>
  );
}
