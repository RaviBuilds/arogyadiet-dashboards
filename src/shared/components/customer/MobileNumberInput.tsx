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
    <div className="relative flex items-center overflow-hidden rounded-2xl border-2 border-emerald-900/10 bg-white shadow-sm transition-all duration-300 focus-within:border-emerald-400 focus-within:shadow-[0_0_0_4px_rgba(16,185,129,0.12)]">
      {/* Country code chip — purely cosmetic; the field itself still only
          collects the 10-digit number, unchanged from prior behaviour. */}
      <span
        aria-hidden="true"
        className="flex h-16 shrink-0 items-center border-r border-emerald-900/10 bg-emerald-50/60 px-4 text-lg font-semibold text-emerald-700"
      >
        +91
      </span>
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
          "h-16 w-full min-w-0 flex-1 text-center font-semibold tracking-[0.3em] transition-colors",
          "text-xl sm:text-2xl",
          "bg-transparent text-slate-900",
          "placeholder:text-slate-300 placeholder:tracking-[0.3em]",
          "outline-none border-none",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
      />
    </div>
  );
}
