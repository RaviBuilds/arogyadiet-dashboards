"use client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useActionState, useState } from "react";
import { LoginAction } from "@/actions/authActions"; // Assuming the action location
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

interface LoginFormProps extends React.ComponentProps<"div"> {
  socialLogin?: boolean;
  formTitle?: string;
  portalRole: string;
  redirectPath: string;
}

export function LoginForm({
  className,
  socialLogin = false,
  formTitle = "Login",
  portalRole,
  redirectPath = "/dashboard",
  ...props
}: LoginFormProps) {


  const [state, formAction, isPending] = useActionState(LoginAction, null);
  const [isGoogleLoadig, setIsGoogleLoading] = useState(false);


  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true);
    const supabase = createClient();

  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      // Redirect to our callback route, and pass the intended destination
      redirectTo: `${window.location.origin}/api/auth/callback?next=${redirectPath}`,
      // We can pass metadata to enforce they are signing up as a specific role
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{formTitle}</CardTitle>
          {socialLogin && (
            <CardDescription>Login with your Google account</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <form action={formAction}>
            <FieldGroup>
              {/* configure the input for the server */}
              <input type="hidden" name="portalRole" value={portalRole} />
              <input type="hidden" name="redirectPath" value={redirectPath} />

              {socialLogin && (
                <Field>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={isGoogleLoadig || isPending}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                      <path
                        d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                        fill="currentColor"
                      />
                    </svg>
                    {isGoogleLoadig ? "Connecting ...." : "Login with Google"}
                  </Button>
                </Field>
              )}
              {socialLogin && (
                <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                  Or continue with
                </FieldSeparator>
              )}
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                />
              </Field>
              <Field>
                <div className="flex items-center">
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <Link
                    href="#"
                    className="ml-auto text-sm underline-offset-4 hover:underline"
                  >
                    Forgot your password?
                  </Link>
                </div>
                <Input id="password" name="password" type="password" required />
              </Field>

              {state?.error && (
                <div className="text-sm text-red-500 text-center font-medium">
                  {state.error}
                </div>
              )}

              <Field>
                <Button type="submit" disabled={isPending || isGoogleLoadig}>
                  {isPending ? "Logging in..." : "Login"}
                </Button>
                <FieldDescription className="text-center">
                  Don&apos;t have an account? <Link href="/signup">Sign up</Link>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <FieldDescription className="px-6 text-center">
        By clicking continue, you agree to our <Link href="#">Terms of Service</Link>{" "}
        and <Link href="#">Privacy Policy</Link>.
      </FieldDescription>
    </div>
  );
}
