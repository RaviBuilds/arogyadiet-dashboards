"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useActionState } from "react";
import { Eye, EyeOff, Lock, KeyRound, ShieldAlert } from "lucide-react";
import { passwordChangeSchema, PasswordChangeFormValues } from "@/validations/passwordSchema";
import { changePasswordAction } from "@/actions/authActions";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function PasswordChangeForm() {
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [state, formAction] = useActionState(changePasswordAction, null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<PasswordChangeFormValues>({
    resolver: zodResolver(passwordChangeSchema),
  });

  const onSubmit = async (data: PasswordChangeFormValues) => {
    setIsSubmitting(true);
    toast.loading("Updating password...", { id: "password-change" });

    const formData = new FormData();
    formData.append("currentPassword", data.currentPassword);
    formData.append("newPassword", data.newPassword);
    formData.append("confirmPassword", data.confirmPassword);

    try {
      const result = await changePasswordAction(null, formData);
      
      if (result?.error) {
        toast.error(result.error, { id: "password-change" });
      } else if (result?.success) {
        toast.success(result.success, { id: "password-change" });
        reset();
      }
    } catch (error) {
      toast.error("Failed to update password. Please try again.", { id: "password-change" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-3 text-lg font-semibold text-slate-900">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-600">
            <KeyRound className="h-4 w-4" />
          </div>
          Change Password
        </CardTitle>
        <p className="text-sm text-slate-600">
          Update your password to keep your account secure. You'll stay signed in on this device.
        </p>
      </CardHeader>
      
      <CardContent>
        {/* Constrained Form Container */}
        <div className="max-w-md">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Current Password Field */}
            <div className="space-y-1.5">
              <Label htmlFor="currentPassword" className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <Lock className="h-3.5 w-3.5" />
                Current Password
              </Label>
              <div className="relative">
                <Input
                  id="currentPassword"
                  type={showCurrentPassword ? "text" : "password"}
                  placeholder="Enter your current password"
                  className={cn(
                    "pr-10 transition-colors",
                    errors.currentPassword ? "border-red-300 focus:ring-red-500" : ""
                  )}
                  {...register("currentPassword")}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 transition-colors"
                  tabIndex={-1}
                >
                  {showCurrentPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.currentPassword && (
                <p className="text-sm text-red-600">{errors.currentPassword.message}</p>
              )}
            </div>

            {/* New Password Field */}
            <div className="space-y-1.5">
              <Label htmlFor="newPassword" className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <KeyRound className="h-3.5 w-3.5" />
                New Password
              </Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showNewPassword ? "text" : "password"}
                  placeholder="Enter your new password"
                  className={cn(
                    "pr-10 transition-colors",
                    errors.newPassword ? "border-red-300 focus:ring-red-500" : ""
                  )}
                  {...register("newPassword")}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 transition-colors"
                  tabIndex={-1}
                >
                  {showNewPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.newPassword && (
                <p className="text-sm text-red-600">{errors.newPassword.message}</p>
              )}
              <p className="text-xs text-slate-500">
                Must be at least 8 characters with uppercase, lowercase, and number
              </p>
            </div>

            {/* Confirm Password Field */}
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword" className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <KeyRound className="h-3.5 w-3.5" />
                Confirm New Password
              </Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm your new password"
                  className={cn(
                    "pr-10 transition-colors",
                    errors.confirmPassword ? "border-red-300 focus:ring-red-500" : ""
                  )}
                  {...register("confirmPassword")}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 transition-colors"
                  tabIndex={-1}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="text-sm text-red-600">{errors.confirmPassword.message}</p>
              )}
            </div>

            {/* Submit Button - Premium Brand Styling */}
            <div className="pt-4">
              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium py-2.5 rounded-xl transition-colors"
              >
                {isSubmitting ? "Updating Password..." : "Update Password"}
              </Button>
            </div>
          </form>
        </div>

        {/* Soft Security Notice Alert */}
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex items-start gap-3">
          <div className="flex-shrink-0">
            <ShieldAlert className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="font-medium text-amber-800">Security Notice</p>
            <p className="text-amber-700 mt-1">
              For your security, changing your password will sign you out of all other devices. You'll remain signed in here.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}