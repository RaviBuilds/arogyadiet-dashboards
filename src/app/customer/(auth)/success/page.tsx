// src/app/signup/success/page.tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react"; // Changed icon to a success checkmark

export default function SignupSuccessPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-muted/30">
      <Card className="max-w-md w-full text-center shadow-lg border-muted">
        <CardHeader className="space-y-4">
          <div className="flex justify-center">
            <div className="h-20 w-20 bg-primary/10 rounded-full flex items-center justify-center">
              <CheckCircle2
                className="h-10 w-10 text-primary"
                strokeWidth={1.5}
              />
            </div>
          </div>
          <CardTitle className="text-2xl font-semibold tracking-tight">
            Account Created Successfully!
          </CardTitle>
          <CardDescription className="text-base">
            Welcome to Arogyadiet. Your account is ready to go.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Your registration was successful. You can now sign in to access your
            dashboard and start managing your diet plans.
          </p>
          <Button asChild className="w-full h-11 text-base font-medium">
            <Link href="/login">Sign In Now</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
