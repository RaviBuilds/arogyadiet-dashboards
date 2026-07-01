"use server";

import { redirect } from "next/navigation";

// Customer self-service signup is disabled (Req 1.4, 1.5).
//
// This action no longer creates any account record. Even if invoked directly
// (bypassing the UI), it neither creates nor authenticates an account and
// simply redirects the caller to the mobile login screen. Account creation is
// admin-initiated only; the legacy 3-step admin customer-creation flow remains
// available and untouched (Req 4.8).
export async function customerSignupAction(
  _prevState: unknown,
  _formData: FormData,
) {
  void _prevState;
  void _formData;
  redirect("/login");
}
