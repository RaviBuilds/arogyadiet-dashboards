import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function registerCustomer(data: {
  email: string;
  password: string;
  fullName: string;
  mobile: string;
}) {
  const supabase = await createClient();
  const adminAuthClient = createAdminClient();

  //1. create the User in supabase auth

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
  });

 
  if (authError) throw new Error(authError.message);
  if (!authData.user) throw new Error("Signup failed at auth layer");

  //2. get the Customer Role, ID using adminclient
  const { data: roleData, error:roleError } = await adminAuthClient
    .from("roles")
    .select("id")
    .eq("code", "CUSTOMER")
    .single();

 

  if (!roleData) {
    throw new Error("System configuration error: Role not found.");
  }

  // insert a data with adminClient
  const { data: userData, error: userError } = await adminAuthClient
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

  if (userError || !userData) {
   
    throw new Error(`Failed to create core user profile `);
  }

  // create a customer_profiles with admin
  const { error: profileError } = await adminAuthClient
    .from("customer_profiles")
    .insert({ user_id: userData?.id, is_active: true });

  if (profileError)
    throw new Error("Failed to create customer extension profile.");

  // NOTE (core-clinic-architecture, Req 6.1/6.7): signup does NOT create an
  // address inline — the profile is created without a Primary_Address pincode
  // here, so there is no clinic to resolve yet. The customer's `clinic_id` is
  // anchored to their Primary_Address and stamped later, in the same operation
  // that writes their first/updated address, by `stampCustomerByPrimaryAddress`
  // (which applies the pure `resolveCustomerStamp` decision) wired into
  // `addressActions.saveAddressAction`. Stamping here would be a no-op (no
  // primary address) and is intentionally omitted to preserve the existing
  // signup inputs/outputs/completion behavior (Req 6.8).

  return userData.id;
}

//OAuth missing profile Handler

export async function createCustomerFromOAth(
  authUserId: string,
  email: string,
  fullName: string,
) {
  // const supabase = await createClient();
  const adminAuthClientAuth = createAdminClient();

  const { data: roleData } = await adminAuthClientAuth
    .from("roles")
    .select("id")
    .eq("code", "CUSTOMER")
    .single();

  if (!roleData) {
    throw new Error("System configuration error: Role not found.");
  }

  const { data: userData, error: userError } = await adminAuthClientAuth
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

  if (userError || !userData) {
    console.error("🔥 ACTUAL DB ERROR:", userError);
    throw new Error(`DB Error: ${userError?.message || "Unknown"}`);
  }


  const { error: profileError } = await adminAuthClientAuth
    .from("customer_profiles")
    .insert({ user_id: userData.id, is_active: true });

  if (profileError) 
  {

    console.error("Profile Insert Error:", profileError);
    throw new Error("Failed to create OAuth customer profile.");

  }

  return userData.id;
}
