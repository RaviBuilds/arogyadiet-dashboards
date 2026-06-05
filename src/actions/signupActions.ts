"use server";

import { registerCustomer } from "@/services/signupService";
import { notifyAdmins, sendNotificationToUser } from "@/lib/notifications";
import { redirect } from "next/navigation";

export async function customerSignupAction(prevState:any, formData:FormData){
    const email = formData.get('email') as string;
    const password = formData.get("password") as string;
    const fullName = formData.get("fullName") as string;
    const mobile = formData.get("mobile") as string;

    try {
        const newUserId = await registerCustomer({email, password, fullName, mobile});

        await sendNotificationToUser(newUserId, {
            title: "Welcome to ArogyaDiet!",
            message: "Welcome to ArogyaDiet! Please complete your profile.",
            actionUrl: "/customer/profile",
            sendEmail: true,
        });

        await notifyAdmins({
            title: "New Customer Signup",
            message: "A new customer has signed up.",
            actionUrl: "/admin/customers",
            sendEmail: true,
            emailStrategy: "shared",
        });
    } catch (error:any) {
        return {error: error.message}
    }
    redirect(`/signup/success`);
}
