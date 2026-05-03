import { createClient } from "@/lib/supabase/server";

export async function login(
  email: string,
  password: string,
  expectedRole: string,
) {
  const supabase = await createClient();

  // 1. Authenticate with supabase auth
  const { data: authData, error: authError } =
    await supabase.auth.signInWithPassword({
      email,
      password,
    });

  if (authError) throw new Error(authError.message);
  if (!authData.user) throw new Error("Login failed !");

  // 2. Fetch user metadata and verify Role / Active status
  const { data: userData, error: userError } = await supabase
    .from("users")
    .select(`is_active, roles(code)`)
    .eq(`auth_user_id`, authData.user.id)
    .single();


  if (userError || !userData) {
    await supabase.auth.signOut();
    throw new Error("User profile setup incomplete.");
  }

  // 3. Check if account is active
  if (!userData.is_active) {
    await supabase.auth.signOut();
    throw new Error(
      "Your account has been deactivated please contact support!",
    );
  }

  // Safely extract the role code
  const userRole = Array.isArray(userData.roles)
    ? userData.roles[0]?.code
    : (userData.roles as { code: string })?.code;

  // 4. Portal boundary check
  if (userRole !== expectedRole) {
    await supabase.auth.signOut();
    throw new Error(
      `Unauthorized. This portal is restricted to ${expectedRole}`,
    );
  }

  return authData.user;
}


export async function sendPasswordResetEmail(email: string, redirectUrl: string) {
  const supabase = await createClient();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: redirectUrl,
  });
  if (error) {
    throw new Error(error.message);
  }
  return true;
}

export async function updateUserPassword(password:string)
{
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password:password
  })
  if(error)
  {
    throw new Error(error.message);
  }

  return true;
}