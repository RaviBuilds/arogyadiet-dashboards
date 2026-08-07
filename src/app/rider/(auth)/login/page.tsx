import { RiderLoginForm } from "@/shared/components/rider/RiderLoginForm";
import { AppDownloadQrBlock } from "@/shared/components/app-download/AppDownloadQrBlock";

export default async function RiderLogin() {
  return (
    <div className="relative flex min-h-svh w-full items-center justify-center overflow-hidden bg-gradient-to-br from-red-50/60 via-white to-amber-50/50 p-5 sm:p-6">
      {/* Ambient background — on-brand red/amber wash (matches --primary),
          same visual grammar as the customer portal's wellness glow so the
          two portals read as one product family. Purely decorative. */}
      <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-red-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-20 h-80 w-80 rounded-full bg-amber-100/50 blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[460px] w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.9)_0%,rgba(255,255,255,0)_70%)]" />

      {/* Main login panel — centered, full width on mobile */}
      <div className="relative z-10 flex w-full max-w-[400px] flex-col items-center gap-6">
        <RiderLoginForm
          formTitle="Delivery Partner Portal"
          portalRole="RIDER"
          redirectPath="/dashboard"
        />

        <p className="text-center text-xs font-medium text-slate-400">
          ArogyaDiet Delivery Partner Portal — keeping every delivery on
          track.
        </p>
      </div>

      {/* QR code panel — large viewports only (Req 13.2, 13.3-13.6).
          Positioned rather than in flow: as an in-flow sibling of the login card
          inside a `justify-center` row, it centred the card-plus-QR pair as a
          group and left the login card visibly off-centre. Taking it out of flow
          keeps the card centred on the viewport, which is the axis the eye
          actually reads, while the code sits alongside it.

          At the `lg` breakpoint the centred 400px card ends around x=712 and this
          panel starts near x=772, so the two never collide. */}
      <div className="absolute right-6 top-1/2 z-10 hidden -translate-y-1/2 lg:block xl:right-12">
        <AppDownloadQrBlock
          slug="rider"
          size={160}
          showUrl={false}
          className="rounded-2xl border border-slate-200/70 bg-white/80 p-6 text-center text-slate-600 shadow-sm backdrop-blur-sm"
          frameClassName="mx-auto"
        />
      </div>
    </div>
  );
}
