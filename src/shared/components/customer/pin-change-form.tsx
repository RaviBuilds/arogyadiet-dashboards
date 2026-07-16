"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound, Lock, ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { changePinAction } from "@/actions/pinManagementActions";
import { SectionCard } from "./profile-ui/SectionCard";

const pinChangeSchema = z.object({
  currentPin: z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits"),
  newPin: z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits"),
  confirmPin: z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits"),
}).refine((data) => data.newPin === data.confirmPin, {
  message: "PINs do not match",
  path: ["confirmPin"],
});

type PinChangeFormValues = z.infer<typeof pinChangeSchema>;

/**
 * Shared field style for the three PIN inputs.
 *
 * Native settings-screen calibration: a comfortable 44px tap target with calm
 * padding and a soft emerald focus ring. The *entered* PIN reads as a spaced
 * 16px monospace value (clear, never oversized), while the *placeholder* is
 * deliberately quieter — 14px, sans, normal tracking, muted — so the hint no
 * longer shouts louder than the label. iOS won't zoom on focus (value stays
 * 16px).
 */
const PIN_INPUT_CLASS =
  "h-11 rounded-xl px-4 text-center font-mono text-base tracking-[0.3em] text-slate-900 " +
  "transition-colors placeholder:font-sans placeholder:text-sm placeholder:font-normal " +
  "placeholder:tracking-normal placeholder:text-slate-400 " +
  "focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/20";

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
    <div
      className="reveal-rise"
      style={{ ["--reveal-delay" as string]: "450ms" }}
    >
      <SectionCard
        icon={Lock}
        iconTone="slate"
        title="Security"
        description="Your account is protected using a secure 6-digit PIN."
        action={
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
        }
      >
        {!isExpanded ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsExpanded(true)}
            className="gap-2 transition-all duration-200 active:scale-[0.98]"
          >
            <KeyRound className="h-4 w-4" /> Change PIN
          </Button>
        ) : (
          <div className="animate-in slide-in-from-top-2 duration-200">
            <div className="max-w-md">
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                {/* Icon dropped from each label — one KeyRound already anchors
                    the section via the Change PIN trigger, repeating it on
                    every field read as decorative noise rather than hierarchy. */}
                <div className="space-y-1.5">
                  <Label htmlFor="currentPin" className="text-sm font-medium text-slate-700">
                    Current PIN
                  </Label>
                  <Input
                    id="currentPin"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="Enter current PIN"
                    className={cn(
                      PIN_INPUT_CLASS,
                      errors.currentPin
                        ? "border-red-300 focus-visible:border-red-400 focus-visible:ring-red-500/20"
                        : "",
                    )}
                    {...register("currentPin")}
                  />
                  {errors.currentPin && (
                    <p className="text-sm text-red-600">{errors.currentPin.message}</p>
                  )}
                </div>

                <div className="space-y-1.5 border-t border-dashed border-slate-200 pt-5">
                  <Label htmlFor="newPin" className="text-sm font-medium text-slate-700">
                    New PIN
                  </Label>
                  <Input
                    id="newPin"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="Enter new PIN"
                    className={cn(
                      PIN_INPUT_CLASS,
                      errors.newPin
                        ? "border-red-300 focus-visible:border-red-400 focus-visible:ring-red-500/20"
                        : "",
                    )}
                    {...register("newPin")}
                  />
                  {errors.newPin ? (
                    <p className="text-sm text-red-600">{errors.newPin.message}</p>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Must be exactly 6 numeric digits
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirmPin" className="text-sm font-medium text-slate-700">
                    Confirm New PIN
                  </Label>
                  <Input
                    id="confirmPin"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="Re-enter new PIN"
                    className={cn(
                      PIN_INPUT_CLASS,
                      errors.confirmPin
                        ? "border-red-300 focus-visible:border-red-400 focus-visible:ring-red-500/20"
                        : "",
                    )}
                    {...register("confirmPin")}
                  />
                  {errors.confirmPin && (
                    <p className="text-sm text-red-600">{errors.confirmPin.message}</p>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      reset();
                      setIsExpanded(false);
                    }}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-slate-900 font-semibold hover:bg-slate-800 active:scale-[0.98]"
                  >
                    {isSubmitting ? "Updating..." : "Update PIN"}
                  </Button>
                </div>
              </form>
            </div>

            {/* Same tinted-card language as Medical Assessment's trust
                copy, rather than a one-off green box. */}
            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-emerald-900/10 bg-emerald-50/70 p-4">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div>
                <p className="text-sm font-semibold text-emerald-900">Security Tip</p>
                <p className="mt-1 text-sm leading-relaxed text-emerald-800">
                  Choose a PIN that's easy for you to remember but hard for
                  others to guess. Avoid using obvious numbers like
                  birthdates or repeated digits.
                </p>
              </div>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
