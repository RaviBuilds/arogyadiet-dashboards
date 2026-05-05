import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { format, parseISO } from "date-fns";
import {
  Phone,
  Mail,
  ShieldAlert,
  BadgeCheck,
  CalendarHeart,
} from "lucide-react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { RiderLogoutButton } from "@/modules/rider/components/rider-logout-button";

// Import your new Client Components!
import { RiderAvatarUpload } from "@/modules/rider/components/rider-avatar-upload";
import { EditProfileModal } from "@/modules/rider/components/edit-profile-modal";

export const revalidate = 0;

export default async function RiderProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (!user || authError) redirect("/rider/login");

  const { data: appUser } = await supabase
    .from("users")
    .select(
      `
      id, full_name, email, mobile, avatar_url,
      rider_profiles ( id, employee_code, joining_date, emergency_contact, is_active )
    `,
    )
    .eq("auth_user_id", user.id)
    .single();

  if (!appUser) redirect("/rider/login");

  const riderProfile = Array.isArray(appUser.rider_profiles)
    ? appUser.rider_profiles[0]
    : appUser.rider_profiles;

  const joinDate = riderProfile?.joining_date
    ? format(parseISO(riderProfile.joining_date), "MMMM do, yyyy")
    : "Unknown";

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 pb-20 md:pb-8">
      <div className="flex px-3 pt-2 flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">My Profile</h1>
          <p className="text-muted-foreground mt-1">
            Manage your personal details and account settings.
          </p>
        </div>
        <RiderLogoutButton />
      </div>

      <Card className="border-2 py-0 shadow-sm overflow-hidden">
        <div className="h-24 top-0 bg-zinc-900 w-full relative">
          {riderProfile?.is_active && (
            <div className="absolute top-4 right-4 bg-green-500/20 text-green-300 px-3 py-1 rounded-full text-xs font-bold uppercase flex items-center gap-1 backdrop-blur-sm border border-green-500/30">
              <BadgeCheck className="h-3.5 w-3.5 shrink-0" /> Active Partner
            </div>
          )}
        </div>
        <CardContent className="px-6 pb-6 pt-0 relative">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 -mt-12 mb-6">
            <div className="flex flex-col gap-3">
              {/* REPLACED THE STATIC AVATAR WITH THE NEW UPLOADER */}
              <RiderAvatarUpload
                userId={appUser.id}
                currentAvatar={appUser.avatar_url}
              />

              <div>
                <h2 className="text-2xl font-black text-zinc-900">
                  {appUser.full_name}
                </h2>
                <p className="text-sm font-bold text-zinc-400 uppercase tracking-wider">
                  Rider ID: {riderProfile?.employee_code || "PENDING"}
                </p>
              </div>
            </div>

            {/* REPLACED THE STATIC BUTTON WITH THE NEW MODAL */}
            <EditProfileModal
              riderProfileId={riderProfile.id}
              currentContact={riderProfile.emergency_contact}
            />
          </div>

          <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 flex items-center gap-4 mt-6">
            <div className="bg-orange-100 p-3 rounded-full text-orange-600 shrink-0">
              <CalendarHeart className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-orange-800">
                Delivering health since
              </p>
              <p className="text-lg font-black text-orange-900">{joinDate}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-2 shadow-sm">
        <CardContent className="p-0">
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-zinc-100">
            <div className="p-6 space-y-6">
              <h3 className="font-bold text-zinc-900 uppercase tracking-wider text-xs">
                Contact Details
              </h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  {/* ADDED shrink-0 TO PREVENT SQUISHING */}
                  <Phone className="h-5 w-5 text-zinc-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-zinc-500">
                      Mobile Number
                    </p>
                    <p className="font-bold text-zinc-900 mt-0.5">
                      {appUser.mobile || "Not provided"}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  {/* ADDED shrink-0 TO PREVENT SQUISHING */}
                  <Mail className="h-5 w-5 text-zinc-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-500">
                      Email Address
                    </p>
                    <p className="font-bold text-zinc-900 mt-0.5 truncate">
                      {appUser.email}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-6 bg-zinc-50/50">
              <h3 className="font-bold text-zinc-900 uppercase tracking-wider text-xs">
                Emergency Information
              </h3>
              <div className="flex items-start gap-3">
                {/* ADDED shrink-0 TO PREVENT SQUISHING */}
                <ShieldAlert className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-zinc-500">
                    Emergency Contact
                  </p>
                  <p className="font-bold text-zinc-900 mt-0.5">
                    {riderProfile?.emergency_contact || "Not setup yet"}
                  </p>
                  {!riderProfile?.emergency_contact && (
                    <p className="text-xs text-red-500 font-medium mt-1">
                      Please update your emergency contact for your safety.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
