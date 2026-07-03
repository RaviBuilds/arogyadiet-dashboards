"use client";

// src/shared/components/customer/MobileNumberInput.tsx
// Premium mobile number input component with letter-spacing for better readability
// Modern UI/UX pattern used in WhatsApp, Telegram, and banking apps

import { useCallback } from "react";
import { cn } from "@/lib/utils";

interface MobileNumberInputProps {
  /** Current mobile number value (0-10 digits) */
  value: string;
  /** Called when the mobile number changes */
  onChange: (value: string) => void;
  /** Disable the input */
  disabled?: boolean;
  /** Auto-focus on mount */
  autoFocus?: boolean;
  /** Accessible label */
  label?: string;
  /** Input id */
  id?: string;
  /** Placeholder text */
  placeholder?: string;
}

export function MobileNumberInput({
  value,
  onChange,
  disabled = false,
  autoFocus = false,
  label = "Mobile number",
  id = "mobile-number",
  placeholder = "0000000000",
}: MobileNumberInputProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // Only accept digits, max 10
      const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
      onChange(digits);
    },
    [onChange],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pastedData = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 10);
      if (pastedData) {
        onChange(pastedData);
      }
    },
    [onChange],
  );

  return (
    <div className="relative">
      <input
        id={id}
        name="mobile"
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="tel"
        autoFocus={autoFocus}
        maxLength={10}
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onPaste={handlePaste}
        disabled={disabled}
        aria-label={label}
        className={cn(
          "w-full text-center font-bold tracking-[0.35em] transition-all duration-300",
          "h-16 rounded-xl border-2 shadow-sm",
          "text-2xl sm:text-3xl",
          "bg-white dark:bg-slate-800",
          "text-slate-900 dark:text-slate-100",
          "placeholder:text-slate-300 dark:placeholder:text-slate-600 placeholder:tracking-[0.35em]",
          "outline-none",
          // Border colors - using slate/gray as default
          "border-slate-300 dark:border-slate-600",
          // Focus states - no custom colors, just standard outline
          "focus:border-slate-400 dark:focus:border-slate-500",
          "focus:ring-2 focus:ring-slate-200 dark:focus:ring-slate-700",
          // Disabled state
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-slate-100 dark:disabled:bg-slate-900"
        )}
      />
    </div>
  );
}
