import { createClient } from "@/lib/supabase/server";

export async function registerCustomer(data: {
  email: string;
  password: string;
  fullName: string;
  mobile: string;
}) {
  const supabase = await createClient();

  const { data: roleData } = await supabase
    .from("roles")
    .select("id")
    .eq("code", "CUSTOMER")
    .single();

  if (!roleData) {
    throw new Error("System configuration error: Role not found.");
  }

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
  });

  if (authError) throw new Error(authError.message);
  if (!authData.user) throw new Error("Signup failed at auth layer");

  const { data: userData, error: userError } = await supabase
    .from("users")
    .insert({
      auth_user_id: authData.user.id,
      role_id: roleData.id,
      full_name: data.fullName,
      email: data.email,
      mobile: data.mobile,
      is_active: true,
    })
    .select("id")
    .single();

  if (userError || !userData)
    throw new Error(`Failed to create core user profile `);

  const { error: profileError } = await supabase
    .from("customer_profiles")
    .insert({ user_id: userData.id, is_active: true });

  if (profileError)
    throw new Error("Failed to create customer extension profile.");

  return authData.user;
}

//OAuth missing profile Handler

export async function createCustomerFromOAth(
  authUserId: string,
  email: string,
  fullName: string,
) {

    const supabase = await createClient();

     const { data: roleData } = await supabase
       .from("roles")
       .select("id")
       .eq("code", "CUSTOMER")
       .single();

     if (!roleData) {
       throw new Error("System configuration error: Role not found.");
     }
     
     const { data: userData, error: userError } = await supabase
       .from("users")
       .insert({
         auth_user_id: authUserId,
         role_id: roleData.id,
         full_name: fullName || "Google User",
         email: email,
         mobile: null,
         is_active: true,
         is_email_verified: true,
       })
       .select("id")
       .single();

       if (userError || !userData)
         throw new Error("Failed to create OAuth user profile.");

       const { error: profileError } = await supabase
         .from("customer_profiles")
         .insert({ user_id: userData.id, is_active: true });

       if (profileError)
         throw new Error("Failed to create OAuth customer profile.");

       return true;
}
