'use server';

import { redirect } from "next/navigation";
import { sendPasswordResetEmail,updateUserPassword ,login} from "@/services/AuthService";
import { headers } from "next/headers";
export async function LoginAction(prevState: any, formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const portalRole = formData.get("portalRole") as string;
  const redirectPath = formData.get("redirectPath") as string;

  try {
    await login(email, password, portalRole);
  } catch (error: any) {
    return { error: error.message };
  }
  redirect(redirectPath);
}

//forgot password section

export async function forgotPasswordAction(prevState: any, formData: FormData) {
  const email = formData.get("email") as string;
  

  const headerList = await headers();
  const host = headerList.get("host");

  const protocol = host?.includes("localhost") ? "http" : "https";

  // Point to the new recovery route! No ?next= parameter required.
  const exactRedirectUrl = `${protocol}://${host}/api/auth/recovery`;

  

  if (!email) {
    return { error: "Email is required!" };
  }
  try {
    await sendPasswordResetEmail(email, exactRedirectUrl);
    return { success: "Check your email for a password reset link." };
  } catch (error: any) {
    return { error: error.message };
  }
}

//update the password 


export async function updatePasswordAction(prevState:any, formData:FormData) {
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if(password !== confirmPassword)
  {
    return { error: "Password do not match."}
  }
  if(password.length < 8)
  {
    return {error:"Password must be at least 8 characters long."}
  }

  try {
    await updateUserPassword(password);
  } catch (error:any) {
     return {error:error.message}
  }
  redirect("/dashboard");
}