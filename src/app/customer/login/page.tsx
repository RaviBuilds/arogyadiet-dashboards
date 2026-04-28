import { LoginForm } from "@/shared/components/forms/login-form";
import Image from "next/image";

export default function CustomerLogin() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <a href="#" className="flex items-center gap-2 self-center font-medium">
          <Image
            src="/logo.png"
            alt="Arogyadiet"
            width={180}
            height={60}
            priority
            className="h-auto w-auto"
          />
        </a>
        <LoginForm
          socialLogin={true}
          formTitle="Customer Portal"
          portalRole="CUSTOMER"
          redirectPath="/customer/dashboard"
        />
      </div>
    </div>
  );
}
