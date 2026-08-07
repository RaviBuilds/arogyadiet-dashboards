// src/app/customer/(public)/app/[slug]/page.tsx
// Download Page for APK distribution — publicly accessible, server-rendered.
//
// Visual language is deliberately inherited from the customer login brand panel
// (`src/app/customer/(auth)/login/LoginBrandPanel.tsx`): deep gradient panel,
// ambient glow wells, botanical line art, `font-display` headline, glass pills.
// A visitor arriving here from the QR code on the login screen should feel they
// stayed inside the same product. The rider page carries the same grammar in the
// delivery-partner red/amber palette.
//
// LAYOUT — mobile is the primary case, not the fallback. Effectively every
// visitor arrives by scanning a QR code with a phone camera, so the phone order
// is the designed order:
//
//     badge → headline → device mockup → download card → description → features
//
// The visitor learns what the app is, sees it, and can install it before any
// supporting copy. Desktop keeps the editorial two-column arrangement with the
// mockup on the right.
//
// This is expressed as ONE DOM order re-placed by explicit grid coordinates at
// `lg`, rather than with `order-*` utilities: the DOM order is the mobile order,
// so reading order, tab order and visual order agree on the viewport that
// matters, and the desktop rearrangement is purely presentational.
//
// Key behaviours:
//   - revalidate = 300: manifest is read at most once per 5 minutes per slug
//   - generateStaticParams: pre-renders both slugs at build time
//   - generateMetadata: per-slug title and description
//   - params is awaited (it is a Promise in this Next.js version)
//   - Invalid slug calls notFound()
//   - Manifest failure degrades release details without failing the page
//   - <noscript> block carries the JavaScript-required message
//   - Download control is omitted entirely when the Turnstile site key is absent
//
// Requirements: 1.1, 1.2, 1.3, 1.6, 1.7, 5.11, 5.12, 9.8

import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { parseAppSlug, type AppSlug } from "@/lib/appDistribution/slug";
import { readReleaseManifest } from "@/lib/appDistribution/storage";
import { resolveTurnstileSiteKey } from "@/lib/appDistribution/config";
import { APP_CONTENT } from "@/lib/appDistribution/content";
import type { ReleaseManifest } from "@/lib/appDistribution/manifest";

import {
  APP_THEME,
  AppIntro,
  AppMockup,
  AppNarrative,
  BrandBackdrop,
  ReleaseDetails,
} from "./_components";
import { DownloadControl } from "./DownloadControl";

/**
 * The manifest is read at most once per five minutes per slug rather than on
 * every visit, so a scraper cannot hammer storage, while a new release still
 * becomes visible within five minutes with no redeployment.
 */
export const revalidate = 300;

/** Pre-renders the customer and rider download pages at build time. */
export async function generateStaticParams(): Promise<{ slug: AppSlug }[]> {
  return [{ slug: "customer" }, { slug: "rider" }];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug: slugValue } = await params;
  const slug = parseAppSlug(slugValue);

  if (!slug) {
    return { title: "App Not Found" };
  }

  const content = APP_CONTENT[slug];

  return {
    title: content.title,
    description: content.description,
    openGraph: {
      title: content.title,
      description: content.tagline,
      type: "website",
    },
  };
}

interface AppDownloadPageProps {
  params: Promise<{ slug: string }>;
}

export default async function AppDownloadPage({
  params,
}: AppDownloadPageProps): Promise<React.ReactElement> {
  // `params` is a Promise in this Next.js version.
  const { slug: slugValue } = await params;

  // Invalid slug is a 404, not a 400 — this is a page, not an API (Req 1.6).
  const slug = parseAppSlug(slugValue);
  if (!slug) {
    notFound();
  }

  const theme = APP_THEME[slug];

  // A manifest failure degrades the release facts; it never fails the page,
  // because the app pitch and the download action are still useful (Req 9.8).
  let manifest: ReleaseManifest | null = null;
  try {
    const result = await readReleaseManifest(slug);
    if (result.ok) {
      manifest = result.manifest;
    } else {
      console.warn(
        `[AppDownloadPage] Failed to read manifest for ${slug}: ${result.reason} - ${result.detail}`,
      );
    }
  } catch (error) {
    console.error(
      `[AppDownloadPage] Unexpected error reading manifest for ${slug}:`,
      error,
    );
  }

  // With no site key there is no way to verify a human, so the control is
  // omitted rather than rendered in a state that cannot succeed (Req 5.12).
  const turnstileSiteKey = resolveTurnstileSiteKey();
  if (turnstileSiteKey === null) {
    console.warn(
      `[AppDownloadPage] NEXT_PUBLIC_TURNSTILE_SITE_KEY is not configured. Download control will be unavailable for ${slug}.`,
    );
  }

  return (
    <main
      className={`relative min-h-svh w-full overflow-hidden ${theme.pageGradient}`}
    >
      <BrandBackdrop theme={theme} />

      {/* Bottom padding respects the home-indicator inset so the download card
          never sits under a gesture bar on a notched phone. */}
      <div className="relative z-10 mx-auto flex min-h-svh w-full max-w-6xl flex-col justify-center px-5 pt-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-8 sm:pt-12 lg:px-12 lg:py-16">
        <div
          className="
            reveal-rise
            grid grid-cols-1 gap-7
            sm:gap-8
            lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]
            lg:items-center lg:gap-x-14 lg:gap-y-8
          "
        >
          {/* 1 — Badge + headline. Desktop: left column, first row. */}
          <AppIntro slug={slug} theme={theme} />

          {/* 2 — Device mockup. Desktop: right column, spanning all three rows
                  and vertically centred against the editorial column. */}
          <AppMockup
            slug={slug}
            theme={theme}
            className="lg:col-start-2 lg:row-start-1 lg:row-span-3 lg:self-center"
          />

          {/* 3 — Download card. Desktop: left column, third row (below copy). */}
          <div
            className="
              flex flex-col gap-4 rounded-2xl bg-white/10 p-4
              ring-1 ring-white/15 backdrop-blur-md
              sm:p-5
              lg:col-start-1 lg:row-start-3 lg:max-w-md
            "
          >
            {turnstileSiteKey !== null ? (
              <div className={theme.controlChrome}>
                <DownloadControl slug={slug} siteKey={turnstileSiteKey} />
              </div>
            ) : (
              <p className={`text-center text-sm ${theme.bodyText}`}>
                Downloads are temporarily unavailable. Please try again shortly.
              </p>
            )}

            <ReleaseDetails manifest={manifest} theme={theme} />

            {/* Visitors with JavaScript disabled cannot complete the
                verification step, so tell them plainly (Req 5.11). */}
            <noscript>
              <p className={`text-xs leading-relaxed ${theme.bodyText}`}>
                <strong className="text-white">JavaScript required:</strong>{" "}
                downloading the app involves a short security check that needs
                JavaScript. Please enable it in your browser and reload this page.
              </p>
            </noscript>
          </div>

          {/* 4 — Description + features. Desktop: left column, second row, so it
                  sits between the headline and the download card. */}
          <AppNarrative
            slug={slug}
            theme={theme}
            className="lg:col-start-1 lg:row-start-2"
          />
        </div>
      </div>
    </main>
  );
}
