"use server";

import { registerCustomer } from "@/services/signupService";
import { redirect } from "next/navigation";

export async function customerSignupAction(prevState:any, formData:FormData){
    const email = formData.get('email') as string;
    const password = formData.get("password") as string;
    const fullName = formData.get("fullName") as string;
    const mobile = formData.get("mobile") as string;

    try {
        await registerCustomer({email, password, fullName, mobile})
    } catch (error:any) {
        console.log("ERROR in signup=>", error);
        return {error: error.message}
    }
    redirect(`/signup/success`);
}