"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { KeyRound, X, Eye, EyeOff } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { changeRiderPassword } from "@/actions/rider-actions/profileActions";

export function ChangePasswordModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const resetForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError("");
    setSuccess("");
    setShowCurrent(false);
    setShowNew(false);
    setShowConfirm(false);
  };

  const handleClose = () => {
    setIsOpen(false);
    resetForm();
  };

  const handleSubmit = async () => {
    setError("");
    setSuccess("");
    setIsSubmitting(true);

    try {
      const result = await changeRiderPassword(
        currentPassword,
        newPassword,
        confirmPassword,
      );

      if (result.error) {
        setError(result.error);
      } else if (result.success) {
        setSuccess(result.success);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        variant="outline"
        className="w-full mt-6 rounded-xl font-bold shadow-sm border-zinc-200 hover:bg-zinc-100 text-zinc-700"
      >
        <KeyRound className="h-4 w-4 mr-2" /> Change Password
      </Button>

      {isOpen &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl animate-in zoom-in-95 my-auto">
              {/* Header */}
              <div className="flex justify-between items-center p-4 border-b bg-zinc-50 rounded-t-2xl">
                <h2 className="text-lg font-bold text-zinc-900">
                  Change Password
                </h2>
                <button
                  onClick={handleClose}
                  className="text-zinc-400 hover:text-zinc-900 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 space-y-4">
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm font-medium rounded-xl px-4 py-3">
                    {error}
                  </div>
                )}
                {success && (
                  <div className="bg-green-50 border border-green-200 text-green-700 text-sm font-medium rounded-xl px-4 py-3">
                    {success}
                  </div>
                )}

                {/* Current Password */}
                <div>
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                    Current Password
                  </label>
                  <div className="relative mt-2">
                    <input
                      type={showCurrent ? "text" : "password"}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full px-4 py-3 pr-11 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium text-zinc-900"
                      placeholder="Enter current password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrent(!showCurrent)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                    >
                      {showCurrent ? (
                        <EyeOff className="h-4.5 w-4.5" />
                      ) : (
                        <Eye className="h-4.5 w-4.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* New Password */}
                <div>
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                    New Password
                  </label>
                  <div className="relative mt-2">
                    <input
                      type={showNew ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full px-4 py-3 pr-11 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium text-zinc-900"
                      placeholder="Enter new password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNew(!showNew)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                    >
                      {showNew ? (
                        <EyeOff className="h-4.5 w-4.5" />
                      ) : (
                        <Eye className="h-4.5 w-4.5" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1.5">
                    Minimum 8 characters
                  </p>
                </div>

                {/* Confirm Password */}
                <div>
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                    Confirm New Password
                  </label>
                  <div className="relative mt-2">
                    <input
                      type={showConfirm ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full px-4 py-3 pr-11 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium text-zinc-900"
                      placeholder="Confirm new password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                    >
                      {showConfirm ? (
                        <EyeOff className="h-4.5 w-4.5" />
                      ) : (
                        <Eye className="h-4.5 w-4.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Submit Button */}
                <Button
                  onClick={handleSubmit}
                  disabled={
                    isSubmitting ||
                    !currentPassword ||
                    !newPassword ||
                    !confirmPassword
                  }
                  className="w-full h-12 rounded-xl font-bold text-base bg-zinc-900 hover:bg-zinc-800 text-white disabled:opacity-50"
                >
                  {isSubmitting ? "Updating..." : "Change Password"}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
