"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Loader2 } from "lucide-react";
import {
  franchiseUpdateCustomerBasicInfo,
  franchiseUpdateCustomerDietaryProfile,
} from "@/actions/franchise-actions/franchiseCustomerManagementActions";

const quickEditSchema = z.object({
  fullName: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be at most 100 characters"),
  mobile: z
    .string()
    .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"),
  gender: z.enum(["Male", "Female", "Other"], {
    message: "Please select a gender",
  }),
  dateOfBirth: z.string().refine(
    (val) => {
      if (!val) return true; // allow empty
      const date = new Date(val);
      if (isNaN(date.getTime())) return false;
      const now = new Date();
      const minDate = new Date(
        now.getFullYear() - 120,
        now.getMonth(),
        now.getDate(),
      );
      return date <= now && date >= minDate;
    },
    { message: "Date of birth must be valid, not in the future, and not more than 120 years ago" },
  ),
  dietaryPreference: z.enum(["Veg", "Non-Veg"], {
    message: "Please select a dietary preference",
  }),
});

type QuickEditFormData = z.infer<typeof quickEditSchema>;

interface CustomerData {
  id: string;
  userId?: string;
  fullName: string;
  mobile: string;
  gender: string;
  dateOfBirth: string;
  dietary_preference: string;
}

interface FranchiseQuickEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: CustomerData | null;
  onSuccess: () => void;
}

export function FranchiseQuickEditModal({
  isOpen,
  onClose,
  customer,
  onSuccess,
}: FranchiseQuickEditModalProps) {
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
    reset,
  } = useForm<QuickEditFormData>({
    resolver: zodResolver(quickEditSchema),
    values: customer
      ? {
          fullName: customer.fullName === "N/A" ? "" : customer.fullName,
          mobile: customer.mobile === "N/A" ? "" : customer.mobile,
          gender: (["Male", "Female", "Other"].includes(customer.gender)
            ? customer.gender
            : "Male") as "Male" | "Female" | "Other",
          dateOfBirth: customer.dateOfBirth || "",
          dietaryPreference: (
            customer.dietary_preference === "Veg" ||
            customer.dietary_preference === "Non-Veg"
              ? customer.dietary_preference
              : "Veg"
          ) as "Veg" | "Non-Veg",
        }
      : undefined,
  });

  const gender = watch("gender");
  const dietaryPreference = watch("dietaryPreference");

  const onSubmit = (data: QuickEditFormData) => {
    if (!customer) return;

    startTransition(async () => {
      try {
        // Update basic info (name, mobile, gender, DOB)
        const basicRes = await franchiseUpdateCustomerBasicInfo(
          customer.id,
          customer.userId || "",
          {
            fullName: data.fullName,
            mobile: data.mobile,
            gender: data.gender,
            dateOfBirth: data.dateOfBirth,
          },
        );

        if (!basicRes.success) {
          toast.error(
            (basicRes as { error?: string }).error || "Failed to update basic info.",
          );
          return;
        }

        // Update dietary profile
        const dietRes = await franchiseUpdateCustomerDietaryProfile(customer.id, {
          dietaryPreference: data.dietaryPreference,
          allergies: "", // preserve existing; don't clear
        });

        if (!dietRes.success) {
          toast.error(
            (dietRes as { error?: string }).error || "Failed to update dietary profile.",
          );
          return;
        }

        toast.success("Customer updated successfully.");
        onSuccess();
        onClose();
        reset();
      } catch {
        toast.error("An unexpected error occurred.");
      }
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Quick Edit Customer</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          {/* Full Name */}
          <div className="space-y-1.5">
            <Label htmlFor="qe-fullName">Full Name</Label>
            <Input
              id="qe-fullName"
              {...register("fullName")}
              placeholder="Full name"
            />
            {errors.fullName && (
              <p className="text-xs text-red-500">{errors.fullName.message}</p>
            )}
          </div>

          {/* Mobile */}
          <div className="space-y-1.5">
            <Label htmlFor="qe-mobile">Mobile Number</Label>
            <Input
              id="qe-mobile"
              {...register("mobile")}
              placeholder="10-digit mobile"
            />
            {errors.mobile && (
              <p className="text-xs text-red-500">{errors.mobile.message}</p>
            )}
          </div>

          {/* Gender */}
          <div className="space-y-1.5">
            <Label>Gender</Label>
            <Select
              value={gender}
              onValueChange={(val) =>
                setValue("gender", val as "Male" | "Female" | "Other", {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select gender" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Male">Male</SelectItem>
                <SelectItem value="Female">Female</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
            {errors.gender && (
              <p className="text-xs text-red-500">{errors.gender.message}</p>
            )}
          </div>

          {/* Date of Birth */}
          <div className="space-y-1.5">
            <Label htmlFor="qe-dob">Date of Birth</Label>
            <Input id="qe-dob" type="date" {...register("dateOfBirth")} />
            {errors.dateOfBirth && (
              <p className="text-xs text-red-500">
                {errors.dateOfBirth.message}
              </p>
            )}
          </div>

          {/* Dietary Preference */}
          <div className="space-y-1.5">
            <Label>Dietary Preference</Label>
            <Select
              value={dietaryPreference}
              onValueChange={(val) =>
                setValue("dietaryPreference", val as "Veg" | "Non-Veg", {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select preference" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Veg">Veg</SelectItem>
                <SelectItem value="Non-Veg">Non-Veg</SelectItem>
              </SelectContent>
            </Select>
            {errors.dietaryPreference && (
              <p className="text-xs text-red-500">
                {errors.dietaryPreference.message}
              </p>
            )}
          </div>

          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
