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
import { LoginAction } from "@/actions/authActions";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";

interface LoginFormProps extends React.ComponentProps<"div"> {
  socialLogin?: boolean;
  formTitle?: string;
  portalRole?: string;
  redirectPath?: string;
  showSignup?: boolean;
  showForgotPassword?: boolean;
}

export function LoginForm({
  className,
  socialLogin = false,
  formTitle = "Login",
  portalRole,
  redirectPath = "/dashboard",
  showSignup,
  showForgotPassword = true,
  ...props
}: LoginFormProps) {
  const [state, formAction, isPending] = useActionState(LoginAction, null);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true);
    try {
      const supabase = createClient();

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback?next=${redirectPath}`,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });

      if (error) throw error;
    } catch (error) {
      console.error("Google authentication error:", error);
      setIsGoogleLoading(false);
    }
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
              <input type="hidden" name="portalRole" value={portalRole} />
              <input type="hidden" name="redirectPath" value={redirectPath} />

              {socialLogin && (
                <Field>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={isGoogleLoading || isPending}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                      <path
                        d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                        fill="currentColor"
                      />
                    </svg>
                    {isGoogleLoading ? "Connecting ...." : "Login with Google"}
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
                  {showForgotPassword && (
                    <Link
                      href="forgot-password"
                      className="ml-auto text-sm underline-offset-4 hover:underline text-primary"
                    >
                      Forgot your password?
                    </Link>
                  )}
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </Field>

              {state?.error && (
                <div className="text-sm text-red-500 text-center font-medium">
                  {state.error}
                </div>
              )}

              <Field>
                <Button type="submit" disabled={isPending || isGoogleLoading}>
                  {isPending ? "Logging in..." : "Login"}
                </Button>

                {/* CONDITIONAL SIGNUP RENDER */}
                {showSignup && (
                  <FieldDescription className="text-center mt-2">
                    Don&apos;t have an account?{" "}
                    <Link
                      href="signup"
                      className="text-primary hover:underline"
                    >
                      Sign up
                    </Link>
                  </FieldDescription>
                )}
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      {showSignup && (
        <FieldDescription className="px-6 text-center">
          By clicking continue, you agree to our{" "}
          <Link href="#" className="underline">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="#" className="underline">
            Privacy Policy
          </Link>
          .
        </FieldDescription>
      )}
    </div>
  );
}
