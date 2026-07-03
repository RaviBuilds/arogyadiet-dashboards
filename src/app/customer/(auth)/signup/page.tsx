import { redirect } from "next/navigation";

// Customer self-service signup is disabled (Req 1.4).
//
// In the mobile-first, admin-initiated onboarding model, customer accounts are
// created ONLY by an admin (quick onboarding or the retained legacy 3-step
// admin flow — Req 4.8). Any HTTP request to the customer signup route is
// redirected to the mobile login screen WITHOUT creating any account record.
export default function SignupPage() {
  redirect("/login");
}
