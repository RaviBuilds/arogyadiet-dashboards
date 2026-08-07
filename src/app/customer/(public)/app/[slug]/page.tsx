// src/app/customer/(public)/app/[slug]/page.tsx
// Download Page for APK distribution — publicly accessible, server-rendered.
//
// This page is the public download surface for both the Customer and Rider apps.
// It renders identical content for anonymous and authenticated visitors (Req 1.4).
//
// Key behaviors:
//   - revalidate = 300: Manifest is read at most once per 5 minutes per slug
//   - generateStaticParams: Pre-renders both slugs at build time
//   - generateMetadata: Per-slug page title and description
//   - params is awaited (Promise in Next.js 16+)
//   - Invalid slug calls notFound()
//   - Manifest failure degrades release details without failing the page
//   - <noscript> block for JavaScript-required message
//   - Omits download control when Turnstile site key is absent
//
// Requirements: 1.1, 1.2, 1.3, 1.6, 1.7, 5.11, 5.12, 9.8

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { parseAppSlug, type AppSlug } from "@/lib/appDistribution/slug";
import { readReleaseManifest } from "@/lib/appDistribution/storage";
import { resolveTurnstileSiteKey } from "@/lib/appDistribution/config";
import { APP_CONTENT } from "@/lib/appDistribution/content";
import type { ReleaseManifest } from "@/lib/appDistribution/manifest";
import { AppDownloadHero, ReleaseDetails, InstallGuide } from "./_components";
import { DownloadControl } from "./DownloadControl";

/**
 * Revalidation interval in seconds.
 * The manifest is read at most once per 5 minutes per slug, rather than on every visit.
 * This prevents scrapers from hammering storage while still allowing new releases
 * to become visible within 5 minutes with no redeployment.
 */
export const revalidate = 300;

/**
 * Generate static parameters for both app slugs.
 * Pre-renders the Customer and Rider download pages at build time.
 */
export async function generateStaticParams(): Promise<{ slug: AppSlug }[]> {
  return [{ slug: "customer" }, { slug: "rider" }];
}

/**
 * Generate metadata for the download page.
 * Returns title and description based on the app slug.
 *
 * @param props - Page props
 * @param props.params - Route parameters (Promise in Next.js 16+)
 * @returns Page metadata
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug: slugValue } = await params;
  const slug = parseAppSlug(slugValue);

  if (!slug) {
    return {
      title: "App Not Found",
    };
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

/**
 * Props for the AppDownloadPage component.
 */
interface AppDownloadPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * AppDownloadPage is the public download surface for APK distribution.
 *
 * This is a React Server Component that:
 *   1. Validates the slug and calls notFound() for invalid values (Req 1.6)
 *   2. Reads the release manifest from storage (may be null on failure)
 *   3. Checks if Turnstile is configured
 *   4. Renders the page with hero, release details, install guide, and download control
 *
 * The page renders identically for anonymous and authenticated visitors (Req 1.4),
 * and excludes all authenticated user data, session identifiers, and PII (Req 1.5).
 *
 * When the manifest is unavailable, ReleaseDetails renders a degraded notice
 * while the rest of the page continues to render (Req 9.8).
 *
 * When the Turnstile site key is absent, the download control is omitted entirely
 * and an unavailable notice is rendered instead (Req 5.12).
 *
 * A <noscript> block informs visitors with JavaScript disabled that they cannot
 * download without JavaScript (Req 5.11).
 *
 * @param props - Page props
 * @param props.params - Route parameters (Promise in Next.js 16+)
 * @returns The download page component
 */
export default async function AppDownloadPage({
  params,
}: AppDownloadPageProps): Promise<React.ReactElement> {
  // Await params (Promise in Next.js 16+)
  const { slug: slugValue } = await params;

  // Validate slug - invalid slug returns 404 (Req 1.6)
  const slug = parseAppSlug(slugValue);
  if (!slug) {
    notFound();
  }

  // Read the release manifest (may be null on failure)
  // Manifest failure degrades release details without failing the page (Req 9.8)
  let manifest: ReleaseManifest | null = null;
  try {
    const result = await readReleaseManifest(slug);
    if (result.ok) {
      manifest = result.manifest;
    } else {
      // Log the failure reason server-side
      console.warn(
        `[AppDownloadPage] Failed to read manifest for ${slug}: ${result.reason} - ${result.detail}`,
      );
    }
  } catch (error) {
    // Unexpected error - log and continue with null manifest
    console.error(
      `[AppDownloadPage] Unexpected error reading manifest for ${slug}:`,
      error,
    );
  }

  // Check if Turnstile is configured (Req 5.12)
  const turnstileSiteKey = resolveTurnstileSiteKey();
  const isTurnstileConfigured = turnstileSiteKey !== null;

  // Log warning if Turnstile is not configured
  if (!isTurnstileConfigured) {
    console.warn(
      `[AppDownloadPage] NEXT_PUBLIC_TURNSTILE_SITE_KEY is not configured. Download control will be unavailable for ${slug}.`,
    );
  }

  // Get content for the app
  const content = APP_CONTENT[slug];

  return (
    <div className="min-h-screen bg-background">
      {/* Main content container */}
      <div className="container mx-auto px-4 py-8 lg:py-12">
        {/* Page header with title */}
        <header className="mb-8 text-center lg:text-left">
          <h1 className="text-3xl lg:text-4xl font-bold tracking-tight mb-2">
            {content.title}
          </h1>
        </header>

        {/* Main grid layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
          {/* Left column: Hero and Download Control */}
          <div className="space-y-6">
            {/* Hero section with phone mockup and features */}
            <AppDownloadHero slug={slug} />

            {/* Download control or unavailable notice */}
            {isTurnstileConfigured ? (
              // Download control with Turnstile widget (Req 5.1, 5.2, 5.3)
              <div className="p-6 bg-muted/30 rounded-lg border">
                <DownloadControl slug={slug} siteKey={turnstileSiteKey} />
              </div>
            ) : (
              // Turnstile not configured - render unavailable notice (Req 5.12)
              <div className="p-4 bg-muted/50 rounded-lg border border-dashed">
                <p className="text-sm text-muted-foreground text-center">
                  Downloads are temporarily unavailable. Please try again later or
                  contact support.
                </p>
              </div>
            )}

            {/* JavaScript required notice for noscript visitors (Req 5.11) */}
            <noscript>
              <div className="p-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
                <p className="text-sm text-amber-800 dark:text-amber-200 text-center">
                  <strong>JavaScript required:</strong> To verify your download
                  request and protect our bandwidth, this page uses a security
                  verification step that requires JavaScript. Please enable
                  JavaScript in your browser settings and refresh the page.
                </p>
              </div>
            </noscript>
          </div>

          {/* Right column: Release Details and Install Guide */}
          <div className="space-y-6">
            {/* Release details - handles null manifest gracefully (Req 9.8) */}
            <ReleaseDetails manifest={manifest} />

            {/* Installation guide */}
            <InstallGuide />
          </div>
        </div>
      </div>
    </div>
  );
}
