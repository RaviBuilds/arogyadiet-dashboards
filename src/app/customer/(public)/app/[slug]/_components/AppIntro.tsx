// src/app/customer/(public)/app/[slug]/_components/AppIntro.tsx
// The masthead of the download page: tagline badge + product headline.
//
// Split out from the narrative copy so `page.tsx` can slot the device mockup and
// the download card between them on mobile. Nearly every visitor arrives here by
// scanning the QR code on a login screen, so on a phone the order is
// badge → title → mockup → download → detail: the visitor sees what the app is,
// what it looks like, and how to get it before any supporting copy.
//
// Visual language mirrors the customer login brand panel: glass pill, then a
// `font-display` headline whose second line carries the accent colour.
//
// Requirements: 9.2

import { Sprout } from "lucide-react";

import { APP_CONTENT } from "@/lib/appDistribution/content";
import type { AppSlug } from "@/lib/appDistribution/slug";
import type { AppTheme } from "./theme";

interface AppIntroProps {
  slug: AppSlug;
  theme: AppTheme;
}

export function AppIntro({ slug, theme }: AppIntroProps): React.ReactElement {
  const content = APP_CONTENT[slug];

  return (
    <div className="flex flex-col items-center gap-4 text-center lg:items-start lg:gap-5 lg:text-left">
      {/* Tagline badge — the login panel's "Your transformation begins today". */}
      <div
        className={`inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[0.7rem] font-medium ring-1 ring-white/15 backdrop-blur-sm sm:text-sm ${theme.bodyText}`}
      >
        <Sprout className={`h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4 ${theme.accentText}`} aria-hidden="true" />
        {content.tagline}
      </div>

      {/* Headline. The app label drops to its own line in the accent colour,
          echoing "One day at a time." on the login panel. Type scales with the
          viewport so a small phone gets a headline that still feels deliberate
          rather than shrunken. */}
      <h1 className="font-display text-[clamp(2.1rem,9vw,3.5rem)] font-semibold leading-[1.02] tracking-tight text-white lg:text-[clamp(2.5rem,4vw,3.5rem)]">
        ArogyaDiet
        <br />
        <span className={theme.accentText}>
          {slug === "customer" ? "Customer App" : "Rider App"}
        </span>
      </h1>
    </div>
  );
}
