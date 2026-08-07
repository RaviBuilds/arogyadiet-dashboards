// src/app/customer/(auth)/login/LoginBrandPanel.tsx
// The emotional "front door" of the ArogyaDiet customer portal — desktop/tablet
// only (mobile shows just the login card, per design). Purely presentational,
// server-rendered, no interactivity, so it carries zero auth/business logic.
//
// Visual language deliberately mirrors the rest of the customer portal (see
// MealsHero / TransformationStories): forest-green → mint, warm cream and
// amber accents, low-opacity botanical line art, soft radial glow — so the
// login screen reads as the first page of the same story rather than a
// generic admin-style form.

import Image from "next/image";
import { Sprout, ChefHat, Package, Leaf } from "lucide-react";
import { AppDownloadQrBlock } from "@/shared/components/app-download/AppDownloadQrBlock";

// Feature points shown on the brand panel. ArogyaDiet serves three customer
// categories through this one portal — MEAL (recurring chef-prepared deliveries),
// KIT (one-time ready-to-eat nutrition programs tracked day by day) and
// ACCOMMODATION (on-site wellness stays with meals + health monitoring). Each
// point represents one line so no customer type feels excluded, while the
// shared wellness voice keeps them under one brand. No invented statistics.
const FEATURES = [
  {
    icon: ChefHat,
    title: "Fresh meals, delivered daily",
    copy: "Chef-prepared, nutrition-focused meals brought to your door.",
  },
  {
    icon: Package,
    title: "Nutrition kits to follow at home",
    copy: "Ready-to-eat programs you track day by day, at your own pace.",
  },
  {
    icon: Leaf,
    title: "Wellness stays with care",
    copy: "Restorative stays with meals and daily health monitoring.",
  },
] as const;

export async function LoginBrandPanel() {
  return (
    // Height is pinned to the viewport and the content scales down at `lg` so
    // the whole story fits a laptop screen without the page ever scrolling.
    <div
      className="reveal-rise relative hidden w-1/2 shrink-0 overflow-hidden bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-800 lg:flex lg:h-svh lg:flex-col lg:justify-between lg:gap-[clamp(0.5rem,2svh,1.5rem)] lg:px-10 lg:py-[clamp(1.25rem,3svh,4rem)] xl:px-14 2xl:px-16"
      style={{ ["--reveal-delay" as string]: "0ms" }}
    >
      {/* ── Ambient glow wells (stronger — they carry the depth) ───────── */}
      <div className="pointer-events-none absolute -left-24 -top-28 h-80 w-80 rounded-full bg-emerald-400/30 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-96 w-96 translate-x-1/4 translate-y-1/4 rounded-full bg-amber-300/20 blur-3xl" />
      <div className="pointer-events-none absolute left-1/3 top-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-lime-300/20 blur-3xl" />

      {/* ── Botanical line-art backdrop, now actually visible ─────────── */}
      <BotanicalLineArt />

      {/* One-time morning-light sweep, shared with the rest of the app-open
          choreography (gated behind `.app-intro`, resting/invisible otherwise). */}
      <div className="hero-sheen pointer-events-none absolute inset-y-0 -left-1/3 z-10 w-1/3 bg-gradient-to-r from-transparent via-white/12 to-transparent" />

      {/* ── Logo, integrated into the story (wordmark, not a sticker) ──── */}
      <div className="relative z-10 flex items-center">
        <Image
          src="/logo.png"
          alt="ArogyaDiet"
          width={150}
          height={50}
          priority
          className="h-auto w-[clamp(6rem,13svh,9.5rem)] drop-shadow-[0_2px_10px_rgba(0,0,0,0.35)] brightness-0 invert"
        />
      </div>

      {/* ── Middle group: headline + features, kept together for a calm,
             intentional vertical rhythm (no loose justify-between gap). ──── */}
      {/* Type and rhythm scale with viewport height (`svh` inside `clamp`) so a
          short laptop screen compresses the story instead of scrolling it, and a
          tall screen still gets the original generous proportions. */}
      <div className="relative z-10 flex min-h-0 flex-col gap-[clamp(0.75rem,2.4svh,2.25rem)]">
        {/* The emotional headline */}
        <div className="max-w-md">
          <h1 className="font-display text-[clamp(1.6rem,4.2svh,3rem)] font-semibold leading-[1.05] tracking-tight text-white">
            Healthy choices.
            <br />
            Healthier life.
            <br />
            <span className="text-emerald-300">One day at a time.</span>
          </h1>

          <p className="mt-[clamp(0.5rem,1.7svh,1.5rem)] max-w-sm text-[clamp(0.8rem,1.6svh,0.95rem)] leading-relaxed text-emerald-50/75">
            Meals, nutrition kits and wellness stays — personal nutrition and
            daily consistency, guiding your transformation every single day.
          </p>

          <div className="mt-[clamp(0.5rem,1.9svh,1.75rem)] inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[clamp(0.75rem,1.5svh,0.875rem)] font-medium text-emerald-100 ring-1 ring-white/15 backdrop-blur-sm xl:px-4 xl:py-2">
            <Sprout className="h-4 w-4 text-emerald-300" aria-hidden="true" />
            Your transformation begins today
          </div>
        </div>

        {/* Feature points — substance, not statistics */}
        <ul className="flex flex-col gap-[clamp(0.4rem,1.5svh,0.875rem)]">
          {FEATURES.map(({ icon: Icon, title, copy }) => (
            <li key={title} className="flex items-start gap-3">
              <span className="mt-0.5 flex size-[clamp(1.75rem,3.4svh,2.25rem)] shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15 backdrop-blur-sm">
                <Icon className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              </span>
              <div>
                <p className="text-[clamp(0.78rem,1.6svh,0.875rem)] font-semibold text-white">
                  {title}
                </p>
                <p className="text-[clamp(0.68rem,1.4svh,0.75rem)] leading-relaxed text-emerald-50/60">
                  {copy}
                </p>
              </div>
            </li>
          ))}
        </ul>

        {/* QR code for app download — large viewport only (inherited from parent
            panel). The URL caption is suppressed here: the panel is height-bound
            and the destination is already in the code's accessible label. */}
        <AppDownloadQrBlock
          slug="customer"
          size={176}
          showUrl={false}
          className="text-emerald-50/80"
          frameClassName="w-[clamp(5.75rem,14svh,8.5rem)] [&>svg]:h-auto [&>svg]:w-full"
        />
      </div>

      {/* ── Quiet footer note, anchored to the bottom ──────────────────── */}
      <p className="relative z-10 text-[clamp(0.65rem,1.3svh,0.75rem)] text-emerald-100/50">
        ArogyaDiet — nourishing everyday life.
      </p>
    </div>
  );
}

/**
 * BotanicalLineArt — calm leaf / sprig / grain line art at very low opacity,
 * anchored bottom-right so it bleeds off the panel edge like texture rather
 * than clipart. Purely decorative → aria-hidden. Palette matches the light
 * variant used on MealsHero, inverted for the dark panel (`currentColor`
 * inherits the light emerald tint).
 */
function BotanicalLineArt() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full text-emerald-200/[0.16]"
      viewBox="0 0 400 600"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
    >
      {/* trailing vine, upper area */}
      <path d="M-10 90 C 60 60, 110 120, 170 80" />
      <path d="M50 78c-7-7-17-5-22 2 9 4 18 1 22-2Z" fill="currentColor" stroke="none" />
      <path d="M100 100c8-6 9-16 3-23-7 7-7 16-3 23Z" fill="currentColor" stroke="none" />
      <path d="M140 84c-7-7-17-6-22 1 9 5 18 2 22-1Z" fill="currentColor" stroke="none" />

      {/* wheat stalk, mid-panel */}
      <path d="M320 420 C 314 360, 314 310, 320 270" />
      <path d="M320 310c10-5 15-14 12-23-9 4-14 14-12 23Z" fill="currentColor" stroke="none" />
      <path d="M320 328c-10-5-15-14-12-23 9 4 14 14 12 23Z" fill="currentColor" stroke="none" />
      <path d="M320 346c10-5 15-14 12-23-9 4-14 14-12 23Z" fill="currentColor" stroke="none" />
      <path d="M320 364c-10-5-15-14-12-23 9 4 14 14 12 23Z" fill="currentColor" stroke="none" />

      {/* large calm leaf, bleeding off the bottom-right edge */}
      <path d="M260 560 C 300 480, 380 460, 430 490" />
      <path
        d="M330 470c18-13 23-36 10-52-17 15-18 39-10 52Z"
        fill="currentColor"
        stroke="none"
      />

      {/* single sprig, upper-right */}
      <path d="M360 60c4 18-4 32-18 40" />
      <path
        d="M348 78c9-2 15-10 13-19-8 3-14 11-13 19Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}
