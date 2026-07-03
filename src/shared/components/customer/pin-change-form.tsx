"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound, ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { changePinAction } from "@/actions/pinManagementActions";

const pinChangeSchema = z.object({
  currentPin: z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits"),
  newPin: z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits"),
  confirmPin: z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits"),
}).refine((data) => data.newPin === data.confirmPin, {
  message: "PINs do not match",
  path: ["confirmPin"],
});

type PinChangeFormValues = z.infer<typeof pinChangeSchema>;

export function PinChangeForm() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<PinChangeFormValues>({
    resolver: zodResolver(pinChangeSchema),
  });

  const onSubmit = async (data: PinChangeFormValues) => {
    setIsSubmitting(true);
    toast.loading("Updating PIN...", { id: "pin-change" });

    try {
      const result = await changePinAction(data.currentPin, data.newPin, data.confirmPin);
      
      if (result.outcome === "OK") {
        toast.success("PIN updated successfully!", { id: "pin-change" });
        reset();
        setIsExpanded(false);
      } else if (result.outcome === "INVALID") {
        toast.error(result.message || "Current PIN is incorrect", { id: "pin-change" });
      } else if (result.outcome === "MISMATCH") {
        toast.error(result.message || "New PINs do not match", { id: "pin-change" });
      } else if (result.outcome === "INVALID_FORMAT") {
        toast.error(result.message || "PIN must be exactly 6 digits", { id: "pin-change" });
      } else {
        toast.error(result.message || "Failed to update PIN", { id: "pin-change" });
      }
    } catch (error) {
      toast.error("Failed to update PIN. Please try again.", { id: "pin-change" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-lg font-semibold text-slate-900">
                Change PIN
              </CardTitle>
              <p className="text-sm text-slate-600 mt-0.5">
                Update your 6-digit login PIN
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-slate-600 hover:text-slate-900"
          >
            {isExpanded ? (
              <ChevronUp className="h-5 w-5" />
            ) : (
              <ChevronDown className="h-5 w-5" />
            )}
          </Button>
        </div>
      </CardHeader>
      
      {isExpanded && (
        <CardContent className="animate-in slide-in-from-top-2 duration-200">
          {/* Constrained Form Container */}
          <div className="max-w-md">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {/* Current PIN Field */}
              <div className="space-y-1.5">
                <Label htmlFor="currentPin" className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <KeyRound className="h-3.5 w-3.5" />
                  Current PIN
                </Label>
                <Input
                  id="currentPin"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Enter your current 6-digit PIN"
                  className={cn(
                    "transition-colors font-mono text-center text-lg tracking-widest",
                    errors.currentPin ? "border-red-300 focus:ring-red-500" : ""
                  )}
                  {...register("currentPin")}
                />
                {errors.currentPin && (
                  <p className="text-sm text-red-600">{errors.currentPin.message}</p>
                )}
              </div>

              {/* New PIN Field */}
              <div className="space-y-1.5">
                <Label htmlFor="newPin" className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <KeyRound className="h-3.5 w-3.5" />
                  New PIN
                </Label>
                <Input
                  id="newPin"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Enter your new 6-digit PIN"
                  className={cn(
                    "transition-colors font-mono text-center text-lg tracking-widest",
                    errors.newPin ? "border-red-300 focus:ring-red-500" : ""
                  )}
                  {...register("newPin")}
                />
                {errors.newPin && (
                  <p className="text-sm text-red-600">{errors.newPin.message}</p>
                )}
                <p className="text-xs text-slate-500">
                  Must be exactly 6 numeric digits
                </p>
              </div>

              {/* Confirm PIN Field */}
              <div className="space-y-1.5">
                <Label htmlFor="confirmPin" className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <KeyRound className="h-3.5 w-3.5" />
                  Confirm New PIN
                </Label>
                <Input
                  id="confirmPin"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Re-enter your new 6-digit PIN"
                  className={cn(
                    "transition-colors font-mono text-center text-lg tracking-widest",
                    errors.confirmPin ? "border-red-300 focus:ring-red-500" : ""
                  )}
                  {...register("confirmPin")}
                />
                {errors.confirmPin && (
                  <p className="text-sm text-red-600">{errors.confirmPin.message}</p>
                )}
              </div>

              {/* Submit Button - Premium Brand Styling */}
              <div className="pt-4 flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    reset();
                    setIsExpanded(false);
                  }}
                  disabled={isSubmitting}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-medium py-2.5 rounded-xl transition-colors"
                >
                  {isSubmitting ? "Updating..." : "Update PIN"}
                </Button>
              </div>
            </form>
          </div>

          {/* Security Notice */}
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 flex items-start gap-3">
            <div className="flex-shrink-0">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="font-medium text-emerald-800">Security Tip</p>
              <p className="text-emerald-700 mt-1">
                Choose a PIN that's easy for you to remember but hard for others to guess. Avoid using obvious numbers like birthdates or repeated digits.
              </p>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
