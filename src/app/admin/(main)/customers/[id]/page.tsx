import { createClient as createAdminClient } from "@supabase/supabase-js";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Customer360Dashboard } from "@/shared/components/admin/customers/Customer360Dashboard";
import { Button } from "@/shared/components/ui/button";
import { ChevronLeft } from "lucide-react";

interface CustomerProfile {
  userId: string;
  id: string;
  full_name: string;
  email: string;
  mobile: string;
  gender: string;
  date_of_birth: string;
  dietary_preference: string;
  allergies: string;
  medical_history_notes: string;
  has_medical_history: boolean;
  addresses: {
    id: string;
    address_line_1: string;
    address_line_2: string;
    city: string;
    state: string;
    pincode: string;
    is_default: boolean;
  }[];
  medical_documents: {
    id: string;
    file_name: string;
    storage_path: string;
    uploaded_at: string;
    signedUrl?: string; // Added for secure viewing
  }[];
  subscriptions: {
    id: string;
    status: string;
    starts_on: string;
    ends_on: string;
    subscription_plans: {
      name: string;
    };
  }[];
}

export default async function Customer360Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 1. USE ADMIN CLIENT TO SECURELY BYPASS RLS
  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data, error } = await supabaseAdmin
    .from("customer_profiles")
    .select(
      `
      id,
      is_active,
      dietary_preference,
      gender,
      date_of_birth,
      allergies,
      medical_history_notes,
      has_medical_history,
      users!inner ( id, full_name, email, mobile ),
      addresses ( id, tag, street_1, street_2, city, pincode, is_primary ),
      medical_documents ( id, file_name, storage_path, uploaded_at, file_size_bytes ),
      subscriptions ( id, status, starts_on, ends_on, subscription_plans ( name ) )
      `,
    )
    .eq("id", id)
    .single();

  if (error || !data) {
    console.error("Error fetching customer profile:", error);
    notFound();
  }

  // 2. GENERATE SECURE SIGNED URLS FOR MEDICAL DOCUMENTS
  let documentsWithUrls: any[] = [];
  if (data.medical_documents && data.medical_documents.length > 0) {
    documentsWithUrls = await Promise.all(
      data.medical_documents.map(async (doc: any) => {
        const { data: urlData } = await supabaseAdmin.storage
          .from("medical_records")
          .createSignedUrl(doc.storage_path, 3600); // 1 hour expiry

        return {
          id: doc.id,
          file_name: doc.file_name,
          storage_path: doc.storage_path,
          uploaded_at: doc.uploaded_at,
          signedUrl: urlData?.signedUrl || null,
        };
      }),
    );
  }

  // 3. FIX USERS MAPPING (It's an object, not an array)
  const userData = data.users as any;

  const customerData: CustomerProfile = {
    userId: userData?.id || "",
    id: data.id,
    full_name: userData?.full_name || "N/A",
    email: userData?.email || "N/A",
    mobile: userData?.mobile || "N/A",
    gender: data.gender || "N/A",
    date_of_birth: data.date_of_birth || "N/A",
    dietary_preference: data.dietary_preference || "N/A",
    allergies: data.allergies || "None",
    medical_history_notes: data.medical_history_notes || "N/A",
    has_medical_history: data.has_medical_history || false,
    addresses:
      data.addresses?.map((addr: any) => ({
        id: addr.id,
        address_line_1: addr.street_1,
        address_line_2: addr.street_2,
        city: addr.city,
        state: "N/A",
        pincode: addr.pincode,
        is_default: addr.is_primary,
      })) || [],
    medical_documents: documentsWithUrls,
    subscriptions:
      data.subscriptions?.map((sub: any) => ({
        id: sub.id,
        status: sub.status,
        starts_on: sub.starts_on,
        ends_on: sub.ends_on,
        subscription_plans: {
          name: sub.subscription_plans?.name || "N/A",
        },
      })) || [],
  };

  return (
    <div className="flex flex-col gap-8">
      <AdminPageHeader
        title={`${customerData.full_name}'s Profile`}
        description="Manage the Customer"
        action={
          <Button variant="outline" asChild>
            <Link href="/customers">
              <ChevronLeft className="h-4 w-4 mr-2" /> Back to Directory
            </Link>
          </Button>
        }
      />
      <Customer360Dashboard customer={customerData} />
    </div>
  );
}
