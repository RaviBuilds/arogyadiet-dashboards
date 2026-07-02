"use client";

// src/app/customer/(auth)/login/CustomerLoginView.tsx
// Client wrapper that manages view state between PIN login and set-new-pin.
// When verifyPinAction returns TEMP_PIN, this component switches to the
// SetNewPinForm so the customer can choose a permanent PIN before accessing
// the dashboard.
//
// Requirements: 2.3, 2.7, 2.8, 2.9, 3.2

import { useState } from "react";

import { MobilePinLoginForm } from "@/shared/components/customer/MobilePinLoginForm";
import { SetNewPinForm } from "@/shared/components/customer/SetNewPinForm";

type View = "login" | "set-new-pin";

interface CustomerLoginViewProps {
  /** Where to redirect after successful login or PIN set. */
  redirectPath?: string;
}

export function CustomerLoginView({
  redirectPath = "/dashboard",
}: CustomerLoginViewProps) {
  const [view, setView] = useState<View>("login");
  const [mobile, setMobile] = useState("");

  const handleTempPin = (m: string) => {
    setMobile(m);
    setView("set-new-pin");
  };

  if (view === "set-new-pin") {
    return (
      <SetNewPinForm mobile={mobile} redirectPath={redirectPath} />
    );
  }

  return (
    <MobilePinLoginForm
      redirectPath={redirectPath}
      onTempPin={handleTempPin}
    />
  );
}
