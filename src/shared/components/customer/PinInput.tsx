"use client";

// src/shared/components/customer/PinInput.tsx
// Reusable 6-digit PIN input component for the Customer Portal PIN auth flow.
// Six individual digit boxes with auto-advance, backspace navigation, and paste support.
// Requirements: 13.3, 3.5

import { useCallback, useEffect, useRef } from "react";

const PIN_LENGTH = 6;

interface PinInputProps {
  /** Current 6-digit value (or partial). Source of truth for the controlled component. */
  value: string;
  /** Called with the updated PIN string whenever any digit changes. */
  onChange: (value: string) => void;
  /** Disable all digit boxes. */
  disabled?: boolean;
  /** Auto-focus the first box on mount. */
  autoFocus?: boolean;
  /** Accessible label for the input group. Defaults to "PIN". */
  label?: string;
  /** Optional id prefix for the input group. */
  id?: string;
}

export function PinInput({
  value,
  onChange,
  disabled = false,
  autoFocus = true,
  label = "PIN",
  id = "pin-input",
}: PinInputProps) {
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  // Split the value into individual digits for each box
  const digits = value.padEnd(PIN_LENGTH, "").slice(0, PIN_LENGTH).split("");

  // Auto-focus first input on mount
  useEffect(() => {
    if (autoFocus && !disabled) {
      inputsRef.current[0]?.focus();
    }
  }, [autoFocus, disabled]);

  const focusInput = useCallback((index: number) => {
    if (index >= 0 && index < PIN_LENGTH) {
      inputsRef.current[index]?.focus();
      inputsRef.current[index]?.select();
    }
  }, []);

  const updateValue = useCallback(
    (newDigits: string[]) => {
      const joined = newDigits.join("").slice(0, PIN_LENGTH);
      onChange(joined);
    },
    [onChange],
  );

  const handleChange = useCallback(
    (index: number, inputValue: string) => {
      // Only accept single digit 0-9
      const digit = inputValue.replace(/\D/g, "").slice(-1);
      if (!digit) return;

      const newDigits = [...digits];
      newDigits[index] = digit;
      updateValue(newDigits);

      // Auto-advance to next box
      if (index < PIN_LENGTH - 1) {
        focusInput(index + 1);
      }
    },
    [digits, updateValue, focusInput],
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Backspace") {
        e.preventDefault();
        const newDigits = [...digits];
        if (digits[index]) {
          // Clear current box
          newDigits[index] = "";
          updateValue(newDigits);
        } else if (index > 0) {
          // Move to previous box and clear it
          newDigits[index - 1] = "";
          updateValue(newDigits);
          focusInput(index - 1);
        }
      } else if (e.key === "ArrowLeft" && index > 0) {
        e.preventDefault();
        focusInput(index - 1);
      } else if (e.key === "ArrowRight" && index < PIN_LENGTH - 1) {
        e.preventDefault();
        focusInput(index + 1);
      }
    },
    [digits, updateValue, focusInput],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pastedData = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, PIN_LENGTH);
      if (!pastedData) return;

      const newDigits = pastedData.padEnd(PIN_LENGTH, "").split("").slice(0, PIN_LENGTH);
      // Only fill with actual digits, leave rest empty
      const filled = newDigits.map((d) => (/^\d$/.test(d) ? d : ""));
      updateValue(filled);

      // Focus the next empty box, or the last box if all filled
      const nextEmpty = filled.findIndex((d) => d === "");
      focusInput(nextEmpty >= 0 ? nextEmpty : PIN_LENGTH - 1);
    },
    [updateValue, focusInput],
  );

  const handleFocus = useCallback((index: number) => {
    inputsRef.current[index]?.select();
  }, []);

  return (
    <div
      role="group"
      aria-label={label}
      id={id}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
        padding: "20px 0",
        width: "100%",
      }}
    >
      {Array.from({ length: PIN_LENGTH }, (_, index) => (
        <input
          key={index}
          ref={(el) => {
            inputsRef.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          aria-label={`${label} digit ${index + 1}`}
          id={`${id}-digit-${index + 1}`}
          value={digits[index] || ""}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          onFocus={() => handleFocus(index)}
          disabled={disabled}
          autoComplete="off"
          style={{
            minWidth: "48px",
            maxWidth: "48px",
            width: "48px",
            minHeight: "58px",
            maxHeight: "58px",
            height: "58px",
            fontSize: "26px",
            fontWeight: "700",
            lineHeight: "58px",
            textAlign: "center",
            verticalAlign: "middle",
            border: "2px solid rgba(5, 150, 105, 0.18)",
            borderRadius: "16px",
            backgroundColor: digits[index] ? "rgba(236, 253, 245, 0.6)" : "#ffffff",
            color: "#064e3b",
            outline: "none",
            transition: "all 0.2s ease",
            boxShadow: "0 2px 6px rgba(4, 40, 26, 0.06)",
            boxSizing: "border-box",
            margin: "0",
            padding: "0",
            display: "block",
          }}
          onFocusCapture={(e) => {
            e.currentTarget.style.borderColor = "#10b981";
            e.currentTarget.style.boxShadow = "0 0 0 4px rgba(16, 185, 129, 0.15), 0 2px 6px rgba(4, 40, 26, 0.06)";
            e.currentTarget.style.transform = "scale(1.05)";
          }}
          onBlurCapture={(e) => {
            e.currentTarget.style.borderColor = "rgba(5, 150, 105, 0.18)";
            e.currentTarget.style.boxShadow = "0 2px 6px rgba(4, 40, 26, 0.06)";
            e.currentTarget.style.transform = "scale(1)";
          }}
        />
      ))}
    </div>
  );
}
