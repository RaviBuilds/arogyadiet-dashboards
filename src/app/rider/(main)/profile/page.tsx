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
import { RiderLogoutButton } from "@/shared/components/rider/rider-logout-button";

// Import your new Client Components!
import { RiderAvatarUpload } from "@/shared/components/rider/rider-avatar-upload";
import { EditProfileModal } from "@/shared/components/rider/edit-profile-modal";
import { ChangePasswordModal } from "@/shared/components/rider/change-password-modal";

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
      <div className="flex flex-row justify-between gap-4 px-3 pt-2 sm:items-center">
        <div>
          <h1 className="text-3xl font-black text-zinc-900">My Profile</h1>
          <p className="mt-1 font-medium text-muted-foreground">
            Manage your personal details and account settings.
          </p>
        </div>
        <RiderLogoutButton />
      </div>

      <Card className="overflow-hidden rounded-2xl border border-zinc-100 py-0 shadow-sm">
        {/* Brand banner — dark, premium base (keeps the original's
            sophistication) with the brand red worked in as a warm glow
            rather than a flat saturated fill, so it reads as refined instead
            of alarming/promotional. */}
        <div className="relative h-24 w-full overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-900 to-red-950">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-10 -left-6 h-40 w-40 rounded-full bg-[#e74c3c]/30 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-8 -top-12 h-32 w-32 rounded-full bg-amber-400/10 blur-3xl"
          />
          {riderProfile?.is_active && (
            <div className="absolute top-4 right-4 flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold uppercase text-emerald-300 backdrop-blur-sm">
              <BadgeCheck className="h-3.5 w-3.5 shrink-0" /> Active Partner
            </div>
          )}
        </div>
        <CardContent className="relative px-6 pt-0 pb-6">
          <div className="mb-6 -mt-12 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
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
                <p className="text-sm font-bold uppercase tracking-wider text-zinc-400">
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

          <div className="mt-6 flex items-center gap-4 rounded-xl border border-orange-100 bg-orange-50 p-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-600 ring-8 ring-orange-50/40">
              <CalendarHeart className="h-5 w-5" />
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

      <Card className="rounded-2xl border border-zinc-100 shadow-sm">
        <CardContent className="p-0">
          <div className="grid grid-cols-1 divide-y divide-zinc-100 md:grid-cols-2 md:divide-y-0 md:divide-x">
            <div className="space-y-6 p-6">
              <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-400">
                <span className="h-3.5 w-1 rounded-full bg-[#e74c3c]" aria-hidden="true" />
                Contact Details
              </h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-50 text-zinc-400">
                    <Phone className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-500">
                      Mobile Number
                    </p>
                    <p className="mt-0.5 font-bold text-zinc-900">
                      {appUser.mobile || "Not provided"}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-50 text-zinc-400">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-500">
                      Email Address
                    </p>
                    <p className="mt-0.5 truncate font-bold text-zinc-900">
                      {appUser.email}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col justify-between bg-zinc-50/50 p-6">
              <div className="space-y-6">
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-400">
                  <span className="h-3.5 w-1 rounded-full bg-[#e74c3c]" aria-hidden="true" />
                  Emergency Info
                </h3>
                <div className="flex items-start justify-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500">
                    <ShieldAlert className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-500">
                      Emergency Contact
                    </p>
                    <p className="mt-0.5 font-bold text-zinc-900">
                      {riderProfile?.emergency_contact || "Not setup yet"}
                    </p>
                    {!riderProfile?.emergency_contact && (
                      <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-red-100 bg-red-50 px-2.5 py-2 text-xs font-medium text-red-600">
                        Please update your emergency contact for your safety.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <ChangePasswordModal />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
