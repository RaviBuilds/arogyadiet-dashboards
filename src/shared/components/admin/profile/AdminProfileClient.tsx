"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, KeyRound, Loader2, Mail, User } from "lucide-react";
import { toast } from "sonner";

import {
  changeAdminPasswordAction,
  updateAdminDisplayNameAction,
} from "@/actions/admin-actions/adminProfileActions";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/lib/utils";
import {
  adminDisplayNameSchema,
  adminPasswordSchema,
  type AdminDisplayNameValues,
  type AdminPasswordValues,
} from "@/validations/adminProfileSchema";

type AdminProfileClientProps = {
  initialData: {
    fullName: string;
    email: string;
  };
};

function PasswordField({
  id,
  label,
  show,
  onToggle,
  error,
  registration,
}: {
  id: string;
  label: string;
  show: boolean;
  onToggle: () => void;
  error?: string;
  registration: ReturnType<
    ReturnType<typeof useForm<AdminPasswordValues>>["register"]
  >;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          autoComplete={id === "currentPassword" ? "current-password" : "new-password"}
          className={cn("pr-10", error && "border-destructive")}
          {...registration}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export default function AdminProfileClient({
  initialData,
}: AdminProfileClientProps) {
  const router = useRouter();
  const [isNamePending, startNameTransition] = useTransition();
  const [isPasswordPending, startPasswordTransition] = useTransition();
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const nameForm = useForm<AdminDisplayNameValues>({
    resolver: zodResolver(adminDisplayNameSchema),
    defaultValues: { full_name: initialData.fullName },
  });

  const passwordForm = useForm<AdminPasswordValues>({
    resolver: zodResolver(adminPasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const onSaveName = nameForm.handleSubmit((values) => {
    startNameTransition(async () => {
      const result = await updateAdminDisplayNameAction(values.full_name);
      if (result.success) {
        toast.success("Display name updated.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  });

  const onChangePassword = passwordForm.handleSubmit((values) => {
    startPasswordTransition(async () => {
      const result = await changeAdminPasswordAction(
        values.currentPassword,
        values.newPassword,
        values.confirmPassword,
      );
      if (result.success) {
        toast.success("Password updated successfully.");
        passwordForm.reset();
      } else {
        toast.error(result.error);
      }
    });
  });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <User className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              Display Name
            </h2>
            <p className="text-sm text-slate-500">
              How your name appears across the admin portal.
            </p>
          </div>
        </div>

        <form onSubmit={onSaveName} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="full_name">Display Name</Label>
            <Input
              id="full_name"
              placeholder="Your display name"
              className={cn(
                nameForm.formState.errors.full_name && "border-destructive",
              )}
              {...nameForm.register("full_name")}
            />
            {nameForm.formState.errors.full_name ? (
              <p className="text-sm text-destructive">
                {nameForm.formState.errors.full_name.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="email"
                type="email"
                value={initialData.email}
                readOnly
                disabled
                className="bg-slate-50 pl-10 text-slate-600"
              />
            </div>
            <p className="text-xs text-slate-500">
              Email cannot be changed from this page.
            </p>
          </div>

          <Button type="submit" disabled={isNamePending} className="w-full sm:w-auto">
            {isNamePending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Display Name"
            )}
          </Button>
        </form>
      </div>

      <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
            <KeyRound className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              Change Password
            </h2>
            <p className="text-sm text-slate-500">
              Confirm your existing password before setting a new one.
            </p>
          </div>
        </div>

        <form onSubmit={onChangePassword} className="space-y-4">
          <PasswordField
            id="currentPassword"
            label="Existing Password"
            show={showCurrent}
            onToggle={() => setShowCurrent((v) => !v)}
            error={passwordForm.formState.errors.currentPassword?.message}
            registration={passwordForm.register("currentPassword")}
          />
          <PasswordField
            id="newPassword"
            label="New Password"
            show={showNew}
            onToggle={() => setShowNew((v) => !v)}
            error={passwordForm.formState.errors.newPassword?.message}
            registration={passwordForm.register("newPassword")}
          />
          <PasswordField
            id="confirmPassword"
            label="Confirm New Password"
            show={showConfirm}
            onToggle={() => setShowConfirm((v) => !v)}
            error={passwordForm.formState.errors.confirmPassword?.message}
            registration={passwordForm.register("confirmPassword")}
          />

          <Button
            type="submit"
            variant="outline"
            disabled={isPasswordPending}
            className="mt-2 w-full sm:w-auto"
          >
            {isPasswordPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Updating...
              </>
            ) : (
              "Update Password"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
