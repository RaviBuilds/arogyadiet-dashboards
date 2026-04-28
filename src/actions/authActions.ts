'use server';
import { AuthService } from "@/services/AuthService";
import { redirect } from "next/navigation";

export async function LoginAction(prevState: any, formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const portalRole = formData.get("portalRole") as string;
  const redirectPath = formData.get("redirectPath") as string;

  try {
    await AuthService.login(email, password, portalRole);
  } catch (error: any) {
    return { error: error.message };
  }
  redirect(redirectPath);
}