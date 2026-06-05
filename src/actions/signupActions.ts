"use server";

import { registerCustomer } from "@/services/signupService";
import {
  buildPushPayload,
  notifyAdmins,
  sendNotificationToUser,
} from "@/lib/notifications";
import { redirect } from "next/navigation";

export async function customerSignupAction(prevState:any, formData:FormData){
    const email = formData.get('email') as string;
    const password = formData.get("password") as string;
    const fullName = formData.get("fullName") as string;
    const mobile = formData.get("mobile") as string;

    try {
        const newUserId = await registerCustomer({email, password, fullName, mobile});

        const welcomeTitle = "Welcome to ArogyaDiet!";
        const welcomeMessage = "Welcome to ArogyaDiet!";

        await sendNotificationToUser(newUserId, {
            title: welcomeTitle,
            message: welcomeMessage,
            actionUrl: "/customer/profile",
            sendEmail: true,
            ...buildPushPayload(welcomeTitle, welcomeMessage, `welcome-${newUserId}`),
        });

        const adminTitle = "New Customer Signup";
        const adminMessage = `Hi Admin, please check the new customer has signed up, customer name - ${fullName}`;

        await notifyAdmins({
            title: adminTitle,
            message: adminMessage,
            actionUrl: "/admin/customers",
            sendEmail: true,
            emailStrategy: "shared",
            ...buildPushPayload(adminTitle, adminMessage, `signup-admin-${newUserId}`),
        });
    } catch (error:any) {
        return {error: error.message}
    }
    redirect(`/signup/success`);
}
